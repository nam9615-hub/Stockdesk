// Forward-only simulated orders. Independent of historical recommendation grading.
export const PAPER_VERSION = 'P3.0';
export function newAccount(market) {
  const initial = market === 'KR' ? 5000000 : 5000;
  return {version:PAPER_VERSION,market,currency:market==='KR'?'KRW':'USD',initial,cash:initial,orders:[],positions:[],fills:[],events:[],observations:[],paused:false,lastRun:null};
}
const finite = n => Number.isFinite(n) && n > 0;
const fee = m => m === 'KR' ? 0.00125 : 0.0005;
const note = (a,type,id,at,reason) => a.events.push({type,id,at,reason});
export function queueCandidates(account, candidates, now) {
  const a=structuredClone(account);
  for(const c of candidates){
    if(a.orders.some(o=>o.id===c.id)) continue;
    const p=c.plan;
    if(!p?.decision || !finite(c.reference) || !finite(p.stopPct) || !finite(p.targetPct)) continue;
    const state=p.decision.action==='watch'?'watch':'waiting';
    a.orders.push({...c,state,createdAt:now,expiresAt:now+(c.kind==='day'?8:48)*3600000,lastBar:now,attempts:0});
    note(a,'queued',c.id,now,state==='watch'?'정책 보류':'조건부 진입 대기');
  }
  return a;
}

export function entrySignal(order, bars) {
  // Shadow comparisons enter only after at least one observed post-creation bar.
  if(order.setup==='next-open'||order.setup==='gap-filter') {
    if(!bars.length) return {ok:false,reason:'주문 이후 관측 대기'};
    const b=bars.at(-1),s=bars.filter(x=>x.session===b.session);
    const safe=(s[0].open/order.reference-1)*100<5 && b.close<=order.reference*1.05;
    return {ok:order.setup==='next-open'||safe,reason:order.setup==='next-open'?'비교군: 다음 관측 봉 진입':'비교군: 갭·추격 제한'};
  }
  if(bars.length<4) return {ok:false,reason:'개장 데이터 부족'};
  const b=bars.at(-1),prev=bars.at(-2),session=bars.filter(x=>x.session===b.session);
  if(session.length<3) return {ok:false,reason:'세션 확인 대기'};
  const opening=session[0].open;
  const gap=(opening/order.reference-1)*100;
  if(gap>=5 || b.close>order.reference*1.05) return {ok:false,reason:'갭·추격 과열'};
  if(b.close<opening*0.98) return {ok:false,reason:'시가 붕괴'};
  const before=bars.slice(0,-1);
  const avgVolume=before.slice(-10).reduce((s,x)=>s+x.volume,0)/Math.min(10,before.length);
  const vwap=session.reduce((s,x)=>s+x.close*x.volume,0)/session.reduce((s,x)=>s+x.volume,0);
  if(!finite(vwap) || !finite(avgVolume)) return {ok:false,reason:'거래량 데이터 부족'};
  if(order.setup==='opening') {
    const rangeHigh=Math.max(...session.slice(0,2).map(x=>x.high));
    return {ok:b.close>rangeHigh && b.close>vwap && b.volume>=avgVolume,reason:'개장 범위·VWAP·거래량 확인'};
  }
  if(order.setup==='breakout') {
    if(before.length<12) return {ok:false,reason:'돌파 기준 데이터 부족'};
    const resistance=Math.max(...before.slice(-12).map(x=>x.high));
    return {ok:b.close>resistance && b.volume>=avgVolume*1.2,reason:'직전 가격대 돌파·거래량 확인'};
  }
  return {ok:prev.low<=vwap && b.close>vwap && b.close>prev.close && b.volume>=avgVolume,reason:'VWAP 눌림 후 회복 확인'};
}

export function advanceAccount(account, feeds, now) {
  const a=structuredClone(account);
  function sell(p,qty,px,at,reason){
    const proceeds=qty*px*(1-fee(a.market));
    a.cash+=proceeds;
    const pnl=proceeds-qty*p.entry*(1+fee(a.market));
    a.fills.push({id:`${p.id}:sell:${at}:${qty}`,orderId:p.id,ticker:p.ticker,side:'sell',qty,price:px,at,reason,pnl,setup:p.setup});
    p.qty-=qty;note(a,'exit',p.id,at,reason);
  }
  // Merge all tickers into one clock; never reuse future proceeds for an earlier entry.
  const prepared=[];
  for(const [ticker,raw] of Object.entries(feeds)){
    const bars=raw.filter(b=>b.at+300000<=now && finite(b.open)&&finite(b.close)&&finite(b.high)&&finite(b.low)&&b.high>=b.low&&b.low<=b.open&&b.high>=b.open&&b.low<=b.close&&b.high>=b.close&&finite(b.volume)).sort((x,y)=>x.at-y.at);
    if(!bars.length || now-(bars.at(-1).at+300000)>20*60000) continue;
    prepared.push({ticker,bars});
  }
  const timeline=prepared.flatMap(({ticker,bars})=>bars.map((_,i)=>({ticker,bars,i}))).sort((x,y)=>x.bars[x.i].at-y.bars[y.i].at || x.ticker.localeCompare(y.ticker));
  for(const {ticker,bars,i} of timeline){
      const b=bars[i];
      for(const p of a.positions.filter(p=>p.ticker===ticker&&p.qty>0)){
        if(b.at<=p.lastBar) continue;
        if(!p.sessions.includes(b.session)) p.sessions.push(b.session);
        p.mark=b.close;p.markAt=b.at+300000;p.lastBar=b.at;
        // Gap exits use the worse opening price; stop-first when bar order is unknown.
        if(p.kind==='day' && b.session!==p.sessions[0]) sell(p,p.qty,b.open*.999,b.at,'overdue-day-exit');
        else if(b.low<=p.stop) sell(p,p.qty,Math.min(b.open,p.stop)*0.999,b.at,'stop');
        else if(b.high>=p.target && !p.partial){
          const qty=p.qty>1?Math.floor(p.qty/2):p.qty;
          sell(p,qty,p.target*0.999,b.at,'partial-target');p.partial=true;
        }
        if(p.qty>0 && p.kind==='day' && b.sessionEnd) sell(p,p.qty,b.close*0.999,b.at+300000,'session-close');
        else if(p.qty>0 && p.kind!=='day' && p.sessions.length>=p.maxHoldDays && b.sessionEnd) {
          const recent=[...new Set(bars.slice(0,i+1).map(x=>x.session))].slice(-3).map(s=>bars.slice(0,i+1).filter(x=>x.session===s).at(-1)?.close);
          if(p.durable && !p.extended && p.maxHoldDays<20 && recent.length===3 && recent[2]>recent[1] && recent[1]>recent[0] && b.close>p.entry*1.02){
            p.extended=true;p.maxHoldDays=Math.min(20,p.maxHoldDays+5);note(a,'extend',p.id,b.at,'지속 재료 코드·3세션 상승·수익권: 한 번만 최대 5일 연장');
          }else sell(p,p.qty,b.close*0.999,b.at+300000,'time');
        }
        if(p.qty>0 && p.partial) p.stop=Math.max(p.stop,b.close*(1-p.stopPct/100));
        if(p.qty>0 && p.sessions.length>=3 && !p.reviewed && b.sessionEnd){
          p.reviewed=true;
          if(b.close<p.entry && !p.partial) sell(p,p.qty,b.close*.999,b.at+300000,'no-progress');
          else note(a,'review',p.id,b.at,'3거래일 재검토: 수익·기한·방어선 유지');
        }
      }
      a.positions=a.positions.filter(p=>p.qty>0);
      for(const o of a.orders.filter(o=>o.ticker===ticker&&o.state==='waiting')){
        if(a.paused) continue;
        if(b.at<=o.lastBar || b.at<o.createdAt) continue;
        o.lastBar=b.at;
        if(b.at>=o.expiresAt){o.state='expired';note(a,'expired',o.id,b.at,'신호 유효기간 종료');continue;}
        const previous=bars.slice(0,i).filter(x=>x.at>=o.createdAt && x.session===b.session);
        const signal=entrySignal(o,previous);
        o.lastReason=signal.reason;
        if(!signal.ok || b.sessionEnd) continue;
        if(o.setup!=='next-open'&&b.open>o.reference*1.05){o.lastReason='체결시점 가격 과열';continue;}
        const px=b.open*1.001, equity=a.cash+a.positions.reduce((s,p)=>s+p.qty*(p.mark||p.entry),0);
        if(equity<a.initial*.90){a.paused=true;note(a,'pause',o.id,b.at,'초기자금 대비 10% 손실: 신규 진입 중단, 청산 감시는 유지');continue;}
        if(a.fills.some(f=>f.ticker===ticker&&f.side==='sell'&&f.at>=b.at-86400000)){o.lastReason='청산 후 24시간 재진입 대기';continue;}
        const risk=a.positions.reduce((s,p)=>s+p.qty*p.entry*p.stopPct/100,0);
        const sectorExposure=a.positions.filter(p=>o.sector&&p.sector===o.sector).reduce((s,p)=>s+p.qty*(p.mark||p.entry),0);
        const budget=Math.min(a.cash/(1+fee(a.market)),equity*(o.kind==='day'?.08:.10),equity*.005/(o.plan.stopPct/100),Math.max(0,equity*.02-risk)/(o.plan.stopPct/100),Math.max(0,equity*.25-sectorExposure));
        const qty=Math.floor(budget/px);
        if(qty<1 || a.positions.length>=8 || a.positions.some(p=>p.ticker===ticker)){o.lastReason='현금·총 위험·중복·업종 한도';continue;}
        a.cash-=qty*px*(1+fee(a.market));o.state='filled';o.filledAt=b.at;
        a.positions.push({id:o.id,ticker,name:o.name,sector:o.sector,kind:o.kind,setup:o.setup,durable:o.durable,qty,initialQty:qty,entry:px,entryAt:b.at,mark:px,markAt:b.at,stop:px*(1-o.plan.stopPct/100),target:px*(1+o.plan.targetPct/100),stopPct:o.plan.stopPct,maxHoldDays:o.plan.maxHoldDays||20,sessions:[b.session],lastBar:b.at-1,partial:false});
        a.fills.push({id:`${o.id}:buy`,orderId:o.id,ticker,side:'buy',qty,price:px,at:b.at,reason:signal.reason,setup:o.setup});
        note(a,'entry',o.id,b.at,signal.reason);
        // Do not use pre-entry history. Handle this next-open candle conservatively.
        const pos=a.positions.find(p=>p.id===o.id);
        if(b.low<=pos.stop){sell(pos,pos.qty,Math.min(b.open,pos.stop)*.999,b.at,'entry-bar-stop');a.positions=a.positions.filter(p=>p.qty>0);}
        else {pos.mark=b.close;pos.markAt=b.at+300000;pos.lastBar=b.at;}
      }
  }
  for(const {ticker,bars} of prepared){
    // Record opportunity outcomes without reopening expired or rejected orders.
    const latest=bars.at(-1);
    for(const o of a.orders.filter(o=>o.ticker===ticker&&o.state!=='filled')){
      if(!a.observations.some(x=>x.id===o.id&&x.session===latest.session)) a.observations.push({id:o.id,ticker,session:latest.session,at:latest.at+300000,returnPct:(latest.close/o.reference-1)*100,reason:o.lastReason||o.state});
    }
  }
  for(const o of a.orders.filter(o=>['waiting','watch'].includes(o.state)&&now>=o.expiresAt)){o.state='expired';note(a,'expired',o.id,now,'유효기간 종료');}
  a.lastRun=now;
  const equity=a.cash+a.positions.reduce((s,p)=>s+p.qty*(p.mark||p.entry),0);
  a.peakEquity=Math.max(a.peakEquity||a.initial,equity);
  a.maxDrawdownPct=Math.max(a.maxDrawdownPct||0,(1-equity/a.peakEquity)*100);
  return a;
}

export function accountSummary(a){
  const equity=a.cash+a.positions.reduce((s,p)=>s+p.qty*(p.mark||p.entry),0);
  const sells=a.fills.filter(f=>f.side==='sell'),wins=sells.filter(f=>f.pnl>0),loss=sells.filter(f=>f.pnl<0);
  return {equity,cash:a.cash,returnPct:(equity/a.initial-1)*100,realizedPnl:sells.reduce((s,f)=>s+f.pnl,0),profitFactor:loss.length?wins.reduce((s,f)=>s+f.pnl,0)/Math.abs(loss.reduce((s,f)=>s+f.pnl,0)):null,
    waiting:a.orders.filter(o=>o.state==='waiting').length,positions:a.positions.length,exitFills:sells.length,mode:'forward-paper',currency:a.currency,paused:a.paused,maxDrawdownPct:a.maxDrawdownPct||0,
    bySetup:Object.fromEntries(['pullback','breakout','opening'].map(s=>{const x=sells.filter(f=>f.setup===s);return [s,{exitFills:x.length,pnl:x.reduce((v,f)=>v+f.pnl,0)}];}))};
}
