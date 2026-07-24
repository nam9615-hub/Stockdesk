// Vercel Serverless — 전 종목 자동완성 (네이버 증권 검색 프록시)
export default async function handler(req, res) {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(200).json({ items: [] });
  const sfx = (m) => (/KOSDAQ|코스닥/i.test(m) ? ".KQ" : /KOSPI|KONEX|코스피|코넥스/i.test(m) ? ".KS" : "");
  let items = [];
  // 1순위: 네이버 모바일 자동완성
  try {
    const r = await fetch(`https://m.stock.naver.com/front-api/search/autoComplete?query=${encodeURIComponent(q)}&target=stock`, { headers: { "User-Agent": "Mozilla/5.0" } });
    const j = await r.json();
    const arr = j?.result?.items || j?.items || [];
    items = arr.map((it) => {
      const code = String(it.code || it.itemCode || it.reutersCode || "");
      const name = it.name || it.stockName || it.itemName || "";
      const mkt = String(it.typeCode || it.category || it.market || (it.stockExchangeType && (it.stockExchangeType.name || it.stockExchangeType)) || "");
      if (/^\d{6}$/.test(code) && name) return { name, ticker: code + (sfx(mkt) || ".KS") };
      if (/^[A-Z][A-Z0-9.\-]*$/.test(code) && name) return { name, ticker: code };
      return null;
    }).filter(Boolean);
  } catch {}
  // 2순위: 구형 자동완성 엔드포인트
  if (!items.length) {
    try {
      const r = await fetch(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`, { headers: { "User-Agent": "Mozilla/5.0" } });
      const j = await r.json();
      const groups = j?.items || [];
      const flat = Array.isArray(groups[0]) ? groups.flat() : groups;
      items = flat.map((row) => {
        if (!Array.isArray(row)) return null;
        const code = String(row[0] && row[0][0] || "");
        const name = String(row[1] && row[1][0] || "");
        const mkt = String(row[2] && row[2][0] || "");
        if (/^\d{6}$/.test(code) && name) return { name, ticker: code + (sfx(mkt) || ".KS") };
        return null;
      }).filter(Boolean);
    } catch {}
  }
  // 국내 결과가 없고 영문 티커 형태면 야후 검색으로 이름 해석 (미국 등)
  if (!items.length && /^[A-Za-z.\-^=]{1,10}$/.test(q)) {
    try {
      const j = await (await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
      items = (j.quotes || []).filter((x) => x.symbol).map((x) => ({ name: x.shortname || x.longname || x.symbol, ticker: x.symbol })).slice(0, 6);
    } catch {}
  }
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json({ items: items.slice(0, 10) });
}
