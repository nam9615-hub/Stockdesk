// Vercel Serverless — 초단위 실시간 시세 (국내: 네이버 폴링 / 해외: 야후 1분봉)
export default async function handler(req, res) {
  const tickers = String(req.query.tickers || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!tickers.length) return res.status(400).json({ error: "tickers 필요" });
  const num = (v) => +String(v ?? 0).replace(/,/g, "") || 0;

  const quotes = await Promise.all(tickers.map(async (t) => {
    const kr = t.match(/^(\d{6})\.(KS|KQ)$/i);
    if (kr) {
      const code = kr[1];
      try {
        const r = await fetch(`https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`, { headers: { "User-Agent": "Mozilla/5.0" } });
        const j = await r.json();
        const d = j?.datas?.[0];
        if (d && (d.closePrice || d.currentPrice))
          return { ticker: t, price: num(d.closePrice || d.currentPrice), changePct: +d.fluctuationsRatio || 0, volume: num(d.accumulatedTradingVolume), state: d.marketStatus || "", source: "naver-rt" };
      } catch {}
      try {
        const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, { headers: { "User-Agent": "Mozilla/5.0" } });
        const j = await r.json();
        if (j && j.closePrice)
          return { ticker: t, price: num(j.closePrice), changePct: +j.fluctuationsRatio || 0, volume: num(j.accumulatedTradingVolume), state: j.marketStatus || "", source: "naver-basic" };
      } catch {}
    }
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=1d&interval=1m`, { headers: { "User-Agent": "Mozilla/5.0" } });
      const j = await r.json();
      const m = j?.chart?.result?.[0]?.meta;
      if (m && m.regularMarketPrice != null) {
        const pc = m.chartPreviousClose || m.previousClose;
        return { ticker: t, price: m.regularMarketPrice, changePct: pc ? ((m.regularMarketPrice - pc) / pc) * 100 : 0, volume: m.regularMarketVolume || 0, state: m.marketState || "", source: "yahoo" };
      }
    } catch {}
    return { ticker: t, error: "조회 실패" };
  }));
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ quotes, t: Date.now() });
}
