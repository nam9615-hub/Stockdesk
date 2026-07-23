// Vercel Cron — 매일 자동: 추천 생성(개장 전) + 과거 추천 자동 채점
// 필요 환경변수: GEMINI_API_KEY(또는 ANTHROPIC_API_KEY), GH_TOKEN, GH_REPO(예: nam9615-hub/Stockdesk)
const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const kstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const kstTime = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 16);

/* ── GitHub 저장소 = 데이터 창고 ── */
async function ghRead(path) {
  const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, "User-Agent": "stockdesk", Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return { data: null, sha: null };
  const j = await r.json();
  try { return { data: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")), sha: j.sha }; }
  catch { return { data: null, sha: j.sha }; }
}
async function ghWrite(path, obj, sha) {
  const body = { message: `data: ${path} ${kstDate()} ${kstTime()}`, content: Buffer.from(JSON.stringify(obj, null, 1)).toString("base64") };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, "User-Agent": "stockdesk", Accept: "application/vnd.github+json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("GitHub 저장 실패: " + (await r.text()).slice(0, 120));
}

/* ── 데이터 수집 (ai.js와 동일 로직) ── */
function collectTitles(obj, out) {
  if (!obj || out.length > 30) return;
  if (Array.isArray(obj)) return obj.forEach((x) => collectTitles(x, out));
  if (typeof obj === "object") for (const [k, v] of Object.entries(obj)) {
    if (k === "title" && typeof v === "string" && v.length > 6) out.push(v.replace(/<[^>]+>/g, ""));
    else collectTitles(v, out);
  }
}
async function naverNews(code, n = 2) {
  const out = [];
  try { collectTitles(await (await fetch(`https://m.stock.naver.com/api/news/stock/${code}?pageSize=${n + 3}`, UA)).json(), out); } catch {}
  return [...new Set(out)].slice(0, n);
}
async function yahooNews(t, n = 2) {
  try {
    const j = await (await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(t)}&newsCount=${n}&quotesCount=0`, UA)).json();
    return (j.news || []).map((x) => x.title).filter(Boolean).slice(0, n);
  } catch { return []; }
}
async function quotePrice(ticker) {
  const kr = ticker.match(/^(\d{6})\.(KS|KQ)$/i);
  if (kr) {
    try {
      const j = await (await fetch(`https://polling.finance.naver.com/api/realtime/domestic/stock/${kr[1]}`, UA)).json();
      const p = +String(j?.datas?.[0]?.closePrice || 0).replace(/,/g, "");
      if (p) return p;
    } catch {}
  }
  try {
    const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`, UA)).json();
    return j?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
  } catch { return null; }
}
async function gatherKR() {
  const top = async (url, n) => {
    const html = new TextDecoder("euc-kr").decode(await (await fetch(url, UA)).arrayBuffer());
    return [...html.matchAll(/code=(\d{6})"[^>]*>([^<]+)<\/a>/g)].slice(0, n).map(([, code, name]) => ({ code, name: name.trim() }));
  };
  const [rise, vol] = await Promise.all([
    top("https://finance.naver.com/sise/sise_rise.naver", 8).catch(() => []),
    top("https://finance.naver.com/sise/sise_quant.naver", 8).catch(() => []),
  ]);
  const seen = new Set(); const cands = [];
  for (const s of [...rise, ...vol]) if (!seen.has(s.code) && cands.length < 10) { seen.add(s.code); cands.push(s); }
  const rows = await Promise.all(cands.map(async (s) => {
    const news = await naverNews(s.code, 2);
    return `${s.name}(${s.code}.KS) | 뉴스: ${news.join(" / ") || "없음"}`;
  }));
  return rows.join("\n");
}
async function gatherUS() {
  try {
    const j = await (await fetch("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=10", UA)).json();
    const qs = (j?.finance?.result?.[0]?.quotes || []).slice(0, 10);
    const rows = await Promise.all(qs.map(async (q) => {
      const news = await yahooNews(q.symbol, 2);
      return `${q.symbol} ${q.shortName || ""} ${(q.regularMarketChangePercent || 0).toFixed(1)}% $${(q.regularMarketPrice || 0).toFixed(2)} | 뉴스: ${news.join(" / ") || "없음"}`;
    }));
    return rows.join("\n");
  } catch { return ""; }
}

/* ── AI 호출 ── */
async function askAI(prompt) {
  const ck = process.env.ANTHROPIC_API_KEY, gk = process.env.GEMINI_API_KEY;
  const parse = (text) => {
    const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
    if (!m) throw new Error("응답 해석 실패");
    return JSON.parse(m[0]);
  };
  if (ck) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ck, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, messages: [{ role: "user", content: prompt }], tools: [{ type: "web_search_20250305", name: "web_search" }] }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return parse((d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n"));
  }
  if (gk) {
    let last = null;
    for (const model of ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gk}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 8192 } }),
        });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message);
        return parse((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""));
      } catch (e) { last = e; }
    }
    throw last;
  }
  throw new Error("AI 키 없음");
}

/* ── 성적 요약 (프롬프트 학습용) ── */
function historySummary(entries, market) {
  const flat = entries.filter((e) => e.market === market).flatMap((e) => e.picks);
  const sw = flat.filter((p) => p.kind !== "day" && p.r5 != null);
  const dy = flat.filter((p) => p.kind === "day" && p.r1 != null);
  const parts = [];
  if (sw.length >= 3) {
    const win = Math.round((sw.filter((p) => p.r5 > 0).length / sw.length) * 100);
    const avg = (sw.reduce((s, p) => s + p.r5, 0) / sw.length).toFixed(1);
    parts.push(`스윙 추천 ${sw.length}건: 5일 승률 ${win}%, 평균 ${avg}%.`);
  }
  if (dy.length >= 3) {
    const hit = Math.round((dy.filter((p) => p.hit).length / dy.length) * 100);
    parts.push(`단타 추천 ${dy.length}건: 목표 적중률 ${hit}%.`);
  }
  return parts.length ? `[과거 실측 성적] ${parts.join(" ")} 실패 유형은 피하고 성공 유형을 우선하라.` : "";
}

/* ── 채점 ── */
async function grade(entries) {
  const need = [...new Set(entries.flatMap((e) => e.picks.filter((p) => p.p0 && (p.kind === "day" ? p.r1 == null : p.r20 == null)).map((p) => p.ticker)))].slice(0, 12);
  const charts = {};
  for (const t of need) {
    try {
      const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=6mo&interval=1d`, UA)).json();
      const q = j?.chart?.result?.[0];
      if (q?.timestamp) {
        const o = q.indicators.quote[0];
        charts[t] = q.timestamp.map((s, i) => ({ date: new Date(s * 1000).toISOString().slice(0, 10), close: o.close[i], high: o.high[i] })).filter((d) => d.close != null);
      }
    } catch {}
  }
  let changed = false;
  entries.forEach((e) => e.picks.forEach((p) => {
    const d = charts[p.ticker]; if (!d || !p.p0) return;
    if (p.kind === "day") {
      if (p.r1 != null) return;
      const row = d.find((x) => x.date >= e.date); if (!row) return;
      p.r1 = +(((row.close - p.p0) / p.p0) * 100).toFixed(1);
      p.hit = row.high >= p.p0 * (1 + (p.target || 3) / 100);
      changed = true; return;
    }
    const i0 = d.findIndex((x) => x.date > e.date); if (i0 < 0) return;
    for (const [k, n] of [["r1", 1], ["r5", 5], ["r20", 20]])
      if (p[k] == null && d[i0 + n - 1]) { p[k] = +(((d[i0 + n - 1].close - p.p0) / p.p0) * 100).toFixed(1); changed = true; }
  }));
  return changed;
}

const promptKR = (data, learn) => `너는 한국 주식 스윙 트레이더(2~4주 보유)다. 아래는 오늘 상승률·거래량 상위 후보와 각 종목의 실제 최신 뉴스다.\n\n[후보]\n${data}\n\n${learn}\n임무: 급등 추격이 아니라 재료 지속성 기준으로 선별. 반드시 아래 JSON만 출력(마크다운 금지): {"brief":"시장 브리핑 2~3문장(한국어)","picks":[{"name":"종목명","ticker":"6자리코드.KS","score":0~100,"reason":"근거 2문장","catalyst":"핵심 재료","risk":"주의점"}],"day_picks":[{"name":"종목명","ticker":"6자리코드.KS","score":0~100,"target_pct":정수(2~10),"reason":"단타 사유","risk":"주의"}]} picks 3개, day_picks 3개(장중 청산 전제), 반드시 후보 안에서만.`;
const promptUS = (data, learn) => `너는 미국 주식 스윙 트레이더다. 아래는 오늘 미국장 상승률 상위 후보와 실제 뉴스다.\n\n[후보]\n${data}\n\n${learn}\n반드시 아래 JSON만 출력(마크다운 금지): {"brief":"브리핑 2~3문장(한국어)","picks":[{"name":"종목명","ticker":"티커","score":0~100,"reason":"근거 2문장(한국어)","catalyst":"핵심 재료","risk":"주의"}],"day_picks":[{"name":"종목명","ticker":"티커","score":0~100,"target_pct":정수(2~10),"reason":"단타 사유(한국어)","risk":"주의"}]} picks 3개, day_picks 3개, 후보 안에서만.`;

export default async function handler(req, res) {
  const job = String(req.query.job || "").toUpperCase();
  if (!process.env.GH_TOKEN || !process.env.GH_REPO) return res.status(501).json({ error: "GH_TOKEN / GH_REPO 환경변수 필요" });
  try {
    const { data: histRaw, sha } = await ghRead("data/history.json");
    const hist = histRaw || { entries: [] };

    // 1) 미채점 성적 자동 채점 (매 실행마다)
    const graded = await grade(hist.entries);

    // 2) 오늘 추천 생성 (해당 시장, 중복 방지)
    let made = false;
    if (job === "KR" || job === "US") {
      const today = kstDate();
      if (!hist.entries.some((e) => e.date === today && e.market === job)) {
        const data = job === "KR" ? await gatherKR() : await gatherUS();
        if (data) {
          const learn = historySummary(hist.entries, job);
          const j = await askAI(job === "KR" ? promptKR(data, learn) : promptUS(data, learn));
          j.picks = (j.picks || []).slice(0, 3);
          j.day_picks = (j.day_picks || []).slice(0, 3);
          const all = [...j.picks, ...j.day_picks];
          const prices = {};
          for (const p of [...new Set(all.map((x) => x.ticker))]) prices[p] = await quotePrice(p);
          hist.entries.push({
            date: today, market: job,
            picks: [
              ...j.picks.map((p) => ({ kind: "swing", name: p.name, ticker: p.ticker, score: p.score, p0: prices[p.ticker] || null, r1: null, r5: null, r20: null })),
              ...j.day_picks.map((p) => ({ kind: "day", name: p.name, ticker: p.ticker, score: p.score, target: +p.target_pct || 3, p0: prices[p.ticker] || null, r1: null, hit: null })),
            ],
          });
          const { sha: ls } = await ghRead(`data/latest-${job}.json`);
          await ghWrite(`data/latest-${job}.json`, { date: today, at: kstTime(), data: j }, ls);
          made = true;
        }
      }
    }
    hist.entries = hist.entries.slice(-120);
    if (graded || made) await ghWrite("data/history.json", hist, sha);
    return res.status(200).json({ ok: true, job, made, graded, at: kstTime() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
