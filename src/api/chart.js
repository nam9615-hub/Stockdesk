// Vercel Serverless — 야후 파이낸스 시세 프록시 (CORS 우회)
export default async function handler(req, res) {
  const ticker = String(req.query.ticker || "").trim();
  if (!ticker) return res.status(400).json({ error: "ticker 필요" });
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=2y&interval=1d`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (StockDesk)" } });
    const j = await r.json();
    const q = j?.chart?.result?.[0];
    if (!q || !q.timestamp) return res.status(404).json({ error: "종목을 찾을 수 없습니다: " + ticker });
    const o = q.indicators.quote[0];
    const data = q.timestamp
      .map((s, i) => ({
        date: new Date(s * 1000).toISOString().slice(0, 10),
        open: o.open[i], high: o.high[i], low: o.low[i], close: o.close[i], volume: o.volume[i] || 0,
      }))
      .filter((d) => d.close != null && d.high != null && d.low != null);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      currency: q.meta?.currency || "KRW",
      marketPrice: q.meta?.regularMarketPrice,
      marketState: q.meta?.marketState,
      data,
    });
  } catch (e) {
    return res.status(500).json({ error: "시세 조회 실패: " + e.message });
  }
}
