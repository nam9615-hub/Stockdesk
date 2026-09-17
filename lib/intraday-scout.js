const VERSION = 'IS1.0';
const UA = { headers: { 'User-Agent': 'Mozilla/5.0' } };
const headers = () => ({ Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'stockdesk', Accept: 'application/vnd.github+json' });
const finite = (n) => Number.isFinite(n) && n > 0;
const pct = (a, b) => finite(a) && finite(b) ? ((a / b) - 1) * 100 : null;

export function scoreScoutSignal({ market, bars }) {
  if (!Array.isArray(bars) || bars.length < 7) return { ok: false, reason: '완료 5분봉 부족' };
  const last = bars.at(-1), prior = bars.slice(-7, -1);
  if (![last.open, last.high, last.low, last.close, last.volume].every(finite)) return { ok: false, reason: '가격·거래량 누락' };
  const avgVolume = prior.reduce((sum, bar) => sum + (+bar.volume || 0), 0) / prior.length;
  const volumeRatio = avgVolume > 0 ? last.volume / avgVolume : 0;
  const move15 = pct(last.close, bars.at(-4)?.close);
  const fromOpen = pct(last.close, bars[0]?.open);
  const notional = last.close * last.volume;
  const minNotional = market === 'KR' ? 100_000_000 : 1_000_000;
  const ok = volumeRatio >= 1.8 && move15 >= 0.8 && move15 <= 8 && fromOpen <= 12 && notional >= minNotional;
  const reason = volumeRatio < 1.8 ? '거래량 배수 부족'
    : move15 < 0.8 ? '15분 상승 탄력 부족'
      : move15 > 8 || fromOpen > 12 ? '단기 과열'
        : notional < minNotional ? '거래대금 부족' : '거래량·15분 모멘텀·유동성 통과';
  return {
    ok, reason,
    price: last.close,
    at: last.at + 300000,
    volumeRatio: +volumeRatio.toFixed(2),
    move15Pct: +move15.toFixed(2),
    fromOpenPct: +fromOpen.toFixed(2),
    notional: Math.round(notional),
    score: +(Math.min(100, volumeRatio * 18 + move15 * 6 + Math.min(20, notional / minNotional)).toFixed(1)),
  };
}

function sessionDate(now, market) {
  const zone = market === 'KR' ? 'Asia/Seoul' : 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

function sessionClosed(now, market) {
  const zone = market === 'KR' ? 'Asia/Seoul' : 'America/New_York';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  const m = +p.hour * 60 + +p.minute;
  return market === 'KR' ? m >= 930 : m >= 960;
}

async function readState(market) {
  const path = `data/intraday-scout-${market}.json`;
  const response = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/contents/${path}`, { headers: headers(), signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return { path, sha: null, state: null };
  if (!response.ok) throw new Error(`Scout read failed (${response.status})`);
  const json = await response.json();
  return { path, sha: json.sha, state: JSON.parse(Buffer.from(json.content, 'base64').toString('utf8')) };
}

async function writeState(path, sha, state) {
  const body = { message: `scout: ${state.market} ${new Date(state.lastRun).toISOString()}`, content: Buffer.from(JSON.stringify(state)).toString('base64'), ...(sha ? { sha } : {}) };
  const response = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/contents/${path}`, { method: 'PUT', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(response.status === 409 ? 'Scout write conflict' : `Scout write failed (${response.status})`);
}

async function naverRows(url, suffix, limit = 6) {
  const response = await fetch(url, { ...UA, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return [];
  const html = new TextDecoder('euc-kr').decode(await response.arrayBuffer());
  return [...html.matchAll(/code=(\d{6})"[^>]*>([^<]+)<\/a>/g)].slice(0, limit).map(([, code, name]) => ({ ticker: `${code}.${suffix}`, name: name.trim() }));
}

async function candidatePool(market) {
  if (market === 'KR') {
    const [riseKp, riseKq, volKp, volKq] = await Promise.all([
      naverRows('https://finance.naver.com/sise/sise_rise.naver?sosok=0', 'KS'),
      naverRows('https://finance.naver.com/sise/sise_rise.naver?sosok=1', 'KQ'),
      naverRows('https://finance.naver.com/sise/sise_quant.naver?sosok=0', 'KS'),
      naverRows('https://finance.naver.com/sise/sise_quant.naver?sosok=1', 'KQ'),
    ]);
    const mixed = [];
    for (let i = 0; i < 6; i++) for (const list of [riseKp, riseKq, volKp, volKq]) if (list[i]) mixed.push(list[i]);
    return [...new Map(mixed.map(item => [item.ticker, item])).values()].slice(0, 8);
  }
  const grab = async (id) => {
    const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${id}&count=10`, { ...UA, signal: AbortSignal.timeout(8000) });
    const json = response.ok ? await response.json() : null;
    return (json?.finance?.result?.[0]?.quotes || []).map(q => ({ ticker: q.symbol, name: q.shortName || q.symbol }));
  };
  const [gainers, active] = await Promise.all([grab('day_gainers'), grab('most_actives')]);
  return [...new Map([...gainers, ...active].filter(x => x.ticker).map(item => [item.ticker, item])).values()].slice(0, 8);
}

async function completedBars(ticker, now) {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=5m`, { ...UA, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`quote ${response.status}`);
  const q = (await response.json())?.chart?.result?.[0];
  if (!q?.timestamp) return [];
  const x = q.indicators?.quote?.[0] || {};
  return q.timestamp.map((t, i) => ({ at: t * 1000, open: x.open?.[i], high: x.high?.[i], low: x.low?.[i], close: x.close?.[i], volume: x.volume?.[i] }))
    .filter(bar => bar.at + 300000 <= now && finite(bar.close) && finite(bar.volume));
}

function recordOutcomes(items, quotes, now, market) {
  let changed = false;
  for (const item of items) {
    const bars = quotes[item.ticker];
    const last = bars?.at(-1);
    if (!last || !finite(item.price)) continue;
    const elapsed = now - item.discoveredAt;
    item.outcomes ||= {};
    const set = (key) => { if (item.outcomes[key] == null) { item.outcomes[key] = +pct(last.close, item.price).toFixed(2); changed = true; } };
    if (elapsed >= 30 * 60000) set('r30');
    if (elapsed >= 60 * 60000) set('r60');
    if (sessionClosed(now, market)) set('rClose');
    item.lastPrice = last.close;
    item.lastAt = last.at + 300000;
  }
  return changed;
}

export async function runIntradayScout(market, entries, now = Date.now(), options = {}) {
  if (options.authorized !== true) throw new Error('Scout requires authorized scheduler');
  const { path, sha, state: stored } = await readState(market);
  if (stored?.lastRun && now - stored.lastRun < 14 * 60000) return { enabled: true, observedOnly: true, throttled: true, total: stored.items?.length || 0 };
  const date = sessionDate(now, market);
  const state = stored || { version: VERSION, experimentId: `${VERSION}-${market}-20260917`, market, observedOnly: true, startedAt: '2026-09-17', promotionLocked: true, items: [] };
  const pool = await candidatePool(market);
  const active = state.items.filter(item => item.date === date && item.outcomes?.rClose == null).slice(-8);
  const tickers = [...new Set([...pool.map(x => x.ticker), ...active.map(x => x.ticker)])].slice(0, 12);
  const quotes = {};
  await Promise.all(tickers.map(async ticker => { try { quotes[ticker] = await completedBars(ticker, now); } catch {} }));
  let changed = recordOutcomes(state.items, quotes, now, market);
  const morning = new Set(entries.filter(entry => entry.market === market && entry.date === date).flatMap(entry => [
    ...(entry.picks || []).map(p => p.ticker), ...(entry.dayCands || []).map(p => p.ticker), ...(entry.cands || []).map(p => p.ticker),
  ]));
  const existing = new Set(state.items.filter(item => item.date === date).map(item => item.ticker));
  const discoveries = pool.map(item => ({ ...item, signal: scoreScoutSignal({ market, bars: quotes[item.ticker] || [] }) }))
    .filter(item => item.signal.ok && !morning.has(item.ticker) && !existing.has(item.ticker))
    .sort((a, b) => b.signal.score - a.signal.score).slice(0, 5);
  for (const item of discoveries) {
    state.items.push({ id: `${date}:${item.ticker}`, date, ticker: item.ticker, name: item.name, discoveredAt: now, ...item.signal, observedOnly: true, orderCreated: false, outcomes: {} });
    changed = true;
  }
  state.items = state.items.filter(item => Date.parse(item.date) >= now - 40 * 86400000).slice(-500);
  state.lastRun = now;
  state.lastDiscoveryCount = discoveries.length;
  state.criteria = { intervalMinutes: 15, completedBarMinutes: 5, minVolumeRatio: 1.8, move15Pct: [0.8, 8], maxFromOpenPct: 12, promotion: 'locked until one-month review and minimum 30 samples' };
  try {
    await writeState(path, sha, state);
  } catch (error) {
    if (error.message === 'Scout write conflict' && options.conflictRetry !== true) return runIntradayScout(market, entries, Date.now(), { ...options, conflictRetry: true });
    throw error;
  }
  return { enabled: true, observedOnly: true, discovered: discoveries.length, total: state.items.length, updated: changed, promotionLocked: true };
}
