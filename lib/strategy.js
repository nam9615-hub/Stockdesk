// Advisory policy only. No broker orders and no claim of calibrated probabilities.
export function decideStrategy({ kind = 'swing', basis = [], rows = [], price, atrPct, gap = null, regime = null }) {
  const valid = rows.filter(r => Number.isFinite(r.close) && r.close > 0);
  const durable = basis.some(b => ['실적', '수주계약', '정책테마'].includes(b));
  const momentum = basis.some(b => ['거래량급증', '신고가', '추세지속'].includes(b));
  const closes = valid.map(r => r.close);
  const mean = n => closes.slice(-n).reduce((a,b) => a+b,0) / n;
  const trend = closes.length >= 60 && mean(20) > mean(60) && closes.at(-1) > mean(20);
  const reasons = [];
  let action = 'conditional', strategy = kind;
  if (!(price > 0) || valid.length < 20 || !(atrPct > 0)) {
    action = 'watch'; reasons.push('가격·변동성 데이터 부족: 신규 진입 보류');
  }
  if (regime === '하락') { action = 'watch'; reasons.push('하락 국면: 신규 진입 보류'); }
  if (gap != null && gap >= 5) { action = 'watch'; reasons.push('갭 과열: 추격 진입 금지'); }
  if (kind === 'swing' && !durable && !trend) {
    action = 'watch'; strategy = momentum ? 'day-watch' : 'watch';
    reasons.push(momentum ? '단기 수급만 확인: 단타 재평가 후보, 자동 전환 아님' : '지속 재료·추세 확인 전 관찰');
  }
  const days = kind === 'day' ? 0 : durable && trend ? 15 : durable ? 10 : 5;
  if (!reasons.length) reasons.push(kind === 'day' ? '개장 후 가격·수급 확인이 필요한 당일 전략' : durable && trend ? '지속 재료와 중기 추세가 함께 확인됨' : durable ? '재료 지속성 확인, 짧은 주기로 추세 재평가' : '추세 중심의 짧은 스윙');
  return { version: 'S2.0', action, strategy, reasons, plannedHoldDays: days,
    reviewAfterDays: kind === 'day' ? 0 : Math.min(days, 3), maxHoldDays: days,
    entryRule: kind === 'day' ? '확정 시점 이후 가격만 사용 · 갭 과열·시가 붕괴 시 보류' : '개장 후 지지·추세 확인 · 추천시점 가격에서 급등하면 추격 금지',
    exitRule: kind === 'day' ? '손절·목표 중 먼저 도달한 조건 또는 당일 종가' : '손절·목표 중 먼저 도달한 조건 또는 보유 기한 · 추세 훼손 시 재검토',
    allowAutoOrder: false };
}

// Cash-constrained historical replay, not an actual fills ledger.
// No invented pre-entry bars; returns use stored outcomes and expose ambiguity.
export function replayPortfolio(entries, market, capital = 5000000) {
  const costPct = market === 'KR' ? 0.25 : 0.10;
  const events = [], positions = new Map(), skipped = [], trades = [];
  let cash = capital;
  const picks = entries.filter(e => e.market === market).sort((a,b) => a.date.localeCompare(b.date));
  picks.forEach(e => (e.picks || []).forEach((p,i) => {
    const id = `${e.date}:${p.ticker}:${i}`;
    events.push({ day:e.date, type:'buy', id, p });
    if (Number.isFinite(p.simR) && p.simD && p.simD >= e.date) events.push({day:p.simD,type:'sell',id,p});
  }));
  // Entry first on the same date: do not assume intraday proceeds are reusable.
  events.sort((a,b) => a.day.localeCompare(b.day) || (a.type === b.type ? 0 : a.type === 'buy' ? -1 : 1));
  for (const e of events) {
    const p=e.p;
    if (e.type==='buy') {
      const px=Number(p.b || p.p0), stop=Number(p.plan?.stopPct || (p.kind==='day'?3:5));
      const weight=Number(p.plan?.maxWeightPct || (p.kind==='day'?8:10));
      const equity=cash+[...positions.values()].reduce((s,x)=>s+x.notional,0);
      const totalRisk=[...positions.values()].reduce((s,x)=>s+x.notional*x.stop/100,0);
      const budget=Math.min(cash, equity*weight/100, equity*0.005/(stop/100), Math.max(0,equity*0.02-totalRisk)/(stop/100));
      const qty=Math.floor(budget/px);
      const duplicate=[...positions.values()].some(x=>x.ticker===p.ticker);
      if (!(px>0) || !(qty>0) || duplicate || positions.size>=8 || p.plan?.decision?.action==='watch') {
        skipped.push({id:e.id,reason:duplicate?'중복 보유':p.plan?.decision?.action==='watch'?'정책 보류':'현금·위험·가격 한도'}); continue;
      }
      const notional=qty*px; cash-=notional;
      positions.set(e.id,{ticker:p.ticker,notional,qty,stop,p});
    } else {
      const pos=positions.get(e.id); if(!pos) continue;
      const proceeds=pos.notional*(1+(p.simR-costPct)/100);
      cash+=proceeds;positions.delete(e.id);trades.push({...pos,net:p.simR-costPct});
    }
  }
  const open=[...positions.values()];
  const evalEq=cash+open.reduce((s,x)=>s+x.notional*(1+(Number.isFinite(x.p.simOpen)?x.p.simOpen:0)/100),0);
  return { start:capital, cash, evalEq:Math.round(evalEq), ret:+((evalEq/capital-1)*100).toFixed(2), nT:trades.length,nOpen:open.length,wins:trades.filter(t=>t.net>0).length,skipped:skipped.length,
    unmarked:open.filter(x=>!Number.isFinite(x.p.simOpen)).length,mode:'historical-replay' };
}
