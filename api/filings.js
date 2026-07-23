// Vercel Serverless — 최근 공시/제출서류 (국내: 네이버 공시 / 해외: SEC EDGAR 공식)
function collect(obj, out) {
  if (!obj || out.length > 20) return;
  if (Array.isArray(obj)) return obj.forEach((x) => collect(x, out));
  if (typeof obj === "object") {
    if (typeof obj.title === "string" && obj.title.length > 4) {
      const date = obj.datetime || obj.date || obj.regDate || obj.registDate || obj.dt || "";
      out.push({ title: obj.title.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"), date: String(date).slice(0, 10) });
    }
    Object.values(obj).forEach((v) => collect(v, out));
  }
}
export default async function handler(req, res) {
  const ticker = String(req.query.ticker || "").trim();
  if (!ticker) return res.status(400).json({ error: "ticker 필요" });
  const kr = ticker.match(/^(\d{6})\.(KS|KQ)$/i);
  let items = [];
  if (kr) {
    const code = kr[1];
    for (const url of [
      `https://m.stock.naver.com/api/stock/${code}/notice?pageSize=8`,
      `https://m.stock.naver.com/api/notice/stock/${code}?pageSize=8`,
      `https://m.stock.naver.com/api/stock/${code}/notice`,
    ]) {
      try { const j = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).json(); const out = []; collect(j, out); if (out.length) { items = out; break; } } catch {}
    }
  } else if (/^[A-Za-z.\-]+$/.test(ticker)) {
    // SEC EDGAR 공식 API (미국 상장사, 키 불필요)
    const UA = { headers: { "User-Agent": "StockDesk/1.0 (personal research app)" } };
    try {
      const map = await (await fetch("https://www.sec.gov/files/company_tickers.json", UA)).json();
      const ent = Object.values(map).find((e) => String(e.ticker).toUpperCase() === ticker.toUpperCase());
      if (ent) {
        const cik = String(ent.cik_str).padStart(10, "0");
        const sub = await (await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, UA)).json();
        const r = sub?.filings?.recent;
        if (r && r.form) {
          items = r.form.slice(0, 40).map((form, i) => ({
            date: r.filingDate?.[i] || "",
            title: `${form}${r.primaryDocDescription?.[i] ? " — " + r.primaryDocDescription[i] : ""}`,
          }));
        }
      }
    } catch {}
  }
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  return res.status(200).json({ items: items.slice(0, 8), source: kr ? "naver" : "sec-edgar" });
}
