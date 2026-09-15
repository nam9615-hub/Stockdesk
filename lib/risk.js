// StockDesk deterministic risk engine.
// AI chooses candidates; this module alone decides risk limits and suggested size.
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function atrPctFromRows(rows, period = 14) {
  const clean = (rows || []).filter((r) => r && r.high > 0 && r.low > 0 && r.close > 0);
  if (clean.length < period + 1) return null;
  const tr = [];
  for (let i = clean.length - period; i < clean.length; i++) {
    const prev = clean[i - 1]?.close || clean[i].close;
    tr.push(Math.max(clean[i].high - clean[i].low, Math.abs(clean[i].high - prev), Math.abs(clean[i].low - prev)));
  }
  const atr = tr.reduce((a, b) => a + b, 0) / tr.length;
  return +(atr / clean.at(-1).close * 100).toFixed(2);
}

export function buildRiskPlan({ kind, price, atrPct, capital, riskPct = 0.5 }) {
  const isDay = kind === "day";
  const px = Number(price), cap = Number(capital);
  const vol = Number.isFinite(+atrPct) ? +atrPct : (isDay ? 2.2 : 3.3);
  const stopPct = isDay ? clamp(Math.max(1.8, vol * 0.9), 1.8, 4.0) : clamp(Math.max(4.0, vol * 1.5), 4.0, 9.0);
  const rr = isDay ? 1.35 : 2.0;
  const targetPct = clamp(stopPct * rr, isDay ? 2.5 : 8.0, isDay ? 7.0 : 20.0);
  const maxWeightPct = isDay ? 8 : 10;
  const safeRiskPct = clamp(+riskPct || 0.5, 0.1, 1.0);
  const riskBudget = Number.isFinite(cap) && cap > 0 ? cap * safeRiskPct / 100 : null;
  const maxNotional = Number.isFinite(cap) && cap > 0 ? cap * maxWeightPct / 100 : null;
  const riskNotional = riskBudget == null ? null : riskBudget / (stopPct / 100);
  const notional = riskNotional == null ? null : Math.min(riskNotional, maxNotional);
  const qty = notional != null && Number.isFinite(px) && px > 0 ? Math.max(0, Math.floor(notional / px)) : null;
  const actualNotional = qty == null || !Number.isFinite(px) ? notional : qty * px;
  const weightPct = actualNotional != null && Number.isFinite(cap) && cap > 0 ? actualNotional / cap * 100 : maxWeightPct;
  return { engine: "R1.0", strategy: isDay ? "day" : "swing", atrPct: +vol.toFixed(2), stopPct: +stopPct.toFixed(2), targetPct: +targetPct.toFixed(2), rr: +rr.toFixed(2), maxHoldDays: isDay ? 0 : 20, riskPct: +safeRiskPct.toFixed(2), maxWeightPct, weightPct: +weightPct.toFixed(2), qty, notional: actualNotional == null ? null : Math.round(actualNotional) };
}
