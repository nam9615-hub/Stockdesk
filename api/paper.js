import { readPaper } from '../lib/paper-store.js';
import { accountSummary, newAccount } from '../lib/paper.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Read-only paper endpoint'});
  const market=String(req.query.market||'KR').toUpperCase();
  if(!['KR','US'].includes(market)) return res.status(400).json({error:'Invalid market'});
  try{
    const {account}=await readPaper(market);
    const a=account||newAccount(market);
    return res.status(200).json({enabled:process.env.PAPER_TRADING_ENABLED==='1',initialized:!!account,summary:accountSummary(a),comparisons:Object.fromEntries(Object.entries(a.shadows||{}).map(([k,v])=>[k,accountSummary(v)])),positions:a.positions,orders:a.orders.filter(o=>['waiting','watch','expired'].includes(o.state)).slice(-30),events:a.events.slice(-30),fills:a.fills.slice(-30),observations:a.observations.slice(-30),lastRun:a.lastRun,feedErrors:a.feedErrors||[]});
  }catch{return res.status(503).json({error:'모의계좌 저장소 조회 실패 · 설정과 권한 확인 필요'});}
}
