// 장중 가상매매 모니터 — 인증된 외부 스케줄러 또는 동일 출처 PaperDesk가 호출
// 역할: 오늘 픽의 시가(진입가) 확정 → 실시간 가격으로 손절/목표 터치 시 즉시 가상 체결(live)
// Simulation only. A real broker requires independent authorization and reconciliation.
import { runPaper } from '../lib/paper-store.js';
import { krSession, krSettlement } from '../lib/sessions.js';
import { githubActionsAuthorized } from '../lib/monitor-auth.js';
import { runIntradayScout } from '../lib/intraday-scout.js';
const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const kstDate = () => kstNow().toISOString().slice(0, 10);
const kstTime = () => kstNow().toISOString().slice(11, 16);

function cronAuthorized(req) {
  const expected = process.env.CRON_KEY;
  if (!expected) return false;
  const bearer = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const supplied = req.headers?.["x-cron-key"] || bearer || req.query?.key;
  return supplied === expected;
}

function sameOriginPaperDesk(req) {
  if (req.method !== 'GET' || req.headers?.['x-stockdesk-client'] !== 'paper-desk') return false;
  if (String(req.headers?.['sec-fetch-site'] || '').toLowerCase() !== 'same-origin') return false;
  const forwarded = String(req.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const host = (forwarded || String(req.headers?.host || '')).toLowerCase();
  try {
    return Boolean(host) && new URL(String(req.headers?.referer || '')).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

async function ghRead(path) {
  const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, "User-Agent": "stockdesk", Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return { data: null, sha: null };
  const j = await r.json();
  try { return { data: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")), sha: j.sha }; } catch { return { data: null, sha: j.sha }; }
}
function mergeMonitorHistory(latest, local) {
  const out = latest || { entries: [] };
  const fields = ["b", "gap", "simR", "simExit", "simD", "simT", "live", "simOpen"];
  for (const le of local?.entries || []) {
    const re = (out.entries || []).find((e) => e.date === le.date && e.market === le.market);
    if (!re) continue; // Never recreate an entry deleted or replaced by another writer.
    for (const lp of le.picks || []) {
      const rp = (re.picks || []).find((p) => p.ticker === lp.ticker && p.kind === lp.kind && (p.cAt || "") === (lp.cAt || ""));
      if (!rp) continue;
      for (const key of fields) if (lp[key] !== undefined) rp[key] = lp[key];
    }
  }
  out.monAt = Math.max(Number(out.monAt || 0), Number(local?.monAt || 0));
  return out;
}
async function ghWrite(path, obj, sha) {
  let payload = obj, currentSha = sha;
  for (let attempt = 0; attempt < 4; attempt++) {
    const body = { message: `monitor: ${kstDate()} ${kstTime()}`, content: Buffer.from(JSON.stringify(payload, null, 1)).toString("base64") };
    if (currentSha) body.sha = currentSha;
    const r = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/contents/${path}`, {
      method: "PUT", headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, "User-Agent": "stockdesk", Accept: "application/vnd.github+json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return { saved: true, retries: attempt };
    const detail = (await r.text()).slice(0, 180);
    if (r.status !== 409 || path !== "data/history.json") {
      throw new Error(`GitHub 저장 실패 HTTP ${r.status}: ${detail}`);
    }
    const fresh = await ghRead(path);
    if (!fresh.data || !fresh.sha) throw new Error("GitHub 충돌 복구용 최신 기록 조회 실패");
    payload = mergeMonitorHistory(fresh.data, payload);
    currentSha = fresh.sha;
    await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
  }
  const error = new Error("GitHub 동시 저장 충돌: 다음 감시에서 재시도");
  error.code = "GH_CONFLICT_DEFERRED";
  throw error;
}

function isUsDST(d) {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  if (m > 2 && m < 10) return true;
  if (m < 2 || m > 10) return false;
  if (m === 2) { const w = new Date(y, 2, 1).getDay(); return day >= 1 + ((7 - w) % 7) + 7; }
  const w = new Date(y, 10, 1).getDay(); return day < 1 + ((7 - w) % 7);
}

// 현재가 + 당일 시가 조회
async function priceOpen(ticker) {
  const kr = ticker.match(/^(\d{6})\.(KS|KQ)$/i);
  if (kr) {
    try {
      const j = await (await fetch(`https://polling.finance.naver.com/api/realtime/domestic/stock/${kr[1]}`, UA)).json();
      const d = j?.datas?.[0];
      const px = +String(d?.closePrice || 0).replace(/,/g, "");
      const op = +String(d?.openPrice || 0).replace(/,/g, "");
      if (px) return { px, op: op || null };
    } catch {}
  }
  try {
    const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`, UA)).json();
    const q = j?.chart?.result?.[0];
    const px = q?.meta?.regularMarketPrice || null;
    const op = q?.indicators?.quote?.[0]?.open?.find((x) => x != null) ?? null;
    return { px, op };
  } catch { return { px: null, op: null }; }
}

export default async function handler(req, res) {
  const secret = cronAuthorized(req);
  const browser = sameOriginPaperDesk(req);
  const github = !secret && !browser && await githubActionsAuthorized(req);
  const authorized = secret || browser || github;
  if (!authorized) return res.status(401).json({ error: "모니터 인증 필요" });
  const source = github ? 'github-actions' : browser ? 'paper-desk' : 'shared-secret';
  console.log('[monitor] accepted', { source, at: kstTime() });
  if (process.env.PAUSE === "1") return res.status(200).json({ ok: true, paused: true });
  if (!process.env.GH_TOKEN || !process.env.GH_REPO) return res.status(501).json({ error: "GH_TOKEN / GH_REPO 필요" });

  // 어느 시장 장중인지 판정 (KST)
  const n = kstNow();
  const day = n.getUTCDay(); // kstNow는 이미 +9h 보정된 UTC 표현
  const t = n.getUTCHours() + n.getUTCMinutes() / 60;
  const usOpen = isUsDST(new Date()) ? 22.5 : 23.5;
  const krPhase = krSession(Date.now());
  const krActive = krPhase !== 'closed' || krSettlement(Date.now());
  const usActive = (day >= 1 && day <= 5 && t >= usOpen) || (day >= 2 && day <= 6 && t <= 6.2);
  if (!krActive && !usActive) {
    console.log('[monitor] idle', { source, at: kstTime() });
    return res.status(200).json({ ok: true, idle: true, at: kstTime() });
  }
  const market = krActive ? "KR" : "US";

  try {
    const { data: histRaw, sha } = await ghRead("data/history.json");
    const hist = histRaw || { entries: [] };
    let scout = null;
    if (source === 'github-actions' && (market !== 'KR' || krPhase === 'krx-regular')) {
      try {
        scout = await runIntradayScout(market, hist.entries, Date.now(), { authorized: true });
        console.log('[scout] completed', { market, ...scout });
      } catch (error) {
        scout = { enabled: true, observedOnly: true, error: String(error.message || error) };
        console.error('[scout] failed', { market, error: scout.error });
      }
    }
    // Keep new forward paper trading independent from legacy historical grading.
    let paper;
    try { paper = await runPaper(market, hist.entries, Date.now(), {authorized:true}); }
    catch (error) { return res.status(503).json({error:'모의계좌 실행 실패',detail:error.message}); }
    // Legacy Naver prices have no verified NXT venue/timestamp contract either.
    if(market==='KR' && krPhase!=='krx-regular') return res.status(200).json({ok:true,market,session:krPhase,paper,scout,watched:0,at:kstTime()});
    const today = kstDate();
    // 미국 세션은 KST 자정을 넘으므로 전일 날짜 픽도 포함
    const yday = new Date(Date.now() + 9 * 3600e3 - 864e5).toISOString().slice(0, 10);
    const sessDates = market === "KR" ? [today] : [today, yday];

    // 감시 대상: 미청산 픽 (당일 단타 + 보유 중 스윙)
    const targets = [];
    hist.entries.forEach((e) => {
      if (e.market !== market) return;
      (e.picks || []).forEach((p) => {
        if (p.simR != null || !p.ticker || p.plan?.decision?.action === 'watch') return;
        if (p.kind === "day" && !sessDates.includes(e.date)) return; // 단타는 당일 세션만
        targets.push({ e, p });
      });
    });
    if (!targets.length) return res.status(200).json({ ok: true, market, watched: 0, paper, scout, at: kstTime() });

    let hard = false, soft = false; // hard=진입가 확정·체결, soft=평가손익 갱신
    const fills = [];
    const seen = {};
    targets.sort((a, b) => (a.p.kind === "day" ? 0 : 1) - (b.p.kind === "day" ? 0 : 1)); // 단타 우선 감시
    for (const { e, p } of targets.slice(0, 25)) {
      if (!seen[p.ticker]) seen[p.ticker] = await priceOpen(p.ticker);
      const { px, op } = seen[p.ticker];
      if (!px) continue;
      // 진입가(시가) 확정 — 개장 후 최초 관측 시 1회
      if (p.b == null) {
        const base = op || px;
        p.b = base;
        if (p.p0) p.gap = +(((base - p.p0) / p.p0) * 100).toFixed(1);
        hard = true;
      }
      const stopPct = +(p.plan?.stopPct || (p.kind === "day" ? 3 : 5));
      const tgtPct = +(p.plan?.targetPct || (p.kind === "day" ? (p.target || 3) : 10));
      const r = ((px - p.b) / p.b) * 100;
      if (px <= p.b * (1 - stopPct / 100)) {
        p.simR = -stopPct; p.simExit = "stop"; p.simD = today; p.simT = kstTime(); p.live = 1;
        fills.push(`${p.name} 손절 −${stopPct}% (${kstTime()})`); hard = true;
      } else if (px >= p.b * (1 + tgtPct / 100)) {
        p.simR = tgtPct; p.simExit = "target"; p.simD = today; p.simT = kstTime(); p.live = 1;
        fills.push(`${p.name} 익절 +${tgtPct}% (${kstTime()})`); hard = true;
      } else if (p.kind !== "day") {
        const u = +r.toFixed(1);
        if (p.simOpen !== u) { p.simOpen = u; soft = true; }
      }
    }
    // 커밋 스로틀: 체결·진입가는 즉시, 평가손익만 바뀐 경우 15분 간격 스냅샷
    const snapDue = Date.now() - Number(hist.monAt || 0) > 15 * 60e3;
    if (hard || (soft && snapDue)) {
      hist.monAt = Date.now();
      await ghWrite("data/history.json", hist, sha);
    }
    const result = { ok: true, market, watched: targets.length, fills, paper, scout, saved: hard || (soft && snapDue), at: kstTime() };
    console.log('[monitor] completed', { source, market, watched: targets.length, fills: fills.length, saved: result.saved, at: result.at });
    return res.status(200).json(result);
  } catch (e) {
    if (e.code === "GH_CONFLICT_DEFERRED") {
      console.warn('[monitor] save deferred', { source, reason: e.message, at: kstTime() });
      return res.status(200).json({ ok: true, deferred: true, saved: false, note: "동시 저장 충돌 · 다음 감시에서 자동 재시도", at: kstTime() });
    }
    console.error('[monitor] failed', { source, error: String(e.message || e), at: kstTime() });
    return res.status(500).json({ error: e.message });
  }
}
