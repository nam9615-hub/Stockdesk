import test from 'node:test';
import assert from 'node:assert/strict';
import {newAccount,queueCandidates,advanceAccount,entrySignal,accountSummary} from '../lib/paper.js';
const minute=60000,t0=Date.UTC(2026,8,15,0,0);
const plan={stopPct:5,targetPct:10,maxHoldDays:5,decision:{action:'conditional'}};
const candidate={id:'order-1',ticker:'X',name:'Example',kind:'swing',setup:'breakout',reference:100,plan};
const bars=Array.from({length:16},(_,i)=>({at:t0+i*5*minute,session:'2026-09-15',open:100,high:i===14?103:101,low:99,close:i===14?102:100,volume:i===14?300:100,sessionEnd:false}));
test('queuing is idempotent and does not change cash',()=>{
  const a=queueCandidates(queueCandidates(newAccount('US'),[candidate],t0),[candidate],t0);
  assert.equal(a.orders.length,1);assert.equal(a.cash,5000);assert.equal(a.fills.length,0);
});
test('signal uses completed evidence, fills at next open, and repeat invocation is idempotent',()=>{
  assert.equal(entrySignal(candidate,bars.slice(0,15)).ok,true);
  const a=advanceAccount(queueCandidates(newAccount('US'),[candidate],t0),{X:bars},t0+80*minute);
  assert.equal(a.fills.length,1);assert.equal(a.fills[0].at,bars[15].at);assert.equal(a.fills[0].price,100*1.001);
  assert.deepEqual(advanceAccount(a,{X:bars},t0+80*minute).fills,a.fills);assert.ok(a.cash>=0);
});
test('stale, incomplete, and pre-creation bars do not fill',()=>{
  const a=queueCandidates(newAccount('US'),[candidate],t0);
  assert.equal(advanceAccount(a,{X:bars},t0+200*minute).fills.length,0);
  assert.equal(advanceAccount(a,{X:bars.slice(0,15)},t0+74*minute).fills.length,0);
  assert.equal(advanceAccount(queueCandidates(newAccount('US'),[candidate],t0+80*minute),{X:bars},t0+80*minute).fills.length,0);
});
test('watch orders cannot buy and expire without being silently re-enabled',()=>{
  const c={...candidate,plan:{...plan,decision:{action:'watch'}}};
  const a=advanceAccount(queueCandidates(newAccount('US'),[c],t0),{X:bars},t0+49*3600000);
  assert.equal(a.fills.length,0);assert.equal(a.orders[0].state,'expired');
});
test('gap-through stop uses worse opening price, not the ideal stop',()=>{
  const a=advanceAccount(queueCandidates(newAccount('US'),[candidate],t0),{X:bars},t0+80*minute);
  const next={at:t0+80*minute,session:'2026-09-15',open:90,high:91,low:89,close:90,volume:100};
  const b=advanceAccount(a,{X:[...bars,next]},t0+85*minute);
  assert.equal(b.positions.length,0);assert.equal(b.fills.at(-1).price,90*.999);assert.ok(b.fills.at(-1).pnl<0);
});
test('paused state blocks entries but keeps protective exits active',()=>{
  const a=advanceAccount(queueCandidates(newAccount('US'),[candidate],t0),{X:bars},t0+80*minute);a.paused=true;
  const next={at:t0+80*minute,session:'2026-09-15',open:90,high:91,low:89,close:90,volume:100};
  const b=advanceAccount(a,{X:[...bars,next]},t0+85*minute);assert.equal(b.positions.length,0);assert.equal(accountSummary(b).paused,true);
});
test('partial target on final day bar also closes the remainder',()=>{
  const a=advanceAccount(queueCandidates(newAccount('US'),[candidate],t0),{X:bars},t0+80*minute);
  a.positions[0].kind='day';
  const next={at:t0+80*minute,session:'2026-09-15',open:108,high:112,low:107,close:110,volume:100,sessionEnd:true};
  const b=advanceAccount(a,{X:[...bars,next]},t0+85*minute);
  assert.equal(b.positions.length,0);assert.equal(b.fills.at(-1).reason,'session-close');
});
