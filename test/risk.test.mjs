import test from "node:test";
import assert from "node:assert/strict";
import { atrPctFromRows, buildRiskPlan } from "../lib/risk.js";

test("risk plan caps account risk and position weight", () => {
  const plan = buildRiskPlan({ kind: "swing", price: 10000, atrPct: 4, capital: 5000000, riskPct: 0.5 });
  assert.equal(plan.stopPct, 6);
  assert.equal(plan.targetPct, 12);
  assert.ok(plan.weightPct <= 10);
  assert.ok(plan.qty >= 0);
  assert.ok(plan.notional * plan.stopPct / 100 <= 25000);
});

test("day plan uses tighter bounded risk", () => {
  const plan = buildRiskPlan({ kind: "day", price: 25, atrPct: 8, capital: 5000, riskPct: 0.5 });
  assert.equal(plan.stopPct, 4);
  assert.equal(plan.targetPct, 5.4);
  assert.ok(plan.weightPct <= 8);
});

test("ATR percentage is derived from recent true ranges", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ close: 100 + i, high: 102 + i, low: 98 + i }));
  const atr = atrPctFromRows(rows);
  assert.ok(atr > 3 && atr < 4);
});

test("missing or invalid volatility uses the conservative fallback", () => {
  for (const atrPct of [null, undefined, "", 0, -1, NaN, Infinity]) {
    const plan = buildRiskPlan({ kind: "swing", price: 10000, atrPct, capital: 5000000 });
    assert.equal(plan.atrPct, 3.3);
    assert.equal(plan.stopPct, 4.95);
    assert.ok(plan.notional * plan.stopPct / 100 <= 25000);
  }
});
