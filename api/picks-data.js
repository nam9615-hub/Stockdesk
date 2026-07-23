// 서버 저장 추천·성적 데이터 조회 (GitHub 저장소를 데이터 창고로 사용)
async function ghRead(path) {
  const token = process.env.GH_TOKEN, repo = process.env.GH_REPO;
  if (!token || !repo) return null;
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "stockdesk", Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return null;
  const j = await r.json();
  try { return JSON.parse(Buffer.from(j.content, "base64").toString("utf8")); } catch { return null; }
}
export default async function handler(req, res) {
  const what = String(req.query.what || "");
  res.setHeader("Cache-Control", "no-store");
  if (what === "latest") {
    const m = String(req.query.market || "KR").toUpperCase();
    const j = await ghRead(`data/latest-${m}.json`);
    return res.status(200).json(j || {});
  }
  if (what === "history") {
    const j = await ghRead("data/history.json");
    return res.status(200).json(j || { entries: [] });
  }
  return res.status(400).json({ error: "what=latest|history" });
}
