import React, {useEffect,useState} from 'react';
const money=(n,c)=>Number.isFinite(n)?new Intl.NumberFormat('ko-KR',{style:'currency',currency:c,maximumFractionDigits:c==='KRW'?0:2}).format(n):'—';
const setup={pullback:'눌림 회복',breakout:'가격대 돌파',opening:'개장 수급'};
const box={background:'#111a27',border:'1px solid #263346',borderRadius:14,padding:14};
const krPhase=()=>{
  const d=new Date(Date.now()+9*3600000),m=d.getUTCHours()*60+d.getUTCMinutes(),day=d.getUTCDay();
  if(day===0||day===6)return 'closed';
  if(m>=480&&m<530)return 'nxt-pre';
  if(m>=540&&m<930)return 'krx';
  if(m>=940&&m<1200)return 'nxt-after';
  return 'closed';
};
export default function PaperDesk(){
  const [market,setMarket]=useState('KR'),[data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[monitorError,setMonitorError]=useState('');
  useEffect(()=>{
    let active=true;setData(null);
    async function load(){setLoading(true);try{const r=await fetch(`/api/paper?market=${market}`);const j=await r.json();if(!r.ok)throw new Error(j.error||'조회 실패');if(active){setData(j);setError('');}}catch(e){if(active)setError(e.message);}finally{if(active)setLoading(false);}}
    async function monitor(){
      try{
        const r=await fetch('/api/monitor',{headers:{'x-stockdesk-client':'paper-desk'},cache:'no-store'});
        const j=await r.json();
        if(!r.ok)throw new Error(j.detail||j.error||'실행 실패');
        if(active){setMonitorError('');await load();}
      }catch(e){if(active)setMonitorError(e.message);}
    }
    load();monitor();
    const loadId=setInterval(load,60000),monitorId=setInterval(monitor,300000);
    return()=>{active=false;clearInterval(loadId);clearInterval(monitorId);};
  },[market]);
  const s=data?.summary;
  const ago=data?.lastRun?Math.floor((Date.now()-data.lastRun)/60000):null;
  const phase=market==='KR'?krPhase():null;
  const nxtPaused=phase==='nxt-pre'||phase==='nxt-after';
  const staleWarning=market==='KR'?phase==='krx'&&ago>15:ago>15;
  return <section aria-label="조건부 주문과 모의계좌" style={{background:'linear-gradient(140deg,#111e31,#0e141f)',border:'1px solid #293c56',borderRadius:22,padding:20,marginBottom:18}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}>
      <div><div style={{fontSize:10,letterSpacing:2,color:'#80c6ff'}}>PAPER COMMAND CENTER</div><h2 style={{fontSize:22,margin:'7px 0'}}>오늘의 판단</h2></div>
      <div style={{display:'flex',gap:4}}>{['KR','US'].map(m=><button key={m} aria-pressed={market===m} onClick={()=>setMarket(m)} style={{padding:'8px 10px',borderRadius:9,border:'1px solid #314561',background:market===m?'#203b5c':'transparent',color:'#e8edf5',cursor:'pointer'}}>{m==='KR'?'국내':'미국'}</button>)}</div>
    </div>
    <div style={{color:'#96a7bf',fontSize:12,lineHeight:1.7,marginBottom:14}}>실계좌 주문 없음 · AI 설명보다 확인된 조건을 우선합니다.</div>
    <div style={{color:'#96a7bf',fontSize:11,lineHeight:1.7,marginBottom:12}}>앱 접속 중 5분마다 반복 판단 · 완료된 5분봉 기준{market==='KR'?' / NXT 프리 08:00–08:50 · 애프터 15:40–20:00: 전용 시세 미연결, 체결 보류':''}</div>
    {monitorError&&<div role="alert" style={{...box,color:'#f5b94a',marginBottom:8}}>장중 모니터 실행 실패: {monitorError}</div>}
    {error&&<div role="alert" style={{...box,color:'#f5b94a'}}>{error} · 기존 기록을 초기화하지 않습니다.</div>}
    {!data&&!error&&<div role="status">{loading?'모의계좌 확인 중…':'데이터 대기'}</div>}
    {data&&<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>
        <div style={box}><div style={{fontSize:11,color:'#96a7bf'}}>모의 평가자산</div><div style={{fontSize:20,fontWeight:700,marginTop:6}}>{money(s.equity,s.currency)}</div><div style={{fontSize:12,color:s.returnPct>=0?'#3ddc97':'#ff8a8a',marginTop:4}}>{s.returnPct.toFixed(2)}% · 시작 이후</div></div>
        <div style={box}><div style={{fontSize:11,color:'#96a7bf'}}>사용 가능한 현금</div><div style={{fontSize:20,fontWeight:700,marginTop:6}}>{money(s.cash,s.currency)}</div><div style={{fontSize:12,color:'#96a7bf',marginTop:4}}>보유 {s.positions} · 대기 {s.waiting}</div></div>
      </div>
      <div role="status" style={{fontSize:12,color:!data.enabled||staleWarning?'#f5b94a':'#96a7bf',margin:'12px 0',lineHeight:1.7}}>
        {!data.enabled?'모의 실행 꺼짐 · PAPER_TRADING_ENABLED=1 설정과 인증된 모니터 호출이 필요합니다.':!data.initialized?'첫 인증된 모니터 실행을 기다립니다.':s.paused?'손실 방어: 신규 진입 중단 · 기존 포지션 청산 감시 유지':nxtPaused?`NXT ${phase==='nxt-pre'?'프리':'애프터'}마켓 · 전용 시세 미연결로 체결 보류 · 정규장 마지막 기록 ${ago}분 전 · 모니터 호출 정상`:market==='KR'&&phase==='closed'?`장외 시간 · 정규장 마지막 기록 ${ago}분 전`: `마지막 실행 ${ago}분 전 · ${staleWarning?'스케줄·데이터 확인 필요':'기록 저장됨'}`}
        {!!data.feedErrors.length&&<div>가격 조회 실패 {data.feedErrors.length}종목 · 해당 종목 체결 보류</div>}
      </div>
      <h3 style={{fontSize:14,margin:'18px 0 8px'}}>보유 관리</h3>
      {!data.positions.length?<div style={{fontSize:12,color:'#96a7bf'}}>아직 조건을 충족해 매수한 종목이 없습니다.</div>:data.positions.map(p=><div key={p.id} style={{...box,marginBottom:8,lineHeight:1.7,fontSize:12}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:8}}><b>{p.name||p.ticker}</b><span>{p.qty}주 · {setup[p.setup]}</span></div>
        <div style={{color:'#96a7bf'}}>진입 {money(p.entry,s.currency)} · 평가 {money(p.mark,s.currency)}</div>
        <div>방어 {money(p.stop,s.currency)} · 목표 {money(p.target,s.currency)}</div>
        <div style={{color:'#80c6ff'}}>{p.kind==='day'?'당일 청산 원칙':`${p.sessions.length}/${p.maxHoldDays}관측 거래일 · ${p.extended?'연장 1회 적용':'최대 기한 적용'}`} {p.partial?'· 부분 익절 완료':''}</div>
        <div style={{color:'#96a7bf',fontSize:10}}>평가 시각 {new Date(p.markAt).toLocaleString('ko-KR')} · 현재가 보장 아님</div>
      </div>)}
      <h3 style={{fontSize:14,margin:'18px 0 8px'}}>대기 기회</h3>
      {!data.orders.length?<div style={{fontSize:12,color:'#96a7bf'}}>새 정책의 추천이 나오면 조건부 대기 목록에 기록됩니다.</div>:data.orders.filter(o=>o.state!=='expired').slice(-5).map(o=><div key={o.id} style={{...box,marginBottom:6,fontSize:12,lineHeight:1.7}}>
        <b>{o.name||o.ticker}</b> · {setup[o.setup]} · {o.state==='watch'?'정책 보류':'조건 확인 중'}
        <div style={{color:'#96a7bf'}}>{o.lastReason||o.plan.decision.reasons[0]}</div>
      </div>)}
      <details style={{fontSize:12,color:'#96a7bf',marginTop:16,lineHeight:1.8}}><summary style={{cursor:'pointer'}}>판단 기록·전략 성적·놓친 기회</summary>
        <div>실현손익 {money(s.realizedPnl,s.currency)} · 청산 체결 {s.exitFills}건 · 부분 청산은 독립 거래 승률이 아닙니다.</div>
        <div>관측 평가 기준 최대 낙폭 {s.maxDrawdownPct.toFixed(2)}% · 미관측 장중 낙폭 제외</div>
        {Object.entries(data.comparisons||{}).map(([k,v])=><div key={k}>{k==='next-open'?'다음 관측 봉 진입':k==='gap-filter'?'갭 제한 진입':'눌림 확인 진입'}: {v.returnPct.toFixed(2)}% / 청산 체결 {v.exitFills}건 · 동일 후보 비교 관찰</div>)}
        {Object.entries(s.bySetup||{}).map(([k,v])=><div key={k}>{setup[k]}: 청산 체결 {v.exitFills}건 / {money(v.pnl,s.currency)} · 표본 확보 전 우열 판단 금지</div>)}
        {data.events.slice(-8).reverse().map((e,i)=><div key={i}>{new Date(e.at).toLocaleString('ko-KR')} · {e.reason}</div>)}
        <div style={{marginTop:10}}>비매수 종목 관측 (잡을 수 있었던 수익을 뜻하지 않음)</div>
        {data.observations.slice(-5).map((o,i)=><div key={i}>{o.ticker}: {o.returnPct.toFixed(1)}% · {o.reason}</div>)}
        <div style={{marginTop:10}}>모의 체결: 다음 5분봉 시가·슬리피지·수수료. 동일 봉은 손절 우선. 실제 유동성·호가 체결을 재현하지 않습니다.</div>
      </details>
    </>}
  </section>;
}
