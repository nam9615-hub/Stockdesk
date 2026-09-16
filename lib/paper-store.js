import { newAccount, queueCandidates, advanceAccount, accountSummary } from './paper.js';
import { krSession, krRegularBar, krSettlement } from './sessions.js';
const headers=()=>({Authorization:`Bearer ${process.env.GH_TOKEN}`,'User-Agent':'stockdesk',Accept:'application/vnd.github+json'});
export async function readPaper(market){
  if(!process.env.GH_TOKEN||!process.env.GH_REPO) throw new Error('GitHub storage is not configured');
  const r=await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/contents/data/paper-${market}.json`,{headers:headers(),signal:AbortSignal.timeout(10000)});
  if(r.status===404) return {account:null,sha:null};
  if(!r.ok) throw new Error(`Paper read failed (${r.status})`);
  const j=await r.json();const account=JSON.parse(Buffer.from(j.content,'base64').toString('utf8'));
  if(account.market!==market||!Array.isArray(account.orders)||!Array.isArray(account.positions)||!Number.isFinite(account.cash)) throw new Error('Paper state invalid: refusing to reset');
  return {account,sha:j.sha};
}
async function barsFor(ticker,now){
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=5m`,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(10000)});
  if(!r.ok) throw new Error(`Price feed failed (${r.status})`);
  const q=(await r.json()).chart?.result?.[0];if(!q?.timestamp) throw new Error('No timestamped price feed');
  const x=q.indicators.quote[0], zone=q.meta.exchangeTimezoneName;
  if(!zone) throw new Error('No exchange timezone');
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
  const periods=q.meta.currentTradingPeriod?.regular;
  return q.timestamp.map((t,i)=>({at:t*1000,open:x.open[i],high:x.high[i],low:x.low[i],close:x.close[i],volume:x.volume[i],session:formatter.format(new Date(t*1000)),
    sessionEnd:/\.(KS|KQ)$/i.test(ticker)?new Date(t*1000+9*3600000).getUTCHours()===15&&new Date(t*1000+9*3600000).getUTCMinutes()===25:periods && t>=periods.start && t<periods.end && t+300>=periods.end})).filter(b=>b.at+300000<=now && (!/\.(KS|KQ)$/i.test(ticker)||krRegularBar(b.at)));
}
export async function runPaper(market,entries,now=Date.now(),options={}){
  if(process.env.PAPER_TRADING_ENABLED!=='1') return {enabled:false};
  if(options.authorized!==true) throw new Error('Paper simulation requires an authorized monitor request');
  // Yahoo KR bars are not verified NXT data. Never fabricate extended-hours fills.
  if(market==='KR' && krSession(now)!=='krx-regular' && !krSettlement(now)) return {enabled:true,session:krSession(now),blocked:'NXT timestamped OHLCV and venue eligibility feed not connected'};
  const {account,sha}=await readPaper(market);
  if(account?.lastRun && now-account.lastRun<240000) return {enabled:true,throttled:true};
  const base=account||newAccount(market);
  const kst=new Date(now+9*3600000).toISOString().slice(0,10);
  const yesterday=new Date(now+9*3600000-86400000).toISOString().slice(0,10);
  // Never import old recommendations as historical fills. First activation is forward-only.
  const candidates=entries.filter(e=>e.market===market&&(e.date===kst||(market==='US'&&e.date===yesterday))).flatMap(e=>(e.picks||[]).filter(p=>p.plan?.decision).map(p=>({
    id:`P3:${e.date}:${p.ticker}:${p.kind}`,ticker:p.ticker,name:p.name,sector:p.sector,kind:p.kind,plan:p.plan,reference:p.b||p.p0,durable:(p.basis||[]).some(b=>['실적','수주계약','정책테마'].includes(b)),
    setup:p.kind==='day'?'opening':(p.basis||[]).includes('신고가')?'breakout':'pullback'})));
  const queued=queueCandidates(base,candidates,now);
  const accounts=[queued,...Object.values(base.shadows||{})];
  const tickers=[...new Set([...accounts.flatMap(a=>a.positions.map(p=>p.ticker)),...accounts.flatMap(a=>a.orders.filter(o=>o.state==='waiting'||o.state==='watch').map(o=>o.ticker))])].slice(0,12);
  const feeds={},errors=[];
  await Promise.all(tickers.map(async t=>{try{feeds[t]=await barsFor(t,now);}catch{errors.push(t);}}));
  const next=advanceAccount(queued,feeds,now);
  // Independent forward shadow accounts share the same candidates, bars and costs.
  // These are observations, not a strategy optimization or historical backtest.
  next.shadows=Object.fromEntries(['next-open','gap-filter','pullback'].map(setup=>{
    const shadowBase=base.shadows?.[setup]||newAccount(market);
    const shadowCandidates=candidates.map(c=>({...c,id:`${c.id}:shadow:${setup}`,setup}));
    return [setup,advanceAccount(queueCandidates(shadowBase,shadowCandidates,now),feeds,now)];
  }));
  next.feedErrors=errors;
  const bytes=Buffer.from(JSON.stringify(next));
  if(bytes.length>850000) throw new Error('Paper log archival required: refusing oversized write');
  const body={message:`paper: ${market} ${new Date(now).toISOString()}`,content:bytes.toString('base64'),...(sha?{sha}:{})};
  const r=await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/contents/data/paper-${market}.json`,{method:'PUT',headers:headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!r.ok) throw new Error(r.status===409?'Paper conflict: state preserved, retry on next run':`Paper write failed (${r.status})`);
  return {enabled:true,...accountSummary(next),feedErrors:errors.length};
}
