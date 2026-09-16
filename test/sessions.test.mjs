import test from 'node:test';
import assert from 'node:assert/strict';
import {krSession,krRegularBar} from '../lib/sessions.js';
import {entrySignal} from '../lib/paper.js';
const at=(h,m)=>Date.UTC(2026,8,16,h-9,m);
test('KR session boundaries distinguish NXT execution and breaks',()=>{
  for(const [h,m,value] of [[8,0,'nxt-pre'],[8,50,'closed'],[9,0,'krx-regular'],[15,30,'closed'],[15,39,'closed'],[15,40,'nxt-after'],[20,0,'closed']]) assert.equal(krSession(at(h,m)),value);
  assert.equal(krSession(Date.UTC(2026,8,19,1)), 'closed');
  assert.equal(krRegularBar(at(15,25)),true);assert.equal(krRegularBar(at(15,28)),false);
});
test('midday opening candidates can use a fresh breakout',()=>{
  const bars=Array.from({length:15},(_,i)=>({at:at(11,i*5),session:'day',open:100,high:i===0?104:101,low:99,close:100,volume:100}));
  bars.at(-1).close=102;bars.at(-1).high=103;bars.at(-1).volume=300;
  const r=entrySignal({setup:'opening',reference:100},bars);
  assert.equal(r.ok,true);assert.match(r.reason,/장중/);
});
