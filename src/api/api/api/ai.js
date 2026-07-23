// Vercel Serverless — Anthropic AI (뉴스 감성 · 모닝픽) 프록시
// 환경변수 ANTHROPIC_API_KEY 필요 (없으면 501 반환 → 앱은 기술적 분석만 표시)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(501).json({ error: "ANTHROPIC_API_KEY 미설정 — Vercel 환경변수에 추가하세요" });
  const { kind, label, ticker, market } = req.body || {};
  let prompt;
  if (kind === "news") {
    prompt = `웹검색으로 '${label}'(${ticker}) 주식의 최근 1~2주 뉴스, 실적, 업황, 관련 시장 분위기를 조사해줘. 반드시 아래 JSON만 출력, 마크다운·설명 금지: {"sentiment": 정수(-100~100, 악재 음수·호재 양수·중립 0), "mood": "시장·수급 분위기 한 줄(한국어)", "headlines": [{"t":"뉴스 요약 한 줄","s":"+ 또는 - 또는 0"}] (최대 4개), "summary": "투자 관점 종합 2문장(한국어)"}`;
  } else if (kind === "picks") {
    prompt = market === "KR"
      ? `웹검색으로 오늘 한국 증시 개장 전 상황(전일 미국장, 야간선물, 환율, 주요 뉴스·수급)을 조사하고, 일봉 스윙(2~4주) 관점에서 오늘 주목할 한국 종목 3개를 골라줘(투자 권유 아닌 관찰 후보). 반드시 아래 JSON만 출력, 마크다운·설명 금지: {"brief":"시장 브리핑 2~3문장(한국어)","picks":[{"name":"종목명","ticker":"티커(.KS/.KQ)","score":0~100 정수,"reason":"근거 1~2문장","catalyst":"핵심 재료 한 줄","risk":"주의점 한 줄"}]} picks 정확히 3개.`
      : `웹검색으로 오늘 미국 증시 개장 전(프리마켓) 상황(선물, 프리마켓 급등락, 실적·지표 일정)을 조사하고, 스윙 관점에서 주목할 미국 종목 3개를 골라줘(투자 권유 아닌 관찰 후보). 반드시 아래 JSON만 출력, 마크다운·설명 금지: {"brief":"미국장 브리핑 2~3문장(한국어)","picks":[{"name":"종목명","ticker":"티커","score":0~100 정수,"reason":"근거 1~2문장(한국어)","catalyst":"핵심 재료 한 줄","risk":"주의점 한 줄"}]} picks 정확히 3개.`;
  } else return res.status(400).json({ error: "kind는 news 또는 picks" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });
    const data = await r.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: "AI 응답 해석 실패" });
    return res.status(200).json(JSON.parse(m[0]));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
