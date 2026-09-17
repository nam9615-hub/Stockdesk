import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreScoutSignal } from '../lib/intraday-scout.js';

const bars = Array.from({ length: 7 }, (_, i) => ({ at: i * 300000, open: 100 + i * .2, high: 101 + i * .2, low: 99 + i * .2, close: 100 + i * .5, volume: i === 6 ? 26000 : 10000 }));

test('scout accepts liquid volume expansion with bounded 15-minute momentum', () => {
  const result = scoreScoutSignal({ market: 'US', bars });
  assert.equal(result.ok, true);
  assert.ok(result.volumeRatio >= 1.8);
  assert.ok(result.move15Pct >= .8 && result.move15Pct <= 8);
});

test('scout rejects weak volume and short-term overheat', () => {
  assert.equal(scoreScoutSignal({ market: 'US', bars: bars.map(x => ({ ...x, volume: 10000 })) }).ok, false);
  const hot = bars.map((x, i) => ({ ...x, close: i < 4 ? 100 : 120 + i, volume: i === 6 ? 30000 : 10000 }));
  assert.equal(scoreScoutSignal({ market: 'US', bars: hot }).ok, false);
});
