// Vercel Serverless — 뉴스 감성 · 모닝픽 (3단 자동 전환)
// 1) ANTHROPIC_API_KEY → Claude AI (웹검색)
// 2) GEMINI_API_KEY   → Google Gemini AI (무료 키: aistudio.google.com)
// 3) 둘 다 없으면     → 키워드 무료 모드
const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const POS = ["상승","급등","신고가","수주","흑자","호실적","실적개선","계약","돌파","성장","확대","증가","개선","최대","호조","강세","반등","기대","훈풍","질주"];
const NEG = ["하락","급락","적자","소송","감소","악화","하향","우려","쇼크","신저가","약세","부진","리콜","제재","연기","취소","불확실","경고","매도세","조정"];

function collectTitles(obj, out) {
  if (!obj || out.length > 30) return;
  if (Array.isArray(obj)) return obj.forEach((x) => collectTitles(x, out));
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "title" && typeof v === "string" && v.length > 6)
        out.push(v.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
      else collectTitles(v, out);
    }
  }
}
async function naverNews(code, n = 3) {
  const out = [];
  try { collectTitles(await (await fetch(`https://m.stock.naver.com/api/news/stock/${code}?pageSize=${n + 3}`, UA)).json(), out); } catch {}
  return [...new Set(out)].slice(0, n);
}
async function topKR(url, n) {
  const html = new TextDecoder("euc-kr").decode(await (await fetch(url, UA)).arrayBuffer());
  return [...html.matchAll(/code=(\d{6})"[^>]*>([^<]+)<\/a>/g)].slice(0, n).map(([, code, name]) => ({ code, name: name.trim() }));
}
async function quoteChg(code) {
  try {
    const j = await (await fetch(`https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`, UA)).json();
    const d = j?.datas?.[0];
    return { chg: +(d?.fluctuationsRatio || 0), price: +String(d?.closePrice || 0).replace(/,/g, "") };
  } catch { return { chg: 0, price: 0 }; }
}
// 국내 상승률+거래량 상위를 모아 후보 데이터 시트 작성
async function gatherKR() {
  const [rise, vol] = await Promise.all([
    topKR("https://finance.naver.com/sise/sise_rise.naver", 8).catch(() => []),
    topKR("https://finance.naver.com/sise/sise_quant.naver", 8).catch(() => []),
  ]);
  const seen = new Set(); const cands = [];
  for (const s of [...rise, ...vol]) if (!seen.has(s.code) && cands.length < 10) { seen.add(s.code); cands.push(s); }
  const rows = await Promise.all(cands.map(async (s) => {
    const [q, news] = await Promise.all([quoteChg(s.code), naverNews(s.code, 2)]);
    return `${s.name}(${s.code}) ${q.chg > 0 ? "+" : ""}${q.chg}% ${q.price ? q.price + "원" : ""} | 뉴스: ${news.join(" / ") || "없음"}`;
  }));
  return rows.join("\n");
}

/* ── AI 호출부 ── */
async function callClaude(key, prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, messages: [{ role: "user", content: prompt }], tools: [{ type: "web_search_20250305", name: "web_search" }] }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("응답 해석 실패");
  return JSON.parse(m[0]);
}
const GEM_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]; // 무료 등급 지원 모델
async function callGemini(key, model, prompt) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 8192 } }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("응답 해석 실패");
  return JSON.parse(m[0]);
}
async function gemini(key, prompt) {
  const errs = [];
  for (const model of GEM_MODELS) {
    try { return await callGemini(key, model, prompt); }
    catch (e) { errs.push(`${model}: ${e.message}`.slice(0, 120)); }
  }
  throw new Error(errs.join(" / "));
}
// 미국 당일 상승 상위 (야후 스크리너)
async function gatherUS() {
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=10", UA);
    const j = await r.json();
    const rows = (j?.finance?.result?.[0]?.quotes || []).slice(0, 10).map((q) =>
      `${q.symbol} ${q.shortName || ""} ${q.regularMarketChangePercent > 0 ? "+" : ""}${(q.regularMarketChangePercent || 0).toFixed(1)}% $${(q.regularMarketPrice || 0).toFixed(2)}`);
    return rows.join("\n");
  } catch { return ""; }
}

/* ── 프롬프트 ── */
const newsPrompt = (label, ticker, ctx) =>
  `너는 한국 주식 애널리스트다. '${label}'(${ticker})의 최근 뉴스·실적·업황을 분석해라.${ctx ? `\n\n[수집된 실제 뉴스 헤드라인]\n${ctx}` : ""}\n제공된 헤드라인을 근거로 판단하고, 확실하지 않은 내용은 지어내지 마라. 반드시 아래 JSON만 출력(마크다운 금지): {"sentiment": 정수(-100~100, 악재 음수·호재 양수), "mood": "시장·수급 분위기 한 줄(한국어)", "headlines": [{"t":"뉴스 요약 한 줄","s":"+ 또는 - 또는 0"}] (최대 4개), "summary": "투자 관점 종합 2문장(한국어)"}`;
const picksKRPrompt = (data) =>
  `너는 한국 주식 스윙 트레이더(2~4주 보유)다. 아래는 오늘 상승률·거래량 상위 후보 종목과 각 종목의 실제 최신 뉴스다.\n\n[후보 데이터]\n${data}\n\n임무: 단순 급등 추격이 아니라, 뉴스 재료의 '지속 가능성'과 스윙 관점 매력도 기준으로 후보 중 3개만 선별해라. 급등만 하고 재료가 없는 종목은 제외해라. 반드시 아래 JSON만 출력(마크다운 금지): {"brief":"오늘 시장 브리핑 2~3문장(한국어)","picks":[{"name":"종목명","ticker":"6자리코드.KS","score":0~100 정수(스윙 매력도),"reason":"선정 근거 2문장 — 왜 재료가 지속될 수 있는지","catalyst":"핵심 재료 한 줄","risk":"주의점 한 줄"}]} picks 정확히 3개, 반드시 후보 목록 안의 종목만.`;
const picksUSPrompt = (data) =>
  `너는 미국 주식 스윙 트레이더(2~4주 보유)다. 아래는 오늘 미국장 상승률 상위 실제 데이터다.\n\n[후보 데이터]\n${data}\n\n임무: 단순 급등 추격이 아니라 스윙 관점 지속 가능성 기준으로 후보 중 3개만 선별해라. 반드시 후보 목록 안의 종목만 골라라. 각 종목에 대해 네가 아는 사업·업황 지식을 활용하되, 최신 뉴스를 확인할 수 없다면 risk에 "최신 뉴스 미확인"을 포함해라. 반드시 아래 JSON만 출력(마크다운 금지): {"brief":"브리핑 2~3문장(한국어)","picks":[{"name":"종목명","ticker":"티커","score":0~100 정수,"reason":"근거 2문장(한국어)","catalyst":"핵심 재료 한 줄","risk":"주의점 한 줄"}]} picks 정확히 3개.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { kind, label, ticker, market } = req.body || {};
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const code = (String(ticker || "").match(/^(\d{6})\./) || [])[1];

  try {
    if (kind === "news") {
      const titles = code ? await naverNews(code, 5) : [];
      const ctx = titles.join("\n");
      if (claudeKey) return res.status(200).json(await callClaude(claudeKey, newsPrompt(label, ticker, ctx)));
      if (geminiKey) return res.status(200).json(await gemini(geminiKey, newsPrompt(label, ticker, ctx)));
      // 키워드 무료 모드
      if (!titles.length) return res.status(200).json({ sentiment: 0, mood: "뉴스를 가져오지 못했습니다.", headlines: [], summary: "GEMINI_API_KEY(무료) 등록 시 AI 분석이 활성화됩니다." });
      let p = 0, n = 0;
      const heads = titles.slice(0, 4).map((t) => { const pc = POS.filter((w) => t.includes(w)).length, nc = NEG.filter((w) => t.includes(w)).length; p += pc; n += nc; return { t, s: pc > nc ? "+" : nc > pc ? "-" : "0" }; });
      const sentiment = Math.max(-100, Math.min(100, Math.round(((p - n) / Math.max(p + n, 1)) * 60)));
      return res.status(200).json({ sentiment, mood: "키워드 모드 (GEMINI_API_KEY 등록 시 AI 분석으로 업그레이드)", headlines: heads, summary: "키워드 판별이라 문맥은 인식하지 못합니다. 헤드라인을 직접 확인하세요." });
    }

    if (kind === "picks") {
      if (market === "KR") {
        const data = await gatherKR();
        if (claudeKey) return res.status(200).json(await callClaude(claudeKey, picksKRPrompt(data)));
        if (geminiKey) return res.status(200).json(await gemini(geminiKey, picksKRPrompt(data)));
        return res.status(200).json({ brief: "AI 키가 없습니다. GEMINI_API_KEY(구글 무료 키)를 Vercel 환경변수에 등록하면 실제 뉴스 기반 AI 선별 추천이 활성화됩니다. aistudio.google.com에서 카드 등록 없이 발급 가능합니다.", picks: [] });
      }
      const usData = await gatherUS();
      const usPrompt = usData ? picksUSPrompt(usData) : null;
      if (claudeKey) return res.status(200).json(await callClaude(claudeKey, usPrompt || "너는 미국 주식 스윙 트레이더다. 웹검색으로 오늘 프리마켓·선물·실적 일정을 조사해 3종목을 골라라. JSON만 출력: {\"brief\":\"...\",\"picks\":[{\"name\",\"ticker\",\"score\",\"reason\",\"catalyst\",\"risk\"}]}"));
      if (geminiKey) {
        if (!usPrompt) return res.status(200).json({ brief: "미국장 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.", picks: [] });
        return res.status(200).json(await gemini(geminiKey, usPrompt));
      }
      return res.status(200).json({ brief: "미국장 프리픽은 AI 키 등록 시 활성화됩니다 (GEMINI_API_KEY 무료 발급 가능).", picks: [] });
    }
    return res.status(400).json({ error: "kind는 news 또는 picks" });
  } catch (e) {
    return res.status(502).json({ error: "AI 분석 실패: " + e.message });
  }
}
