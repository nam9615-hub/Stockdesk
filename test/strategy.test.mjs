import test from 'node:test';
import assert from 'node:assert/strict';
import { decideStrategy, replayPortfolio } from '../lib/strategy.js';
const rows=Array.from({length:60},(_,i)=>({close:100+i}));
test('durable trend supports longer but bounded swing',()=>{
  const d=decideStrategy({rows,price:159,atrPct:2,basis:['실적']});
  assert.equal(d.maxHoldDays,15);assert.equal(d.allowAutoOrder,false);
});
test('missing data, downtrend and excessive gap never authorize entry',()=>{
  for(const extra of [{rows:[]},{regime:'하락'},{gap:6}]) assert.equal(decideStrategy({rows,price:159,atrPct:2,basis:['실적'],...extra}).action,'watch');
});
test('day and swing are not silently interchangeable',()=>{
  const flat=Array.from({length:60},()=>({close:100}));
  assert.equal(decideStrategy({rows:flat,price:100,atrPct:2,basis:['거래량급증']}).strategy,'day-watch');
  assert.equal(decideStrategy({kind:'day',rows,price:159,atrPct:2}).maxHoldDays,0);
});
test('cash replay limits duplicate positions and closes only accepted entries',()=>{
  const p={ticker:'X',kind:'swing',b:100,simR:10,simD:'2026-01-02'};
  const r=replayPortfolio([{date:'2026-01-01',market:'US',picks:[p,p]}],'US',10000);
  assert.equal(r.nT,1);assert.equal(r.skipped,1);assert.equal(r.nOpen,0);assert.ok(r.cash>10000);
});
test('overlapping entries respect aggregate risk and mark missing prices',()=>{
  const r=replayPortfolio([{date:'2026-01-01',market:'US',picks:Array.from({length:30},(_,i)=>({ticker:String(i),kind:'swing',b:10}))}],'US',10000);
  assert.ok(r.nOpen<=4);assert.ok(r.cash>=0);assert.equal(r.unmarked,r.nOpen);
});
