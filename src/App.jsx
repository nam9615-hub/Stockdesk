import React, { useState, useMemo, useEffect, useRef } from "react";

/* ─────────────────────────────────────────────
   STOCK DESK — 매수·매도·재진입 종합 분석기
   일봉 기반 스윙(2~4주) 참고 도구 · 투자 권유 아님
   ───────────────────────────────────────────── */

/* ========== 유틸 ========== */
const fmt = (n, d = 0) =>
  n == null || isNaN(n) ? "—" : Number(n).toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (n, d = 1) => (n == null || isNaN(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`);

// 시드 기반 난수 (티커별 동일한 데모 데이터)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const strSeed = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/* ========== 지표 계산 ========== */
const sma = (arr, p) => arr.map((_, i) => (i < p - 1 ? null : arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p));
function ema(arr, p) {
  const k = 2 / (p + 1), out = [];
  let prev = null;
  arr.forEach((v, i) => {
    if (i < p - 1) { out.push(null); return; }
    if (prev == null) prev = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
    else prev = v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}
function rsi(close, p = 14) {
  const out = [null];
  let ag = 0, al = 0;
  for (let i = 1; i < close.length; i++) {
    const ch = close[i] - close[i - 1];
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= p) { ag += g / p; al += l / p; out.push(i === p ? 100 - 100 / (1 + (al === 0 ? 100 : ag / al)) : null); }
    else {
      ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p;
      out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    }
  }
  return out;
}
function atr(high, low, close, p = 14) {
  const tr = high.map((h, i) => (i === 0 ? h - low[0] : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]))));
  const out = [];
  let prev = null;
  tr.forEach((v, i) => {
    if (i < p) { out.push(null); if (i === p - 1) prev = tr.slice(0, p).reduce((a, b) => a + b, 0) / p; }
    else { prev = (prev * (p - 1) + v) / p; out.push(prev); }
  });
  return out;
}
function adx(high, low, close, p = 14) {
  const len = high.length;
  const pdm = [0], ndm = [0], tr = [high[0] - low[0]];
  for (let i = 1; i < len; i++) {
    const up = high[i] - high[i - 1], dn = low[i - 1] - low[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  const smooth = (arr) => {
    const out = []; let s = null;
    arr.forEach((v, i) => {
      if (i < p) { out.push(null); if (i === p - 1) s = arr.slice(0, p).reduce((a, b) => a + b, 0); }
      else { s = s - s / p + v; out.push(s); }
    });
    return out;
  };
  const sTR = smooth(tr), sP = smooth(pdm), sN = smooth(ndm);
  const pdi = sTR.map((t, i) => (t ? (100 * sP[i]) / t : null));
  const ndi = sTR.map((t, i) => (t ? (100 * sN[i]) / t : null));
  const dx = pdi.map((pv, i) => (pv == null ? null : (100 * Math.abs(pv - ndi[i])) / Math.max(pv + ndi[i], 1e-9)));
  const out = []; let a = null;
  dx.forEach((v, i) => {
    if (v == null) { out.push(null); return; }
    const valid = dx.slice(0, i + 1).filter((x) => x != null);
    if (valid.length < p) { out.push(null); if (valid.length === p - 1) a = null; }
    else { a = a == null ? valid.slice(-p).reduce((x, y) => x + y, 0) / p : (a * (p - 1) + v) / p; out.push(a); }
  });
  return { adx: out, pdi, ndi };
}
function macd(close, f = 12, s = 26, sig = 9) {
  const ef = ema(close, f), es = ema(close, s);
  const line = close.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const valid = line.map((v) => v ?? 0);
  const sgl = ema(valid, sig).map((v, i) => (line[i] == null ? null : v));
  const hist = line.map((v, i) => (v != null && sgl[i] != null ? v - sgl[i] : null));
  return { line, signal: sgl, hist };
}
function bollinger(close, p = 20, k = 2) {
  const mid = sma(close, p);
  const up = [], dn = [], pb = [], bw = [];
  close.forEach((c, i) => {
    if (mid[i] == null) { up.push(null); dn.push(null); pb.push(null); bw.push(null); return; }
    const seg = close.slice(i - p + 1, i + 1);
    const sd = Math.sqrt(seg.reduce((a, b) => a + (b - mid[i]) ** 2, 0) / p);
    const u = mid[i] + k * sd, d = mid[i] - k * sd;
    up.push(u); dn.push(d);
    pb.push(u === d ? 0.5 : (c - d) / (u - d));
    bw.push(((u - d) / mid[i]) * 100);
  });
  return { up, mid, dn, pb, bw };
}
function stochastic(high, low, close, p = 14, d = 3) {
  const k = close.map((c, i) => {
    if (i < p - 1) return null;
    const hh = Math.max(...high.slice(i - p + 1, i + 1));
    const ll = Math.min(...low.slice(i - p + 1, i + 1));
    return hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
  });
  const kd = k.map((v, i) => {
    if (v == null || i < p - 1 + d - 1) return null;
    const seg = k.slice(i - d + 1, i + 1);
    return seg.some((x) => x == null) ? null : seg.reduce((a, b) => a + b, 0) / d;
  });
  return { k, d: kd };
}
function obv(close, vol) {
  const out = [0];
  for (let i = 1; i < close.length; i++)
    out.push(out[i - 1] + (close[i] > close[i - 1] ? vol[i] : close[i] < close[i - 1] ? -vol[i] : 0));
  return out;
}
// 스윙 고점/저점 (좌우 n봉 기준)
function swings(high, low, n = 3) {
  const highs = [], lows = [];
  for (let i = n; i < high.length - n; i++) {
    if (high.slice(i - n, i).every((v) => v < high[i]) && high.slice(i + 1, i + n + 1).every((v) => v <= high[i]))
      highs.push({ i, p: high[i] });
    if (low.slice(i - n, i).every((v) => v > low[i]) && low.slice(i + 1, i + n + 1).every((v) => v >= low[i]))
      lows.push({ i, p: low[i] });
  }
  return { highs, lows };
}
// 최근 1년 대비 백분위
function percentile(series, value) {
  const v = series.filter((x) => x != null);
  if (!v.length) return 50;
  return (v.filter((x) => x <= value).length / v.length) * 100;
}
// 라운드넘버 근접 보너스
function roundBonus(price) {
  const digits = Math.floor(Math.log10(price));
  const unit = 10 ** Math.max(digits - 1, 0);
  const near = Math.round(price / unit) * unit;
  return Math.abs(price - near) / price < 0.01 ? 3 : 0;
}

/* ========== 데모 데이터 생성 ========== */
function genDemo(ticker, days = 320) {
  const rnd = mulberry32(strSeed(ticker.toUpperCase() || "DEMO"));
  const base = 5000 * Math.round(2 + rnd() * 380); // 1만~190만원대
  let p = base;
  let drift = (rnd() - 0.35) * 0.004; // 티커별 추세 성향
  const data = [];
  const today = new Date();
  let d = new Date(today); d.setDate(d.getDate() - Math.round(days * 1.45));
  for (let i = 0; data.length < days; i++) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    if (rnd() < 0.02) drift = (rnd() - 0.4) * 0.005; // 국면 전환
    const vol = 0.012 + rnd() * 0.014;
    const ret = drift + (rnd() - 0.5) * 2 * vol + (rnd() < 0.03 ? (rnd() - 0.5) * 0.08 : 0);
    const open = p * (1 + (rnd() - 0.5) * vol * 0.6);
    p = Math.max(p * (1 + ret), base * 0.15);
    const hi = Math.max(open, p) * (1 + rnd() * vol * 0.8);
    const lo = Math.min(open, p) * (1 - rnd() * vol * 0.8);
    const volume = Math.round((80000 + rnd() * 900000) * (1 + Math.abs(ret) * 25));
    data.push({ date: d.toISOString().slice(0, 10), open: Math.round(open), high: Math.round(hi), low: Math.round(lo), close: Math.round(p), volume });
  }
  return data;
}

/* ========== CSV 파서 ========== */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 30) throw new Error("최소 30일 이상의 일봉 데이터가 필요합니다.");
  const head = lines[0].toLowerCase();
  const hasHeader = /date|open|날짜|시가/.test(head);
  const rows = (hasHeader ? lines.slice(1) : lines).map((l) => l.split(/[,\t]/).map((s) => s.trim()));
  const data = rows
    .map((r) => {
      const nums = r.map((x) => parseFloat(String(x).replace(/[",]/g, "")));
      // Date,Open,High,Low,Close,(AdjClose),Volume 추정
      return { date: r[0], open: nums[1], high: nums[2], low: nums[3], close: nums[4], volume: nums[r.length - 1] || 0 };
    })
    .filter((r) => !isNaN(r.close) && !isNaN(r.high) && !isNaN(r.low));
  if (data.length < 30) throw new Error("유효한 행이 부족합니다. 형식: 날짜,시가,고가,저가,종가,거래량");
  return data;
}

/* ========== 종합 분석 엔진 ========== */
function analyze(data, avgPrice, qty = 0, tick = "") {
  const close = data.map((d) => d.close);
  const high = data.map((d) => d.high);
  const low = data.map((d) => d.low);
  const vol = data.map((d) => d.volume);
  const N = close.length;
  const i = N - 1;
  const price = close[i];

  const ma5 = sma(close, 5), ma20 = sma(close, 20), ma60 = sma(close, 60), ma120 = sma(close, 120), ma200 = sma(close, 200);
  const RSI = rsi(close), ATR = atr(high, low, close);
  const { adx: ADX, pdi, ndi } = adx(high, low, close);
  const MACD = macd(close);
  const BB = bollinger(close);
  const ST = stochastic(high, low, close);
  const OBV = obv(close, vol);
  const sw = swings(high, low, 3);

  const a = ATR[i] || price * 0.02;
  const yr = Math.max(N - 252, 0);

  /* ── 추세 국면 ── */
  const aligned = ma20[i] != null && ma60[i] != null && ma20[i] > ma60[i] && (ma120[i] == null || ma60[i] > ma120[i]);
  const above200 = ma200[i] == null ? price > (ma120[i] || ma60[i] || price) : price > ma200[i];
  const adxV = ADX[i] || 0;
  const adxStrong = adxV >= 25;
  const bullDI = (pdi[i] || 0) > (ndi[i] || 0);
  const trendLabel = aligned && above200 && bullDI ? "상승" : !aligned && !above200 && !bullDI ? "하락" : "횡보/전환";

  /* ── 과열도 (1년 백분위 정규화) ── */
  const devATR = ma20[i] != null ? (price - ma20[i]) / a : 0;
  const devSeries = close.map((c, k) => (ma20[k] != null && ATR[k] ? (c - ma20[k]) / ATR[k] : null)).slice(yr);
  const mom10 = close[i - 10] ? ((price - close[i - 10]) / close[i - 10]) * 100 : 0;
  const momSeries = close.map((c, k) => (close[k - 10] ? ((c - close[k - 10]) / close[k - 10]) * 100 : null)).slice(yr);
  const heatParts = [
    { name: "이격(ATR배)", val: devATR, p: percentile(devSeries, devATR), disp: devATR.toFixed(1) },
    { name: "RSI", val: RSI[i], p: percentile(RSI.slice(yr), RSI[i] ?? 50), disp: (RSI[i] ?? 50).toFixed(1) },
    { name: "%B", val: BB.pb[i], p: percentile(BB.pb.slice(yr), BB.pb[i] ?? 0.5), disp: (BB.pb[i] ?? 0.5).toFixed(2) },
    { name: "10일 모멘텀", val: mom10, p: percentile(momSeries, mom10), disp: pct(mom10) },
  ];
  const heat = Math.round(heatParts.reduce((s, x) => s + x.p, 0) / heatParts.length);
  const depression = 100 - heat; // 침체도

  /* ── 지지 레벨 (피보나치 + 스윙저점 + 이평선) ── */
  const look = Math.min(120, N);
  const hh = Math.max(...high.slice(N - look));
  const llIdx = low.slice(N - look).indexOf(Math.min(...low.slice(N - look)));
  const ll = low.slice(N - look)[llIdx];
  const fib = [0.382, 0.5, 0.618].map((f) => ({ name: `피보 되돌림 ${f}`, p: hh - (hh - ll) * f }));
  const recentLows = sw.lows.filter((s) => s.i > N - 60).map((s) => ({ name: "직전 저점", p: s.p }));
  const maSup = [{ name: "20일선", p: ma20[i] }, { name: "60일선", p: ma60[i] }, { name: "200일선", p: ma200[i] }].filter((x) => x.p != null && x.p < price * 1.02);
  const supports = [...fib, ...recentLows, ...maSup].filter((s) => s.p < price * 1.05 && s.p > price * 0.7).sort((x, y) => y.p - x.p);
  // 근접 지지 클러스터
  const nearSup = supports.find((s) => Math.abs(price - s.p) <= 0.5 * a && s.p <= price * 1.01);
  const supCluster = nearSup ? supports.filter((s) => Math.abs(s.p - nearSup.p) <= 0.4 * a) : [];

  /* ── 매수(눌림목) 점수 ── */
  const buyRows = [];
  let buyScore = 0;
  {
    let s = 0;
    if (aligned) s += 15; if (adxStrong) s += 10; if (above200) s += 10;
    buyRows.push({ pts: s, max: 35, title: "상승추세 (정배열·ADX≥25·200일선 위)", detail: `${aligned ? "정배열" : "이평 미정렬"} · ADX ${adxV.toFixed(0)}·${adxStrong ? "강" : "약"} · 200일선 ${above200 ? "위" : "아래"}` });
    buyScore += s;
  }
  {
    const s = depression >= 80 ? 25 : depression >= 65 ? 18 : depression >= 50 ? 10 : 0;
    buyRows.push({ pts: s, max: 25, title: "깊은 눌림 (침체도≥80)", detail: `침체도 ${depression}` });
    buyScore += s;
  }
  {
    const s = nearSup ? 25 : supports.find((x) => Math.abs(price - x.p) <= a) ? 12 : 0;
    buyRows.push({
      pts: s, max: 25, title: "지지 바로 위 (≤0.5ATR)",
      detail: nearSup ? `${M(nearSup.p, tick)} (${supCluster.map((c) => c.name).join(" + ") || nearSup.name}) · ${((price - nearSup.p) / a).toFixed(1)} ATR ${price >= nearSup.p ? "위" : "아래"}` : "0.5ATR 내 지지 없음",
    });
    buyScore += s;
  }
  {
    const v5 = vol.slice(-5).reduce((x, y) => x + y, 0) / 5;
    const v20 = vol.slice(-25, -5).reduce((x, y) => x + y, 0) / 20;
    const ratio = v20 ? v5 / v20 : 1;
    const s = ratio <= 0.8 ? 15 : ratio <= 1.0 ? 8 : 0;
    buyRows.push({ pts: s, max: 15, title: "거래량 감소 (건강한 눌림)", detail: `최근/직전 ${(ratio * 100).toFixed(0)}%` });
    buyScore += s;
  }

  /* ── 보조 시그널 ── */
  const macdCross = MACD.hist[i] != null && MACD.hist[i - 1] != null && MACD.hist[i] > 0 && MACD.hist[i - 1] <= 0;
  const macdBull = (MACD.hist[i] ?? 0) > 0;
  const stochOversold = (ST.k[i] ?? 50) < 25;
  const stochCross = ST.k[i] != null && ST.d[i] != null && ST.k[i] > ST.d[i] && (ST.k[i - 1] ?? 0) <= (ST.d[i - 1] ?? 0);
  const obvSlope = OBV[i] - OBV[Math.max(i - 20, 0)];
  const obvUp = obvSlope > 0;
  const signals = [
    { name: "MACD", ok: macdBull, note: macdCross ? "골든크로스 발생" : macdBull ? "히스토그램 양전환 유지" : "히스토그램 음(-)" },
    { name: "스토캐스틱", ok: stochCross || stochOversold, note: stochCross ? "K/D 골든크로스" : stochOversold ? `과매도권 ${ST.k[i]?.toFixed(0)}` : `중립 ${ST.k[i]?.toFixed(0) ?? "—"}` },
    { name: "OBV(수급)", ok: obvUp, note: obvUp ? "20일 순매집 우위" : "20일 분산 우위" },
    { name: "볼린저 위치", ok: (BB.pb[i] ?? 0.5) < 0.35, note: `%B ${(BB.pb[i] ?? 0.5).toFixed(2)} · 밴드폭 ${(BB.bw[i] ?? 0).toFixed(1)}%` },
  ];
  const sigBonus = signals.filter((s) => s.ok).length;

  /* ── 저항/매도 목표 구간 (스윙고점 클러스터 + 52주 + 라운드) ── */
  const hi52 = Math.max(...high.slice(-252));
  const resHighs = sw.highs.filter((s) => s.p > price).map((s) => s.p);
  const clusters = [];
  [...resHighs, hi52].sort((x, y) => x - y).forEach((p) => {
    const c = clusters.find((cl) => Math.abs(cl.center - p) <= 0.8 * a);
    if (c) { c.pts.push(p); c.center = c.pts.reduce((x, y) => x + y, 0) / c.pts.length; }
    else clusters.push({ center: p, pts: [p] });
  });
  const zones = clusters.slice(0, 3).map((c, idx) => {
    const lo_ = Math.min(...c.pts) - 0.3 * a, hi_ = Math.max(...c.pts) + 0.3 * a;
    const touches = c.pts.length;
    const near52 = Math.abs(hi52 - c.center) <= a;
    const rb = roundBonus(c.center);
    const strength = Math.min(15 + touches * 9 + (near52 ? 12 : 0) + rb + (idx === 0 ? 5 : 0), 100);
    const dist = ((c.center - price) / price) * 100;
    return {
      order: idx + 1, lo: lo_, hi: hi_, center: c.center, strength,
      why: `직전 고점 구간${near52 ? " + 52주 신고가 근접" : ""}${rb ? " + 라운드넘버" : ""}`,
      tags: [{ n: "고점 터치", v: `×${touches}` }, near52 && { n: "52주 신고가", v: "+12" }, rb && { n: "라운드넘버", v: "+3" }].filter(Boolean),
      distPct: dist, distATR: (c.center - price) / a,
    };
  });

  /* ── 손절선 & 손익비 ── */
  const swingLow = sw.lows.filter((s) => s.i > N - 40).map((s) => s.p).sort((x, y) => y - x)[0] ?? ll;
  const stopBase = nearSup ? nearSup.p : swingLow;
  const stop = Math.round(stopBase - 1.0 * a);
  const risk = price - stop;
  zones.forEach((z) => { z.rr = risk > 0 ? (z.center - price) / risk : null; });

  /* ── 종합 판단 ── */
  const inSellZone = zones[0] && price >= zones[0].lo;
  let verdict, composite;
  const buyAdj = Math.min(buyScore + sigBonus * 2, 100);
  if (trendLabel === "하락") {
    composite = Math.max(20 - Math.round(buyAdj / 5), 0);
    verdict = { label: "매도/관망 우위", tone: "sell", action: "하락 추세 — 신규 매수 비추천, 보유 시 반등 분할 매도 검토" };
  } else if (heat >= 85 || inSellZone) {
    composite = 100 - heat;
    verdict = { label: heat >= 85 ? "과열 — 분할 매도 관심" : "저항권 진입 — 익절 검토", tone: "sell", action: "1차 매도 구간 도달/과열 — 전량보다 분할 익절 + 손절선 상향" };
  } else if (buyAdj >= 80) {
    composite = buyAdj;
    verdict = { label: "강력 매수 관심", tone: "buy", action: "추세 유지 + 눌림 + 지지 확인 — 분할 매수 관심 구간" };
  } else if (buyAdj >= 60) {
    composite = buyAdj;
    verdict = { label: "매수 관심", tone: "buy", action: "조건 일부 충족 — 지지 확인 후 소량 분할 접근" };
  } else {
    composite = buyAdj;
    verdict = { label: "관망", tone: "hold", action: "신호 부족 — 눌림 심화 또는 돌파 확인까지 대기" };
  }

  /* ── 평단가 기반 ── */
  let position = null;
  if (avgPrice > 0) {
    const pl = ((price - avgPrice) / avgPrice) * 100;
    position = {
      avg: avgPrice, qty, pl,
      stopFromAvg: Math.round(avgPrice * 0.93),
      note: pl >= 15 ? "수익권 — 1차 구간부터 분할 익절 + 트레일링 스탑" : pl >= 0 ? "본전 상회 — 손절선을 평단 위로 올려 무손실 관리" : pl > -7 ? "손실권 — 손절 기준(-7%) 접근 여부 점검" : "손절 기준 이탈 — 원칙적 대응 필요",
    };
  }

  /* ── 과거 유사 조건 시뮬레이션 (확률 예측) ── */
  let prob = null;
  {
    const heatAt = (k) => {
      if (ma20[k] == null || !ATR[k] || RSI[k] == null || BB.pb[k] == null || !close[k - 10]) return null;
      const dv = (close[k] - ma20[k]) / ATR[k];
      const mk = ((close[k] - close[k - 10]) / close[k - 10]) * 100;
      return Math.round((percentile(devSeries, dv) + percentile(RSI.slice(yr), RSI[k]) + percentile(BB.pb.slice(yr), BB.pb[k]) + percentile(momSeries, mk)) / 4);
    };
    const targetPct = zones[0] ? (zones[0].center - price) / price : 0.05;
    const stopPct = (stop - price) / price;
    const r5s = [], r20s = []; let tFirst = 0, sFirst = 0, paths = 0;
    for (let k = Math.max(60, N - 500); k < N - 21; k++) {
      const hk = heatAt(k);
      if (hk == null) continue;
      const alignK = ma20[k] != null && ma60[k] != null && ma20[k] > ma60[k];
      if (alignK !== aligned || Math.abs(hk - heat) > 15) continue;
      r5s.push(((close[k + 5] - close[k]) / close[k]) * 100);
      r20s.push(((close[k + 20] - close[k]) / close[k]) * 100);
      let hit = 0;
      for (let j = 1; j <= 20; j++) {
        if (low[k + j] <= close[k] * (1 + stopPct)) { hit = -1; break; }
        if (high[k + j] >= close[k] * (1 + targetPct)) { hit = 1; break; }
      }
      paths++; if (hit === 1) tFirst++; if (hit === -1) sFirst++;
    }
    if (r5s.length >= 8) {
      const sorted = [...r5s].sort((a, b) => a - b);
      const q = (p) => sorted[Math.floor(sorted.length * p)];
      const ups = r5s.filter((x) => x > 0), dns = r5s.filter((x) => x <= 0);
      const pUp = ups.length / r5s.length;
      const avgW = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : 0;
      const avgL = dns.length ? Math.abs(dns.reduce((a, b) => a + b, 0) / dns.length) : 0;
      prob = {
        n: r5s.length,
        pUp5: Math.round(pUp * 100),
        med5: +q(0.5).toFixed(1), p10: +q(0.1).toFixed(1), p90: +q(0.9).toFixed(1),
        med20: +[...r20s].sort((a, b) => a - b)[Math.floor(r20s.length / 2)].toFixed(1),
        pTarget: paths ? Math.round((tFirst / paths) * 100) : null,
        pStop: paths ? Math.round((sFirst / paths) * 100) : null,
        ev: +(pUp * avgW - (1 - pUp) * avgL - 0.3).toFixed(1),
      };
    }
  }

  const chart = data.slice(-130).map((d, k) => {
    const gi = N - Math.min(130, N) + k;
    return { date: d.date.slice(5), close: d.close, ma20: ma20[gi], ma60: ma60[gi] };
  });

  return {
    price, a, date: data[i].date, trendLabel, aligned, adxV, adxStrong, above200, bullDI,
    heat, heatParts, depression, buyScore, buyRows, signals, sigBonus,
    rsi: RSI[i], macdHist: MACD.hist[i], stochK: ST.k[i], pb: BB.pb[i], bw: BB.bw[i], mom10, devATR,
    supports: supports.slice(0, 5), nearSup, zones, stop, risk, hi52, verdict, composite, position, chart, obvUp, prob,
  };
}

/* ========== 종목 DB (한글명 → 티커) ========== */
const STOCKS = [
  ["삼성전자","005930.KS"],["삼성전자우","005935.KS"],["SK하이닉스","000660.KS"],["삼성바이오로직스","207940.KS"],
  ["LG에너지솔루션","373220.KS"],["현대차","005380.KS"],["기아","000270.KS"],["셀트리온","068270.KS"],
  ["NAVER 네이버","035420.KS"],["카카오","035720.KS"],["POSCO홀딩스 포스코","005490.KS"],["삼성SDI","006400.KS"],
  ["LG화학","051910.KS"],["현대모비스","012330.KS"],["KB금융","105560.KS"],["신한지주","055550.KS"],
  ["하나금융지주","086790.KS"],["우리금융지주","316140.KS"],["삼성물산","028260.KS"],["삼성생명","032830.KS"],
  ["삼성화재","000810.KS"],["삼성전기","009150.KS"],["삼성에스디에스 SDS","018260.KS"],["삼성중공업","010140.KS"],
  ["삼성증권","016360.KS"],["삼성카드","029780.KS"],["LG전자","066570.KS"],["LG","003550.KS"],
  ["LG디스플레이","034220.KS"],["LG이노텍","011070.KS"],["LG유플러스","032640.KS"],["LG생활건강","051900.KS"],
  ["SK","034730.KS"],["SK이노베이션","096770.KS"],["SK텔레콤","017670.KS"],["SK스퀘어","402340.KS"],
  ["SK바이오팜","326030.KS"],["SK바이오사이언스","302440.KS"],["한국전력","015760.KS"],["KT","030200.KS"],
  ["KT&G","033780.KS"],["포스코퓨처엠","003670.KS"],["포스코인터내셔널","047050.KS"],["현대글로비스","086280.KS"],
  ["현대제철","004020.KS"],["현대건설","000720.KS"],["현대로템","064350.KS"],["HD현대","267250.KS"],
  ["HD한국조선해양","009540.KS"],["HD현대중공업","329180.KS"],["HD현대일렉트릭","267260.KS"],["한화","000880.KS"],
  ["한화에어로스페이스","012450.KS"],["한화솔루션","009830.KS"],["한화오션","042660.KS"],["두산","000150.KS"],
  ["두산에너빌리티","034020.KS"],["두산밥캣","241560.KS"],["두산로보틱스","454910.KS"],["대한항공","003490.KS"],
  ["아모레퍼시픽","090430.KS"],["하이브","352820.KS"],["JYP엔터테인먼트","035900.KQ"],["에스엠 SM엔터","041510.KQ"],
  ["와이지엔터테인먼트 YG","122870.KQ"],["CJ제일제당","097950.KS"],["CJ","001040.KS"],["CJ ENM","035760.KQ"],
  ["CJ대한통운","000120.KS"],["넷마블","251270.KS"],["엔씨소프트","036570.KS"],["크래프톤","259960.KS"],
  ["펄어비스","263750.KQ"],["카카오뱅크","323410.KS"],["카카오페이","377300.KS"],["미래에셋증권","006800.KS"],
  ["한국금융지주","071050.KS"],["NH투자증권","005940.KS"],["키움증권","039490.KS"],["메리츠금융지주","138040.KS"],
  ["DB손해보험","005830.KS"],["현대해상","001450.KS"],["기업은행","024110.KS"],["롯데케미칼","011170.KS"],
  ["롯데지주","004990.KS"],["롯데쇼핑","023530.KS"],["롯데칠성","005300.KS"],["신세계","004170.KS"],
  ["이마트","139480.KS"],["호텔신라","008770.KS"],["GS","078930.KS"],["GS건설","006360.KS"],
  ["GS리테일","007070.KS"],["S-Oil 에스오일","010950.KS"],["고려아연","010130.KS"],["한온시스템","018880.KS"],
  ["에코프로","086520.KQ"],["에코프로비엠","247540.KQ"],["에코프로머티리얼즈","450080.KS"],["엘앤에프","066970.KQ"],
  ["알테오젠","196170.KQ"],["HLB 에이치엘비","028300.KQ"],["셀트리온제약","068760.KQ"],["유한양행","000100.KS"],
  ["한미약품","128940.KS"],["대웅제약","069620.KS"],["녹십자","006280.KS"],["종근당","185750.KS"],
  ["삼천당제약","000250.KQ"],["씨젠","096530.KQ"],["휴젤","145020.KQ"],["메디톡스","086900.KQ"],
  ["클래시스","214150.KQ"],["파마리서치","214450.KQ"],["레인보우로보틱스","277810.KQ"],["리노공업","058470.KQ"],
  ["이오테크닉스","039030.KQ"],["원익IPS","240810.KQ"],["주성엔지니어링","036930.KQ"],["솔브레인","357780.KQ"],
  ["동진쎄미켐","005290.KQ"],["한미반도체","042700.KS"],["DB하이텍","000990.KS"],["서울반도체","046890.KQ"],
  ["천보","278280.KQ"],["대주전자재료","078600.KQ"],["한국콜마","161890.KS"],["코스맥스","192820.KS"],
  ["오리온","271560.KS"],["농심","004370.KS"],["삼양식품","003230.KS"],["빙그레","005180.KS"],
  ["매일유업","267980.KQ"],["하이트진로","000080.KS"],["BGF리테일","282330.KS"],["강원랜드","035250.KS"],
  ["파라다이스","034230.KQ"],["하나투어","039130.KS"],["모두투어","080160.KQ"],["LS","006260.KS"],
  ["LS일렉트릭","010120.KS"],["효성중공업","298040.KS"],["한국항공우주 KAI","047810.KS"],["LIG넥스원","079550.KS"],
  ["풍산","103140.KS"],["코웨이","021240.KS"],["휠라홀딩스","081660.KS"],["F&F 에프앤에프","383220.KS"],
  ["한섬","020000.KS"],["영원무역","111770.KS"],["한세실업","105630.KS"],["더존비즈온","012510.KS"],
  ["안랩","053800.KQ"],["카페24","042000.KQ"],["NHN","181710.KS"],["컴투스","078340.KQ"],
  ["위메이드","112040.KQ"],["데브시스터즈","194480.KQ"],["넥슨게임즈","225570.KQ"],["한진칼","180640.KS"],
  ["제주항공","089590.KS"],["진에어","272450.KS"],["티웨이항공","091810.KS"],["팬오션","028670.KS"],
  ["HMM","011200.KS"],["대우건설","047040.KS"],["DL이앤씨","375500.KS"],["삼성엔지니어링","028050.KS"],
  ["애플 Apple","AAPL"],["마이크로소프트 Microsoft","MSFT"],["엔비디아 Nvidia","NVDA"],["테슬라 Tesla","TSLA"],
  ["구글 알파벳 Google","GOOGL"],["아마존 Amazon","AMZN"],["메타 Meta","META"],["넷플릭스 Netflix","NFLX"],
  ["AMD","AMD"],["인텔 Intel","INTC"],["TSMC","TSM"],["팔란티어 Palantir","PLTR"],
];
function searchStocks(q) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return STOCKS.filter(([n, t]) => n.toLowerCase().includes(s) || t.toLowerCase().startsWith(s)).slice(0, 8);
}
function resolveTicker(q) {
  const m = q.match(/\(([A-Z0-9.]+)\)\s*$/i);
  if (m) { const hit = STOCKS.find(([, t]) => t.toUpperCase() === m[1].toUpperCase()); return { name: hit ? hit[0].split(" ")[0] : m[1], ticker: m[1].toUpperCase() }; }
  const hits = searchStocks(q);
  if (hits.length) return { name: hits[0][0].split(" ")[0], ticker: hits[0][1] };
  return { name: q.trim(), ticker: q.trim().toUpperCase() };
}

/* ========== 실시간 시세 · AI 프록시 호출 ========== */
async function fetchChart(ticker) {
  const r = await fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "시세 조회 실패");
  if (!j.data || j.data.length < 30) throw new Error("시세 데이터가 부족합니다: " + ticker);
  return j;
}
async function callAI(body) {
  const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "AI 호출 실패");
  return j;
}
async function fetchNews(label, ticker, history) {
  const j = await callAI({ kind: "news", label, ticker, history });
  j.sentiment = Math.max(-100, Math.min(100, Math.round(j.sentiment || 0)));
  return j;
}
const newsAdjOf = (n) => (n ? Math.max(-12, Math.min(12, Math.round(n.sentiment / 8))) : 0);

/* ========== 모닝 브리핑 · 추천 종목 ========== */
async function fetchPicks(market, history) {
  const j = await callAI({ kind: "picks", market, history });
  j.picks = (j.picks || []).slice(0, 3);
  j.day_picks = (j.day_picks || []).slice(0, 3);
  return j;
}
// 현재 시간 기준 추천 세션 (KST 가정 · 3~11월 미국 서머타임 → 22:30 개장)
function sessionHint() {
  const now = new Date();
  const h = now.getHours(), mn = now.getMinutes(), t = h + mn / 60;
  const dst = now.getMonth() >= 2 && now.getMonth() <= 10;
  const usOpen = dst ? "22:30" : "23:30";
  const usPre = dst ? 21.5 : 22.5;
  if (t >= 6 && t < 9) return { m: "KR", msg: "지금은 국내장 개장 전 — 모닝픽을 받아보기 좋은 시간입니다.", usOpen };
  if (t >= usPre - 1 && t < usPre + 1) return { m: "US", msg: `지금은 미국장 개장(한국시간 ${usOpen}) 전 — 프리픽 체크 타이밍입니다.`, usOpen };
  return { m: null, msg: `국내장 모닝픽은 아침 8시~9시, 미국장 프리픽은 개장(한국시간 ${usOpen}) 1시간 전에 확인하는 걸 권장합니다.`, usOpen };
}

/* ========== 디자인 토큰 ========== */
const T = {
  bg: "#07090F", card: "#0E1219", card2: "#131926", line: "#1D2636",
  ink: "#E8EDF5", sub: "#8A97AC", faint: "#5A6579",
  buy: "#3DDC97", sell: "#FF6B6B", warn: "#F5B94A", info: "#6FC3FF",
  serif: '"Nanum Myeongjo", Georgia, "Times New Roman", serif',
  mono: '"IBM Plex Mono", "Courier New", monospace',
  sans: '-apple-system, "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
};
const toneColor = (t) => (t === "buy" ? T.buy : t === "sell" ? T.sell : T.warn);

/* ========== UI 조각 ========== */
const Eyebrow = ({ children, color = T.buy }) => (
  <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: "0.35em", color, textTransform: "uppercase", marginBottom: 8 }}>{children}</div>
);
const Card = ({ children, style }) => (
  <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, padding: "18px 16px", ...style }}>{children}</div>
);

function Gauge({ value, tone }) {
  const c = toneColor(tone);
  const angle = -90 + (Math.max(0, Math.min(100, value)) / 100) * 180;
  const arc = (start, end, color, w) => {
    const r = 84, cx = 100, cy = 100;
    const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    const [x1, y1] = p(start), [x2, y2] = p(end);
    return <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${end - start > 180 ? 1 : 0} 1 ${x2} ${y2}`} stroke={color} strokeWidth={w} fill="none" strokeLinecap="round" />;
  };
  return (
    <svg viewBox="0 0 200 118" style={{ width: "100%", maxWidth: 280, display: "block", margin: "0 auto" }}>
      {arc(-180, 0, T.line, 10)}
      {arc(-180, -180 + (value / 100) * 180, c, 10)}
      <line x1="100" y1="100" x2={100 + 62 * Math.cos((angle * Math.PI) / 180)} y2={100 + 62 * Math.sin((angle * Math.PI) / 180)} stroke={T.ink} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="100" cy="100" r="5" fill={c} />
      <text x="16" y="114" fontSize="10" fill={T.faint} fontFamily={T.mono}>0</text>
      <text x="178" y="114" fontSize="10" fill={T.faint} fontFamily={T.mono}>100</text>
    </svg>
  );
}

const ScoreRow = ({ r, color }) => (
  <div style={{ display: "flex", gap: 14, padding: "14px 0", borderBottom: `1px solid ${T.line}` }}>
    <div style={{ fontFamily: T.serif, fontSize: 22, fontWeight: 700, color: r.pts > 0 ? color : T.faint, minWidth: 52 }}>+{r.pts}</div>
    <div style={{ flex: 1 }}>
      <div style={{ color: T.ink, fontSize: 14.5, fontWeight: 600, lineHeight: 1.45 }}>{r.title}</div>
      <div style={{ color: T.sub, fontSize: 13, marginTop: 4, fontFamily: T.mono }}>{r.detail}</div>
    </div>
    <div style={{ color: T.faint, fontSize: 11, fontFamily: T.mono, alignSelf: "flex-start" }}>/{r.max}</div>
  </div>
);

function MiniChart({ data }) {
  const w = 560, h = 150, pad = 4;
  const vals = data.flatMap((d) => [d.close, d.ma20, d.ma60]).filter((v) => v != null);
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = (i) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const path = (key) => data.map((d, i) => (d[key] == null ? null : `${i === 0 || data[i - 1][key] == null ? "M" : "L"} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`)).filter(Boolean).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", display: "block" }}>
      <path d={path("close") + ` L ${x(data.length - 1)} ${h} L ${x(0)} ${h} Z`} fill="url(#g1)" opacity="0.25" />
      <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.info} /><stop offset="100%" stopColor="transparent" /></linearGradient></defs>
      <path d={path("ma60")} stroke={T.warn} strokeWidth="1.4" fill="none" opacity="0.8" />
      <path d={path("ma20")} stroke={T.buy} strokeWidth="1.4" fill="none" opacity="0.9" />
      <path d={path("close")} stroke={T.info} strokeWidth="2" fill="none" />
    </svg>
  );
}


/* ========== 실시간 시세 유틸 ========== */
const isKR = (t) => /\.(KS|KQ)$/i.test(t);
const fmtP = (p, t) => (p == null ? "—" : isKR(t) ? fmt(p) + "원" : "$" + fmt(p, 2));
let FX = { usd: null, t: 0 };
async function loadFx() {
  if (FX.usd && Date.now() - FX.t < 600000) return FX.usd;
  try {
    const [q] = await fetchQuotes(["KRW=X"]);
    if (q && q.price > 100) FX = { usd: q.price, t: Date.now() };
  } catch {}
  return FX.usd;
}
// 통화 표기: 국내 → 원 / 미국 → $ (약 원화)
const M = (v, t) => (v == null || isNaN(v)) ? "—"
  : isKR(String(t || "")) ? `${fmt(v)}원`
  : `$${fmt(v, 2)}${FX.usd ? ` (약 ${fmt(v * FX.usd)}원)` : ""}`;
async function fetchQuotes(tickers) {
  const r = await fetch(`/api/quote?tickers=${encodeURIComponent(tickers.join(","))}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "시세 조회 실패");
  return j.quotes || [];
}
function notify(msg) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") new Notification("StockDesk", { body: msg });
    else if (Notification.permission === "default") Notification.requestPermission();
  } catch {}
}
const wlLoad = () => { try { return JSON.parse(localStorage.getItem("sd_wl") || "[]"); } catch { return []; } };
const wlSave = (wl) => { try { localStorage.setItem("sd_wl", JSON.stringify(wl)); } catch {} };

/* ========== 실시간 워치 (초단위 폴링 + 가격 알림) ========== */
function LiveWatch({ ticker }) {
  const [q, setQ] = useState(null);
  const [on, setOn] = useState(true);
  const [dir, setDir] = useState(0);
  const [hi, setHi] = useState("");
  const [lo, setLo] = useState("");
  const [alertMsg, setAlertMsg] = useState("");
  const lastP = useRef(null);
  const fired = useRef({ hi: false, lo: false });

  useEffect(() => { fired.current = { hi: false, lo: false }; setAlertMsg(""); }, [ticker, hi, lo]);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const tick = async () => {
      try {
        const [d] = await fetchQuotes([ticker]);
        if (!alive || !d || d.error) return;
        if (lastP.current != null && d.price !== lastP.current) setDir(d.price > lastP.current ? 1 : -1);
        lastP.current = d.price;
        setQ(d);
        const H = parseFloat(hi), L = parseFloat(lo);
        if (H && d.price >= H && !fired.current.hi) { fired.current.hi = true; const m = `▲ ${ticker} 상단 도달: ${fmtP(d.price, ticker)} ≥ ${fmtP(H, ticker)}`; setAlertMsg(m); notify(m); }
        if (L && d.price <= L && !fired.current.lo) { fired.current.lo = true; const m = `▼ ${ticker} 하단 도달: ${fmtP(d.price, ticker)} ≤ ${fmtP(L, ticker)}`; setAlertMsg(m); notify(m); }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [ticker, on, hi, lo]);

  const c = q ? (q.changePct >= 0 ? T.buy : T.sell) : T.sub;
  const inS = { width: "100%", boxSizing: "border-box", background: T.card2, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", color: T.ink, fontSize: 13.5, fontFamily: T.mono, outline: "none" };
  return (
    <div style={{ marginTop: 14, border: `1px solid ${on ? T.buy + "55" : T.line}`, borderRadius: 14, padding: 14, background: T.card2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: "0.25em", color: on ? T.buy : T.faint }}>
          {on && <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: T.buy, marginRight: 7, animation: "blink 1.2s infinite" }} />}
          LIVE WATCH · 3초 갱신
          <style>{`@keyframes blink{50%{opacity:0.2}}`}</style>
        </span>
        <span onClick={() => setOn(!on)} style={{ cursor: "pointer", fontSize: 12.5, color: on ? T.sub : T.buy, fontFamily: T.mono }}>{on ? "정지" : "시작 ▶"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: T.serif, fontSize: 30, fontWeight: 800, color: dir > 0 ? T.buy : dir < 0 ? T.sell : T.ink, transition: "color 0.4s" }}>
          {q ? fmtP(q.price, ticker) : "…"}
        </span>
        {q && <span style={{ fontFamily: T.mono, fontSize: 15, fontWeight: 700, color: c }}>{pct(q.changePct, 2)}</span>}
        {q && <span style={{ fontFamily: T.mono, fontSize: 12, color: T.sub }}>거래량 {fmt(q.volume)}</span>}
      </div>
      {q && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.faint, marginTop: 6 }}>
        {q.source?.startsWith("naver") ? "네이버 실시간(2~3초)" : "야후 준실시간(1분봉)"}{q.state ? ` · ${q.state}` : ""}
      </div>}
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, color: T.buy, fontFamily: T.mono, marginBottom: 5 }}>▲ 상단 알림가</div>
          <input style={inS} inputMode="decimal" value={hi} onChange={(e) => setHi(e.target.value.replace(/[^\d.]/g, ""))} placeholder="예: 목표가" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, color: T.sell, fontFamily: T.mono, marginBottom: 5 }}>▼ 하단 알림가</div>
          <input style={inS} inputMode="decimal" value={lo} onChange={(e) => setLo(e.target.value.replace(/[^\d.]/g, ""))} placeholder="예: 손절선" />
        </div>
      </div>
      {alertMsg && <div style={{ marginTop: 10, background: "rgba(245,185,74,0.12)", border: `1px solid ${T.warn}77`, borderRadius: 10, padding: "10px 12px", fontSize: 13, color: T.warn, fontWeight: 700 }}>{alertMsg}</div>}
      <div style={{ fontSize: 11, color: T.faint, marginTop: 8, lineHeight: 1.5 }}>알림은 앱이 열려 있는 동안 작동합니다. 첫 사용 시 브라우저 알림 권한을 허용해 주세요.</div>
    </div>
  );
}

/* ========== 관심종목 워치리스트 (실시간 시세판) ========== */
function Watchlist({ wl, setWl, onAnalyze }) {
  const [quotes, setQuotes] = useState({});
  useEffect(() => {
    if (!wl.length) return;
    let alive = true;
    const tick = async () => {
      try {
        const qs = await fetchQuotes(wl.map((w) => w.ticker));
        if (alive) setQuotes(Object.fromEntries(qs.map((q) => [q.ticker, q])));
      } catch {}
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [wl.map((w) => w.ticker).join(",")]);

  if (!wl.length) return null;
  return (
    <Card style={{ marginBottom: 16 }}>
      <Eyebrow color={T.buy}>WATCHLIST · 관심종목 실시간 (4초 갱신)</Eyebrow>
      {wl.map((w) => {
        const q = quotes[w.ticker];
        const c = q && !q.error ? (q.changePct >= 0 ? T.buy : T.sell) : T.faint;
        return (
          <div key={w.ticker} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: `1px dashed ${T.line}` }}>
            <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onAnalyze(w)}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</div>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.faint }}>{w.ticker}</div>
            </div>
            <div style={{ textAlign: "right", fontFamily: T.mono }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{q && !q.error ? fmtP(q.price, w.ticker) : "…"}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: c }}>{q && !q.error ? pct(q.changePct, 2) : ""}</div>
            </div>
            <span onClick={() => setWl(wl.filter((x) => x.ticker !== w.ticker))} style={{ color: T.faint, cursor: "pointer", padding: "4px 6px", fontSize: 15 }}>✕</span>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: T.faint, marginTop: 10 }}>종목을 탭하면 바로 정밀 분석합니다 · 목록은 이 기기에 저장됩니다</div>
    </Card>
  );
}

/* ========== 포지션 사이징 계산기 ========== */
function PositionCalc({ price, stop, ticker }) {
  const [acct, setAcct] = useState("10000000");
  const [riskPct, setRiskPct] = useState("1.5");
  const A = parseFloat(acct) || 0, R = parseFloat(riskPct) || 0;
  const riskPerShare = price - stop;
  const fx = isKR(ticker) ? 1 : (FX.usd || 1350);
  const budget = (A * R) / 100; // 원화
  const qty = riskPerShare > 0 ? Math.floor(budget / (riskPerShare * fx)) : 0;
  const cost = qty * price; // 종목 통화
  const weight = A > 0 ? ((cost * fx) / A) * 100 : 0;
  const inS = { width: "100%", boxSizing: "border-box", background: T.card2, border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 11px", color: T.ink, fontSize: 14, fontFamily: T.mono, outline: "none" };
  return (
    <Card style={{ marginTop: 14 }}>
      <Eyebrow color={T.info}>POSITION SIZING · 리스크 기반 수량 계산</Eyebrow>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1.4 }}>
          <div style={{ fontSize: 11.5, color: T.info, fontFamily: T.mono, marginBottom: 5 }}>총 투자금</div>
          <input style={inS} inputMode="numeric" value={acct} onChange={(e) => setAcct(e.target.value.replace(/[^\d]/g, ""))} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, color: T.info, fontFamily: T.mono, marginBottom: 5 }}>1회 리스크 %</div>
          <input style={inS} inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(e.target.value.replace(/[^\d.]/g, ""))} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginTop: 14, fontFamily: T.mono, fontSize: 13.5 }}>
        <div><div style={{ color: T.sub, fontSize: 11.5 }}>허용 손실액</div><div style={{ fontSize: 16, fontWeight: 700, color: T.warn }}>{fmt(budget)}원</div></div>
        <div><div style={{ color: T.sub, fontSize: 11.5 }}>주당 리스크 (현재가−손절선)</div><div style={{ fontSize: 16, fontWeight: 700 }}>{M(riskPerShare, ticker)}</div></div>
        <div><div style={{ color: T.sub, fontSize: 11.5 }}>적정 매수 수량</div><div style={{ fontSize: 19, fontWeight: 800, color: T.buy }}>{fmt(qty)}주</div></div>
        <div><div style={{ color: T.sub, fontSize: 11.5 }}>투입 금액 (비중)</div><div style={{ fontSize: 16, fontWeight: 700 }}>{M(cost, ticker)} <span style={{ color: weight > 30 ? T.warn : T.faint, fontSize: 12 }}>({weight.toFixed(0)}%)</span></div></div>
      </div>
      <div style={{ fontSize: 11.5, color: T.faint, marginTop: 12, lineHeight: 1.6 }}>
        손절선까지 하락해도 계좌의 {R || 0}%만 잃도록 수량을 역산합니다. 트레이딩에서 가장 중요한 건 종목 선정보다 손실 관리입니다.
      </div>
    </Card>
  );
}


/* ========== 추천 성적 추적 (셀프 학습 데이터) ========== */
const histLoad = () => { try { return JSON.parse(localStorage.getItem("sd_picks_hist") || "[]"); } catch { return []; } };
const histSave = (h) => { try { localStorage.setItem("sd_picks_hist", JSON.stringify(h.slice(-60))); } catch {} };
async function recordPicks(market, picks, dayPicks) {
  const sw = picks || [], dy = dayPicks || [];
  if (!sw.length && !dy.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const h = histLoad();
  if (h.some((e) => e.date === today && e.market === market)) return;
  let pmap = {};
  try {
    const all = [...new Set([...sw, ...dy].map((p) => p.ticker))];
    pmap = Object.fromEntries((await fetchQuotes(all)).map((q) => [q.ticker, q.price]));
  } catch {}
  h.push({
    date: today, market,
    picks: [
      ...sw.map((p) => ({ kind: "swing", name: p.name, ticker: p.ticker, score: p.score, p0: pmap[p.ticker] || null, r1: null, r5: null, r20: null })),
      ...dy.map((p) => ({ kind: "day", name: p.name, ticker: p.ticker, score: p.score, target: +p.target_pct || 3, p0: pmap[p.ticker] || null, r1: null, hit: null, r5: null, r20: null })),
    ],
  });
  histSave(h);
}
async function evalHistory() {
  const h = histLoad(); let changed = false;
  const need = [...new Set(h.flatMap((e) => e.picks.filter((p) => p.p0 && (p.kind === "day" ? p.r1 == null : p.r20 == null)).map((p) => p.ticker)))].slice(0, 8);
  const charts = {};
  for (const t of need) { try { charts[t] = (await fetchChart(t)).data; } catch {} }
  h.forEach((e) => e.picks.forEach((p) => {
    const d = charts[p.ticker]; if (!d || !p.p0) return;
    if (p.kind === "day") {
      if (p.r1 != null) return;
      const row = d.find((x) => x.date >= e.date);
      if (!row) return;
      p.r1 = +(((row.close - p.p0) / p.p0) * 100).toFixed(1);
      p.hit = row.high >= p.p0 * (1 + (p.target || 3) / 100);
      changed = true;
      return;
    }
    const i0 = d.findIndex((x) => x.date > e.date); if (i0 < 0) return;
    const ret = (k) => (d[i0 + k - 1] ? +(((d[i0 + k - 1].close - p.p0) / p.p0) * 100).toFixed(1) : null);
    for (const [key, k] of [["r1", 1], ["r5", 5], ["r20", 20]]) {
      if (p[key] == null) { const v = ret(k); if (v != null) { p[key] = v; changed = true; } }
    }
  }));
  if (changed) histSave(h);
  return h;
}
function daySummary(h, market) {
  const ps = h.filter((e) => e.market === market).flatMap((e) => e.picks).filter((p) => p.kind === "day" && p.r1 != null);
  if (ps.length < 3) return "";
  const hitR = Math.round((ps.filter((p) => p.hit).length / ps.length) * 100);
  const avg = (ps.reduce((s, p) => s + p.r1, 0) / ps.length).toFixed(1);
  return `당일 단타 추천 ${ps.length}건 실측: 목표가 적중률 ${hitR}%, 평균 당일 수익률 ${avg}%.`;
}
function perfSummary(h, market) {
  const ps = h.filter((e) => e.market === market).flatMap((e) => e.picks).filter((p) => p.kind !== "day" && p.r5 != null);
  if (ps.length < 3) return "";
  const avg = (k) => (ps.reduce((s, p) => s + (p[k] ?? 0), 0) / ps.filter((p) => p[k] != null).length || 0).toFixed(1);
  const win = Math.round((ps.filter((p) => p.r5 > 0).length / ps.length) * 100);
  const best = [...ps].sort((a, b) => (b.r5 ?? 0) - (a.r5 ?? 0)).slice(0, 3).map((p) => `${p.name}(${p.r5 > 0 ? "+" : ""}${p.r5}%)`).join(", ");
  const worst = [...ps].sort((a, b) => (a.r5 ?? 0) - (b.r5 ?? 0)).slice(0, 3).map((p) => `${p.name}(${p.r5}%)`).join(", ");
  return `과거 추천 ${ps.length}건 실측 성적 — 5일 승률 ${win}%, 평균 수익률: 1일 ${avg("r1")}% / 5일 ${avg("r5")}% / 20일 ${avg("r20")}%. 성공 사례: ${best}. 실패 사례: ${worst}.`;
}

function bigWord(r, finalScore) {
  if (r.trendLabel === "하락" || (r.regime && r.regime.tone === "sell" && finalScore < 55))
    return { w: "피하라", c: T.sell, s: "하락 국면 — 신규 진입 비추천, 현금이 포지션" };
  if (r.verdict.tone === "sell") return { w: "팔아라", c: T.sell, s: "과열·저항권 — 보유 시 분할 익절 우선" };
  if (r.verdict.tone === "buy" && finalScore >= 80) return { w: "사라", c: T.buy, s: "조건 충족 — 계획된 분할 매수 관심" };
  if (r.verdict.tone === "buy" && finalScore >= 60) return { w: "사도 된다", c: T.buy, s: "조건 일부 충족 — 소량 분할 접근" };
  return { w: "기다려라", c: T.warn, s: "신호 부족 — 조건 완성까지 관망" };
}
function riskList(r, filings, earnings) {
  const out = [];
  if (earnings) {
    const d = Math.ceil((new Date(earnings) - Date.now()) / 86400000);
    if (d >= 0 && d <= 10) out.push(`📅 실적 발표 D-${d} (${earnings}) — 발표 전후 변동성 확대 주의`);
  }
  if (r.regime && r.regime.adj < 0) out.push(`시장 국면: ${r.regime.label} — ${r.regime.advice}`);
  if ((r.rsi ?? 50) >= 70) out.push(`RSI ${r.rsi.toFixed(0)} — 단기 과열권`);
  if (r.devATR >= 2) out.push(`20일선 이격 ${r.devATR.toFixed(1)} ATR — 되돌림 여지 큼`);
  if (r.heat >= 80) out.push(`과열도 ${r.heat}/100 — 최근 1년 상위권`);
  if (!r.above200) out.push("200일선 아래 — 장기 추세 미확인 구간");
  if (r.zones[0] && r.zones[0].rr != null && r.zones[0].rr < 1) out.push(`1차 목표 손익비 ${r.zones[0].rr.toFixed(1)}:1 — 진입 매력 낮음`);
  (filings || []).filter((f) => /유상증자|전환사채|신주인수권|감자|소송|횡령|배임|담보|관리종목|정정/.test(f.title)).slice(0, 2)
    .forEach((f) => out.push(`⚠ 공시 주의 (${f.date}): ${f.title.slice(0, 34)}`));
  if (r.prob && r.prob.pStop != null && r.prob.pStop > (r.prob.pTarget ?? 0)) out.push(`과거 유사 조건에서 손절 선도달(${r.prob.pStop}%)이 목표 선도달(${r.prob.pTarget}%)보다 많았음`);
  return out;
}

function decideAction(r, finalScore) {
  const pos = r.position;
  const inZone = r.zones[0] && r.price >= r.zones[0].lo;
  if (!pos) {
    if (r.trendLabel === "하락" || (r.regime && r.regime.tone === "sell" && finalScore < 55))
      return { act: "신규 진입 금지", pct: 0, tone: "sell", why: "시장·종목이 하락 국면 — 반등 확인 전 진입은 손익비가 불리합니다.", inval: "일봉 종가가 20일선 위로 복귀하고 시장 국면이 회복되면 관망으로 변경." };
    if (r.heat >= 80 || inZone)
      return { act: "진입 보류 · 과열 대기", pct: 0, tone: "warn", why: `단기 과열(과열도 ${r.heat}) — 추격 진입은 되돌림 위험이 큽니다.`, inval: `거래량을 동반해 ${r.zones[0] ? M(r.zones[0].hi, r.ticker) + " 위로" : "저항을"} 돌파하면 돌파매수 관점으로 변경.` };
    if (finalScore >= 80)
      return { act: "1차 30% 진입", pct: 30, tone: "buy", why: `${r.trendLabel} 추세 + 눌림 + 지지 확인 — 진입 조건이 충족되었습니다.`, inval: `종가가 ${M(r.stop, r.ticker)}을 이탈하면 의견 철회.` };
    if (finalScore >= 60)
      return { act: "1차 20% 진입", pct: 20, tone: "buy", why: "조건 일부 충족 — 소규모로 먼저 진입하고 확인 후 늘리는 접근이 유리합니다.", inval: `종가 ${M(r.stop, r.ticker)} 이탈 또는 시장 국면 하락 전환 시 철회.` };
    return { act: "눌림목 대기", pct: 0, tone: "hold", why: `신호 부족(종합 ${finalScore}점) — 더 유리한 가격을 기다리는 구간입니다.`, inval: `${r.nearSup ? M(r.nearSup.p, r.ticker) + " 지지 확인" : "지지 형성"} + 거래량 감소가 확인되면 진입 의견으로 변경.` };
  }
  const pl = pos.pl;
  if (r.trendLabel === "하락")
    return pl >= 0
      ? { act: "전량매도 후 재진입 감시", pct: -100, tone: "sell", why: "추세 훼손 — 수익 보전이 우선입니다.", inval: "20일선 회복 + 정배열 복귀 시 재진입 검토." }
      : { act: "반등 시 50% 축소", pct: -50, tone: "sell", why: "하락 추세 + 손실권 — 물타기보다 리스크 축소가 원칙입니다.", inval: "거래량 동반 20일선 회복 시 보유로 변경." };
  if (r.heat >= 80 || inZone)
    return { act: "30% 부분매도", pct: -30, tone: "sell", why: `단기 과열${inZone ? " + 1차 저항권 진입" : ""}이나 중기 상승추세는 유지되고 있습니다.`, inval: `거래량을 동반해 ${r.zones[0] ? M(r.zones[0].hi, r.ticker) + " 위로" : "저항을"} 돌파하면 부분매도 의견을 보유로 변경.` };
  if (pl >= 10)
    return { act: "보유 유지 · 수익보호선 상향", pct: 0, tone: "buy", why: "추세 생존 + 수익권 — 이익을 태우며 방어선만 끌어올리는 구간입니다.", inval: `종가 ${M(Math.max(r.stop, Math.round(pos.avg * 1.02)), r.ticker)} 이탈 시 전량 정리.` };
  if (pl <= -5 && finalScore < 60)
    return { act: "추가매수 금지 · 손절선 엄수", pct: 0, tone: "warn", why: "손실권 + 신호 부족 — 물타기는 위험을 키웁니다.", inval: `종가 ${M(r.stop, r.ticker)} 이탈 시 원칙대로 손절.` };
  return { act: "보유 유지", pct: 0, tone: "hold", why: `${r.trendLabel} 추세 유지 — 기존 계획대로 진행합니다.`, inval: `종가 ${M(r.stop, r.ticker)} 이탈 또는 과열도 80 돌파 시 재평가.` };
}

function DecisionCard({ r, finalScore, inWl, toggleWl, showLive, showHeader, earnings }) {
  const d = decideAction(r, finalScore);
  const c = toneColor(d.tone);
  const conf = r.prob ? (r.prob.n >= 20 ? "높음" : r.prob.n >= 10 ? "보통" : "낮음") : "낮음(데이터 부족)";
  const posQty = r.position?.qty || 0;
  const sellQty = d.pct < 0 && posQty ? Math.round((posQty * Math.abs(d.pct)) / 100) : null;
  const sups = r.supports.slice(0, 2).map((s) => s.p);
  const reentry = sups.length >= 2 ? `${M(Math.min(...sups), r.ticker)} ~ ${M(Math.max(...sups), r.ticker)}` : sups.length ? `${M(sups[0], r.ticker)} 부근` : "—";
  const defLine = r.position && r.position.pl > 3 ? Math.max(r.stop, Math.round(r.position.avg * 1.02)) : r.stop;
  const now = new Date();
  const ts = `${now.getMonth() + 1}월 ${now.getDate()}일 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const rows = [
    ["현재가", `${M(r.price, r.ticker)}`],
    r.position ? ["내 평단가", `${M(r.position.avg, r.ticker)} (${pct(r.position.pl)})`] : null,
    ["추천 행동", d.pct > 0 ? `투입 예정 자금의 ${d.pct}% 진입` : d.pct < 0 ? `보유수량의 ${Math.abs(d.pct)}% 매도${sellQty ? ` ≈ ${fmt(sellQty)}주` : ""}` : "현 상태 유지 / 대기"],
    ["1차 목표가", r.zones[0] ? `${M(r.zones[0].center, r.ticker)}` : "신고가권 — 트레일링"],
    ["손절·방어선", `${M(defLine, r.ticker)}`],
    ["재진입 후보", reentry],
    ["예상 손익비", r.zones[0]?.rr != null ? `1 : ${r.zones[0].rr.toFixed(1)}` : "—"],
    (() => { if (!earnings) return null; const dd = Math.ceil((new Date(earnings) - Date.now()) / 86400000); return dd >= 0 && dd <= 14 ? ["📅 실적 발표", `D-${dd} (${earnings})`] : null; })(),
    ["판단 신뢰도", `${conf}${r.prob ? ` · 유사사례 ${r.prob.n}회` : ""}`],
    ["분석 시각", ts],
  ].filter(Boolean);
  return (
    <Card style={{ marginTop: 14, background: "linear-gradient(180deg,#0E1219,#0A0E16)", borderColor: c + "77" }}>
      {showHeader && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ fontFamily: T.serif, fontSize: 23, fontWeight: 800 }}>
            {r.name} <span style={{ fontSize: 13, color: T.sub, fontFamily: T.mono, fontWeight: 400 }}>{r.ticker}</span>
          </div>
          <span onClick={toggleWl} style={{
            cursor: "pointer", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
            color: inWl ? T.warn : T.sub, border: `1px solid ${inWl ? T.warn : T.line}`, borderRadius: 20, padding: "5px 11px",
          }}>{inWl ? "★ 관심중" : "☆ 관심등록"}</span>
        </div>
      )}
      {showLive && r.isLive && <LiveWatch ticker={r.ticker} />}
      <div style={{ textAlign: "center", padding: "14px 0 6px" }}>
        <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: "0.3em", color: c }}>현재 판단</div>
        <div style={{ fontFamily: T.serif, fontSize: 34, fontWeight: 900, color: c, marginTop: 4, lineHeight: 1.25 }}>{d.act}</div>
        <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint, marginTop: 4 }}>종합 {finalScore}/100</div>
      </div>
      <div style={{ marginTop: 8 }}>
        {rows.map(([k, v], i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: `1px dashed ${T.line}`, fontSize: 13.5 }}>
            <span style={{ color: T.sub, fontFamily: T.mono, fontSize: 12 }}>{k}</span>
            <span style={{ color: T.ink, fontWeight: 700, textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7 }}>
        <div><span style={{ color: T.info, fontFamily: T.mono, fontSize: 11.5 }}>판단 근거</span> <span style={{ color: T.ink }}>{d.why}</span></div>
        <div style={{ marginTop: 5 }}><span style={{ color: T.warn, fontFamily: T.mono, fontSize: 11.5 }}>무효화 조건</span> <span style={{ color: T.ink }}>{d.inval}</span></div>
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.faint, marginTop: 12, lineHeight: 1.6 }}>
        데이터 기준 — 시세: 실시간 폴링 + 일봉 {r.date} · 뉴스: 최근 72시간 (네이버·구글·야후) · 공시: 최근 제출분
      </div>
    </Card>
  );
}

function FactorPanel({ r, news, filings }) {
  const [oi, setOi] = useState(-1);
  const vol = (r.buyRows && r.buyRows[3] && r.buyRows[3].detail) || "—";
  const rows = [
    { name: "추세", tone: r.trendLabel === "상승" ? "buy" : r.trendLabel === "하락" ? "sell" : "hold",
      sum: `중기 ${r.trendLabel}${r.heat >= 70 ? ", 단기 과열" : r.depression >= 70 ? ", 단기 눌림" : ""}`,
      detail: [["정배열", r.aligned ? "충족" : "미충족"], ["ADX 추세강도", `${r.adxV.toFixed(0)} (${r.adxStrong ? "강" : "약"})`], ["200일선", r.above200 ? "위" : "아래"], ["데이터 기준", `일봉 ${r.date}`]] },
    { name: "모멘텀", tone: (r.macdHist ?? 0) > 0 ? "buy" : "sell",
      sum: `RSI ${(r.rsi ?? 0).toFixed(0)}${r.rsi >= 70 ? " 과열" : r.rsi <= 35 ? " 과매도" : ""} · MACD ${(r.macdHist ?? 0) > 0 ? "상승" : "둔화"}`,
      detail: [["RSI(14)", (r.rsi ?? 0).toFixed(1)], ["MACD 히스토그램", (r.macdHist ?? 0).toFixed(0)], ["스토캐스틱 %K", (r.stochK ?? 0).toFixed(0)], ["10일 모멘텀", pct(r.mom10)], ["데이터 기준", `일봉 ${r.date}`]] },
    { name: "거래량·수급", tone: r.obvUp ? "buy" : "sell",
      sum: `${r.obvUp ? "매집 우위" : "분산 우위"} · 거래량 ${vol}`,
      detail: [["OBV 20일 수급", r.obvUp ? "순매집" : "순분산"], ["거래량 최근/직전", vol], ["볼린저 %B", (r.pb ?? 0).toFixed(2)], ["데이터 기준", `일봉 ${r.date}`]] },
    { name: "기업·이벤트", tone: news ? (news.sentiment >= 15 ? "buy" : news.sentiment <= -15 ? "sell" : "hold") : "hold",
      sum: news ? `뉴스 감성 ${news.sentiment > 0 ? "+" : ""}${news.sentiment}${filings && filings.length ? ` · 공시 ${filings.length}건` : ""}` : "뉴스 분석 중…",
      detail: [["뉴스 감성", news ? `${news.sentiment} — ${(news.mood || "").slice(0, 24)}` : "—"], ["최근 공시", filings && filings.length ? `${filings[0].date} ${filings[0].title.slice(0, 20)}…` : "없음"], ["뉴스 기준", "최근 72시간 · 네이버+구글+야후"], ["공시 기준", "최근 제출분 (네이버/SEC EDGAR)"]] },
    { name: "시장 환경", tone: (r.regime && r.regime.tone) || "hold",
      sum: r.regime ? `${r.regime.label} · ${r.regime.advice}` : "미판정",
      detail: [["판정 지수", /\.(KS|KQ)$/i.test(r.ticker) ? "KOSPI" : "S&P500"], ["국면", (r.regime && r.regime.label) || "—"], ["점수 반영", r.regime ? `${r.regime.adj > 0 ? "+" : ""}${r.regime.adj}점` : "0점"], ["판정 기준", "지수 일봉 20/60일선 + 20일 변동성"]] },
  ];
  return (
    <Card style={{ marginTop: 14 }}>
      <Eyebrow color={T.info}>WHY · 분석 근거 5영역 (탭하면 상세)</Eyebrow>
      {rows.map((f, i) => (
        <div key={i}>
          <div onClick={() => setOi(oi === i ? -1 : i)} style={{ display: "flex", gap: 10, padding: "11px 0", borderBottom: `1px dashed ${T.line}`, cursor: "pointer", alignItems: "baseline" }}>
            <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.sub, minWidth: 78 }}>{f.name}</span>
            <span style={{ flex: 1, fontSize: 13.5, color: toneColor(f.tone), fontWeight: 600 }}>{f.sum}</span>
            <span style={{ color: T.faint, fontSize: 11 }}>{oi === i ? "▴" : "▾"}</span>
          </div>
          {oi === i && (
            <div style={{ background: T.card2, borderRadius: 10, padding: "10px 12px", margin: "8px 0" }}>
              {f.detail.map(([k, v], j) => (
                <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontFamily: T.mono, padding: "4px 0" }}>
                  <span style={{ color: T.faint }}>{k}</span><span style={{ color: T.ink }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function SummaryView({ r, news, newsLoading, finalScore, nAdj, regAdj, selfAdj, filings, earnings, inWl, toggleWl }) {
  const risks = riskList(r, filings, earnings).slice(0, 3);
  return (
    <>
      <DecisionCard r={r} finalScore={finalScore} inWl={inWl} toggleWl={toggleWl} showLive showHeader earnings={earnings} />
      {r.prob && (
        <Card style={{ marginTop: 14 }}>
          <Eyebrow color={T.info}>과거 유사 조건 {r.prob.n}회 실측</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", fontFamily: T.mono, fontSize: 13 }}>
            <div><span style={{ color: T.sub, fontSize: 11.5 }}>5일 상승확률</span><div style={{ fontSize: 19, fontWeight: 800, color: r.prob.pUp5 >= 55 ? T.buy : r.prob.pUp5 <= 45 ? T.sell : T.warn }}>{r.prob.pUp5}%</div></div>
            <div><span style={{ color: T.sub, fontSize: 11.5 }}>5일 예상(중앙)</span><div style={{ fontSize: 19, fontWeight: 800, color: r.prob.med5 >= 0 ? T.buy : T.sell }}>{pct(r.prob.med5)}</div></div>
            <div style={{ gridColumn: "1 / -1", fontSize: 12, color: T.sub }}>변동범위 {pct(r.prob.p10)} ~ {pct(r.prob.p90)} · 20일 중앙 {pct(r.prob.med20)}</div>
            {r.prob.pTarget != null && <div style={{ gridColumn: "1 / -1", fontSize: 12.5 }}>목표 선도달 <b style={{ color: T.buy }}>{r.prob.pTarget}%</b> vs 손절 선도달 <b style={{ color: T.sell }}>{r.prob.pStop}%</b> · 기대값 <b style={{ color: r.prob.ev > 0 ? T.buy : T.sell }}>{pct(r.prob.ev)}</b></div>}
          </div>
        </Card>
      )}
      <FactorPanel r={r} news={news} filings={filings} />
      {risks.length > 0 && (
        <Card style={{ marginTop: 14, borderColor: T.sell + "44" }}>
          <Eyebrow color={T.sell}>핵심 위험</Eyebrow>
          {risks.map((x, i) => <div key={i} style={{ fontSize: 13, color: T.ink, lineHeight: 1.8 }}>· {x}</div>)}
        </Card>
      )}
      {newsLoading && <div style={{ color: T.info, fontSize: 12.5, marginTop: 10, textAlign: "center", fontFamily: T.mono }}>뉴스·공시 반영 중… 잠시 후 판단이 갱신됩니다</div>}
    </>
  );
}

function BuyPlan({ r }) {
  if (r.verdict.tone === "sell" || r.trendLabel === "하락") return null;
  const entryLo = r.nearSup ? r.nearSup.p : r.supports[0]?.p ?? Math.round(r.price * 0.97);
  const chase = Math.round(r.price + 0.5 * r.a);
  const rows = [
    ["진입 관심구간", `${M(Math.min(entryLo, r.price), r.ticker)} ~ ${M(r.price, r.ticker)}`, T.buy],
    ["추격 제한", `${M(chase, r.ticker)} 이상 추격 금지 (+0.5 ATR)`, T.warn],
    ["분할 진입", "1차 50% → 지지 확인 후 30% → 돌파 확인 시 20%", T.info],
    ["손절 기준", `종가 ${M(r.stop, r.ticker)} 하회 시 전량`, T.sell],
    ["1차 목표", r.zones[0] ? `${M(r.zones[0].center, r.ticker)} (40% 익절) · 손익비 ${r.zones[0].rr?.toFixed(1) ?? "—"}:1` : "저항 부재 — 트레일링", T.buy],
    ["2차 목표", r.zones[1] ? `${M(r.zones[1].center, r.ticker)} · 잔량 트레일링` : "고점 -1 ATR 트레일링", T.info],
    ["권장 보유", "3~15거래일 (스윙)", T.sub],
    ["무효화 조건", `종가 20일선 이탈 · 시장 국면 하락 전환 · ${r.prob && r.prob.ev <= 0 ? "기대값 음수 지속" : "재료 소멸"}`, T.warn],
  ];
  return (
    <Card style={{ marginTop: 14 }}>
      <Eyebrow color={T.buy}>TRADE PLAN · 자동 매매계획 (매수 시)</Eyebrow>
      {rows.map(([k, v, c], i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: `1px dashed ${T.line}`, fontSize: 13.5 }}>
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: c, minWidth: 78, paddingTop: 2 }}>{k}</span>
          <span style={{ color: T.ink, lineHeight: 1.55 }}>{v}</span>
        </div>
      ))}
      {r.prob && <div style={{ fontFamily: T.mono, fontSize: 12.5, color: T.sub, marginTop: 10 }}>기대값(과거 유사 {r.prob.n}회, 비용 0.3% 차감): <b style={{ color: r.prob.ev > 0 ? T.buy : T.sell }}>{pct(r.prob.ev)}</b> — {r.prob.ev > 0 ? "양의 기대값" : "음의 기대값: 진입 보류 권장"}</div>}
    </Card>
  );
}

function SellPlan({ r }) {
  const pos = r.position; if (!pos) return null;
  const avg = pos.avg, pl = pos.pl;
  const fromAvg = (p) => `${((p - avg) / avg * 100) >= 0 ? "+" : ""}${(((p - avg) / avg) * 100).toFixed(1)}%`;
  const effStop = pl > 3 ? Math.max(r.stop, Math.round(avg * 1.01)) : r.stop;
  const steps = [];
  if (r.heat >= 80) steps.push({ tag: "지금", color: T.sell, title: "과열권 진입 — 보유분 1/3 즉시 분할 익절 검토", sub: `과열도 ${r.heat}/100 · 현재가 ${M(r.price, r.ticker)} (평단 대비 ${fromAvg(r.price)})` });
  else if (r.trendLabel === "하락") steps.push({ tag: "지금", color: T.sell, title: "추세 훼손 — 반등 시 비중 축소 우선", sub: "신규 물타기보다 리스크 축소가 원칙" });
  else if (r.zones[0] && r.price >= r.zones[0].lo) steps.push({ tag: "지금", color: T.warn, title: "1차 매도 구간 안 — 분할 익절 진행 구간", sub: `${M(r.zones[0].lo, r.ticker)} ~ ${M(r.zones[0].hi, r.ticker)} 구간 내` });
  r.zones.slice(0, 3).forEach((z, i) => {
    const share = i === 0 ? "1/3 익절" : i === 1 ? "추가 1/3 익절" : "잔량 트레일링 전환";
    steps.push({ tag: `${z.order}차`, color: i === 0 ? T.buy : T.info, title: `${M(z.center, r.ticker)} 부근 — ${share}`, sub: `평단 대비 ${fromAvg(z.center)} · 저항강도 ${z.strength}/100` });
  });
  steps.push({ tag: "잔량", color: T.info, title: "고점 대비 1 ATR(" + fmt(r.a) + "원) 이탈 시 전량 정리", sub: "추세가 살아있는 동안 최대한 태우는 트레일링 스탑" });
  steps.push({ tag: "방어", color: T.sell, title: `${M(effStop, r.ticker)} 이탈 시 전량 손절`, sub: pl > 3 ? `수익권 — 손절선을 평단 위(본전 방어)로 상향 적용` : `기술적 손절선 (평단 대비 ${fromAvg(effStop)})` });
  return (
    <Card style={{ marginTop: 14, borderColor: T.warn + "55" }}>
      <Eyebrow color={T.warn}>SELL PLAN · 내 평단 기준 매도 플랜</Eyebrow>
      <div style={{ fontFamily: T.mono, fontSize: 13, color: T.sub, marginBottom: 10 }}>
        평단 {M(avg, r.ticker)} · 현재 <span style={{ color: pl >= 0 ? T.buy : T.sell, fontWeight: 700 }}>{pct(pl)}</span> · {r.trendLabel === "상승" ? "추세 생존 — 전량 매도보다 분할 우위" : "추세 약화 — 방어 우선"}
      </div>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "11px 0", borderBottom: `1px dashed ${T.line}` }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: s.color, minWidth: 34, paddingTop: 2 }}>{s.tag}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, lineHeight: 1.5 }}>{s.title}</div>
            <div style={{ fontSize: 12.5, color: T.sub, marginTop: 3, fontFamily: T.mono }}>{s.sub}</div>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11.5, color: T.faint, marginTop: 10, lineHeight: 1.6 }}>
        뉴스·공시 급변 시 우선순위가 바뀔 수 있습니다.
      </div>
    </Card>
  );
}

/* 개별 분석 가이드(사라/팔아라) 자체 채점 */
const vhLoad = () => { try { return JSON.parse(localStorage.getItem("sd_vh") || "[]"); } catch { return []; } };
const vhSave = (h) => { try { localStorage.setItem("sd_vh", JSON.stringify(h.slice(-80))); } catch {} };
function recordVerdict(r) {
  if (!r.isLive) return;
  const today = new Date().toISOString().slice(0, 10);
  const h = vhLoad();
  if (h.some((e) => e.date === today && e.ticker === r.ticker)) return;
  h.push({ date: today, ticker: r.ticker, name: r.name, tone: r.verdict.tone, score: r.composite, p0: r.price, r1: null, r5: null, r20: null });
  vhSave(h);
}
async function evalVerdicts() {
  const h = vhLoad(); let changed = false;
  const need = [...new Set(h.filter((p) => p.p0 && p.r20 == null).map((p) => p.ticker))].slice(0, 6);
  const charts = {};
  for (const t of need) { try { charts[t] = (await fetchChart(t)).data; } catch {} }
  h.forEach((p) => {
    const d = charts[p.ticker]; if (!d || !p.p0) return;
    const i0 = d.findIndex((x) => x.date > p.date); if (i0 < 0) return;
    const ret = (k) => (d[i0 + k - 1] ? +(((d[i0 + k - 1].close - p.p0) / p.p0) * 100).toFixed(1) : null);
    for (const [key, k] of [["r1", 1], ["r5", 5], ["r20", 20]]) {
      if (p[key] == null) { const v = ret(k); if (v != null) { p[key] = v; changed = true; } }
    }
  });
  if (changed) vhSave(h);
  return h;
}
const marketOf = (t) => (/\.(KS|KQ)$/i.test(String(t || "")) ? "KR" : "US");
function guideStats(h, market) {
  const ev = h.filter((p) => p.r5 != null && p.tone !== "hold" && (!market || marketOf(p.ticker) === market));
  if (ev.length < 3) return null;
  const ok = ev.filter((p) => (p.tone === "buy" ? p.r5 > 0 : p.r5 < 0)).length;
  return { n: ev.length, acc: Math.round((ok / ev.length) * 100) };
}
function mergeHist(server, local) {
  const s = server || [], l = local || [];
  const keys = new Set(s.map((e) => e.date + e.market));
  return [...l.filter((e) => !keys.has(e.date + e.market)), ...s].sort((a, b) => (a.date < b.date ? -1 : 1));
}
let SRV_HIST = { t: 0, entries: null };
async function loadServerHist() {
  if (Date.now() - SRV_HIST.t < 60000 && SRV_HIST.entries) return SRV_HIST.entries;
  try {
    const j = await (await fetch("/api/picks-data?what=history")).json();
    if (j && Array.isArray(j.entries)) { SRV_HIST = { t: Date.now(), entries: j.entries }; return j.entries; }
  } catch {}
  return null;
}
const reviewLoad = () => { try { return JSON.parse(localStorage.getItem("sd_review2") || "{}"); } catch { return {}; } };
const reviewSave = (r) => { try { localStorage.setItem("sd_review2", JSON.stringify(r)); } catch {} };
function buildReviewStr(h, v, market) {
  const lines = [];
  h.filter((e) => e.market === market).flatMap((e) => e.picks.map((p) => ({ ...p, date: e.date }))).filter((p) => p.r1 != null).slice(-14).forEach((p) => {
    lines.push(p.kind === "day"
      ? `[단타] ${p.date} ${p.name}: 목표+${p.target}% ${p.hit ? "적중" : "미달"}, 당일 ${p.r1}%`
      : `[스윙] ${p.date} ${p.name}: 1일 ${p.r1}% / 5일 ${p.r5 ?? "?"}% / 20일 ${p.r20 ?? "?"}%`);
  });
  v.filter((p) => p.r5 != null && marketOf(p.ticker) === market).slice(-8).forEach((p) => {
    lines.push(`[가이드] ${p.date} ${p.name}: ${p.tone === "buy" ? "매수" : p.tone === "sell" ? "매도" : "관망"} 판정 → 5일 ${p.r5}%`);
  });
  return lines.join("\n");
}
async function fullHistoryStrA(market) {
  const h = mergeHist(await loadServerHist(), histLoad());
  const parts = [perfSummary(h.length !== undefined ? h : histLoad(), market), daySummary(h, market)];
  const rv = reviewLoad()[market];
  if (rv?.data?.lessons?.length) parts.push(`이 시장(${market === "KR" ? "국내" : "미국"})의 과거 복기 교훈: ${rv.data.lessons.join(" / ")}. 이 교훈을 이번 판단에 반드시 반영해 종합 점수를 높여라.`);
  const gs = guideStats(vhLoad(), market);
  if (gs) parts.push(`이 시장 개별 가이드의 5일 적중률: ${gs.acc}% (${gs.n}건).`);
  return parts.filter(Boolean).join(" ");
}
function fullHistoryStr(market) {
  const h = histLoad();
  const parts = [perfSummary(h, market), daySummary(h, market)];
  const rv = reviewLoad();
  if (rv?.data?.lessons?.length) parts.push(`과거 복기에서 얻은 교훈: ${rv.data.lessons.join(" / ")}. 이 교훈을 이번 판단에 반드시 반영해 종합 점수를 높여라.`);
  const gs = guideStats(vhLoad());
  if (gs) parts.push(`개별 종목 매수/매도 가이드의 5일 적중률: ${gs.acc}% (${gs.n}건). 적중률이 낮으면 더 보수적으로, 높으면 기존 기준을 유지하라.`);
  return parts.filter(Boolean).join(" ");
}

function TrackRecord({ refreshKey }) {
  const [hist, setHist] = useState(null);
  const [vh, setVh] = useState([]);
  const [review, setReview] = useState(null);
  const [revLoading, setRevLoading] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    (async () => {
      const [sh, lh, v] = await Promise.all([
        loadServerHist(),
        evalHistory().catch(() => histLoad()),
        evalVerdicts().catch(() => vhLoad()),
      ]);
      const h = mergeHist(sh, lh);
      setHist(h); setVh(v);
      const today = new Date().toISOString().slice(0, 10);
      const store = reviewLoad();
      const out = {};
      for (const m of ["KR", "US"]) {
        const graded = h.filter((e) => e.market === m).flatMap((e) => e.picks).filter((p) => p.r1 != null).length
          + v.filter((p) => p.r1 != null && marketOf(p.ticker) === m).length;
        if (graded < 5) continue;
        if (store[m] && store[m].date === today) { out[m] = store[m].data; continue; }
        try {
          setRevLoading(true);
          const j = await callAI({ kind: "review", history: `[${m === "KR" ? "국내" : "미국"} 시장 성적]\n` + buildReviewStr(h, v, m) });
          store[m] = { date: today, data: j };
          reviewSave(store);
          out[m] = j;
        } catch {}
      }
      setRevLoading(false);
      setReview(out);
    })();
  }, [refreshKey]);
  if (!hist || !hist.length) return null;
  const all = hist.flatMap((e) => e.picks.map((p) => ({ ...p, date: e.date, market: e.market })));
  const swing = all.filter((p) => p.kind !== "day");
  const day = all.filter((p) => p.kind === "day");
  const rc = (v) => (v == null || isNaN(v) ? T.faint : v > 0 ? T.buy : v < 0 ? T.sell : T.sub);
  const statsFor = (m) => {
    const sw = swing.filter((p) => p.market === m), dy = day.filter((p) => p.market === m);
    const s5 = sw.filter((p) => p.r5 != null);
    const winRate = s5.length ? Math.round((s5.filter((p) => p.r5 > 0).length / s5.length) * 100) : null;
    const sEv = sw.filter((p) => p.r1 != null);
    const avg = (k) => { const v = sEv.filter((p) => p[k] != null); return v.length ? (v.reduce((s, p) => s + p[k], 0) / v.length).toFixed(1) : null; };
    const dEv = dy.filter((p) => p.r1 != null);
    const hitRate = dEv.length ? Math.round((dEv.filter((p) => p.hit).length / dEv.length) * 100) : null;
    const dAvg = dEv.length ? (dEv.reduce((s, p) => s + p.r1, 0) / dEv.length).toFixed(1) : null;
    const g = guideStats(vh, m);
    const comps = [winRate, hitRate, g && g.acc].filter((x) => x != null);
    return { winRate, avg, hitRate, dAvg, g, sEvN: sEv.length, dEvN: dEv.length, total: comps.length ? Math.round(comps.reduce((a, b) => a + b, 0) / comps.length) : null };
  };
  const K = statsFor("KR"), U = statsFor("US");
  const secT = { fontFamily: T.mono, fontSize: 11, letterSpacing: "0.22em", margin: "14px 0 8px" };
  const Row = ({ p, dayMode }) => (
    <div style={{ display: "flex", gap: 8, padding: "8px 0", borderBottom: `1px dashed ${T.line}`, fontSize: 12.5, alignItems: "center" }}>
      <span style={{ color: T.faint, fontFamily: T.mono, fontSize: 10.5, minWidth: 44 }}>{p.date.slice(5)}</span>
      <span style={{ flex: 1, color: T.ink, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.market === "KR" ? "🇰🇷 " : "🇺🇸 "}{p.name}</span>
      <span style={{ fontFamily: T.mono, color: rc(p.r1), minWidth: 46, textAlign: "right" }}>{p.r1 != null ? `${p.r1 > 0 ? "+" : ""}${p.r1}%` : "채점전"}</span>
      {dayMode ? (
        <span style={{ fontFamily: T.mono, color: p.hit == null ? T.faint : p.hit ? T.buy : T.sell, minWidth: 92, textAlign: "right" }}>
          {p.hit == null ? "·" : p.hit ? `목표+${p.target}% ✓` : `목표+${p.target}% ✗`}
        </span>
      ) : (
        <>
          <span style={{ fontFamily: T.mono, color: rc(p.r5), minWidth: 46, textAlign: "right" }}>{p.r5 != null ? `${p.r5 > 0 ? "+" : ""}${p.r5}%` : "·"}</span>
          <span style={{ fontFamily: T.mono, color: rc(p.r20), minWidth: 46, textAlign: "right" }}>{p.r20 != null ? `${p.r20 > 0 ? "+" : ""}${p.r20}%` : "·"}</span>
        </>
      )}
    </div>
  );
  return (
    <Card style={{ marginBottom: 16 }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", gap: 10 }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: "0.3em", color: T.info }}>TRACK RECORD · AI 추천 성적표</span>
        <span style={{ fontFamily: T.mono, fontSize: 13, color: T.sub, whiteSpace: "nowrap" }}>
          {K.total != null && <span>🇰🇷 <b style={{ fontFamily: T.serif, fontSize: 18, color: K.total >= 50 ? T.info : T.sell }}>{K.total}</b></span>}
          {U.total != null && <span style={{ marginLeft: 8 }}>🇺🇸 <b style={{ fontFamily: T.serif, fontSize: 18, color: U.total >= 50 ? T.info : T.sell }}>{U.total}</b></span>}
          {K.total == null && U.total == null && "집계 전"} {open ? "▴" : "▾"}
        </span>
      </div>
      {!open && (
        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.faint, marginTop: 6 }}>
          {K.total != null || U.total != null ? "시장별 종합 점수 (스윙·단타·가이드 평균) — 탭하면 상세" : `기록 ${all.length}건 · 첫 채점부터 시장별 점수 집계 — 탭하면 상세`}
        </div>
      )}
      {open && (<>
      {swing.length > 0 && (
        <>
          <div style={{ ...secT, color: T.buy }}>스윙 추천</div>
          {K.sEvN + U.sEvN === 0 ? (
            <div style={{ color: T.sub, fontSize: 12.5, marginBottom: 4 }}>기록 {swing.length}건 — 다음 거래일부터 채점됩니다</div>
          ) : (
            [["🇰🇷", K], ["🇺🇸", U]].map(([f, S]) => S.sEvN > 0 && (
              <div key={f} style={{ fontFamily: T.mono, fontSize: 12.5, color: T.sub, marginBottom: 5 }}>
                {f} {S.winRate != null ? <>승률 <b style={{ color: S.winRate >= 50 ? T.buy : T.sell }}>{S.winRate}%</b></> : "승률 —"}
                {" · 1일 "}<b style={{ color: rc(+S.avg("r1")) }}>{S.avg("r1") ?? "—"}%</b>
                {" · 5일 "}<b style={{ color: rc(+S.avg("r5")) }}>{S.avg("r5") ?? "—"}%</b>
                {" · 20일 "}<b style={{ color: rc(+S.avg("r20")) }}>{S.avg("r20") ?? "—"}%</b>
              </div>
            ))
          )}
          {[...swing].reverse().slice(0, 6).map((p, i) => <Row key={"s" + i} p={p} />)}
        </>
      )}
      {day.length > 0 && (
        <>
          <div style={{ ...secT, color: T.sell }}>⚡ 당일 단타</div>
          {K.dEvN + U.dEvN === 0 ? (
            <div style={{ color: T.sub, fontSize: 12.5, marginBottom: 4 }}>기록 {day.length}건 — 당일 장 마감 후 채점됩니다</div>
          ) : (
            [["🇰🇷", K], ["🇺🇸", U]].map(([f, S]) => S.dEvN > 0 && (
              <div key={f} style={{ fontFamily: T.mono, fontSize: 12.5, color: T.sub, marginBottom: 5 }}>
                {f} 목표 적중 <b style={{ color: S.hitRate >= 50 ? T.buy : T.sell }}>{S.hitRate}%</b> · 평균 당일 <b style={{ color: rc(+S.dAvg) }}>{S.dAvg}%</b>
              </div>
            ))
          )}
          {[...day].reverse().slice(0, 6).map((p, i) => <Row key={"d" + i} p={p} dayMode />)}
        </>
      )}
      {(K.g || U.g) && (
        <div style={{ fontFamily: T.mono, fontSize: 12.5, color: T.sub, marginTop: 10 }}>
          가이드 적중률(5일):
          {K.g && <> 🇰🇷 <b style={{ color: K.g.acc >= 50 ? T.buy : T.sell }}>{K.g.acc}%</b>({K.g.n})</>}
          {U.g && <> 🇺🇸 <b style={{ color: U.g.acc >= 50 ? T.buy : T.sell }}>{U.g.acc}%</b>({U.g.n})</>}
        </div>
      )}
      {revLoading && <div style={{ color: T.sub, fontSize: 12.5, marginTop: 12 }}>🎓 AI 코치가 성적을 복기하는 중…</div>}
      {review && ["KR", "US"].map((m) => review[m] && review[m].comment && (
        <div key={m} style={{ marginTop: 14, background: T.card2, borderRadius: 12, padding: 13 }}>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.warn, letterSpacing: "0.22em", marginBottom: 8 }}>🎓 AI 코치 · {m === "KR" ? "🇰🇷 국내장" : "🇺🇸 미국장"} 정성 평가</div>
          <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.7 }}>{review[m].comment}</div>
          {(review[m].lessons || []).map((l, i) => (
            <div key={i} style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.7, marginTop: i === 0 ? 8 : 2 }}>· {l}</div>
          ))}
          {review[m].focus && (
            <div style={{ marginTop: 10, borderLeft: `3px solid ${T.info}`, paddingLeft: 10, fontSize: 12.5, color: T.info, lineHeight: 1.6 }}>
              다음 집중 개선: {review[m].focus}
            </div>
          )}
        </div>
      ))}
      <div style={{ fontSize: 11.5, color: T.info, marginTop: 10, lineHeight: 1.6 }}>
        🧠 성적과 코치 교훈은 다음 분석·추천에 자동 반영되어 종합 점수를 스스로 끌어올리도록 설계되어 있습니다.
      </div>
      </>)}
    </Card>
  );
}

/* ========== 메인 앱 ========== */
export default function App() {
  const [query, setQuery] = useState("SK하이닉스 (000660.KS)");
  const [sugOpen, setSugOpen] = useState(false);
  const [avg, setAvg] = useState("");
  const [qty, setQty] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [news, setNews] = useState(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsErr, setNewsErr] = useState("");
  const [filings, setFilings] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("all"); // all | buy | sell
  const [view, setView] = useState("summary"); // summary | detail
  const [picks, setPicks] = useState(null);
  const [picksLoading, setPicksLoading] = useState(false);
  const [picksErr, setPicksErr] = useState("");
  const [pickMarket, setPickMarket] = useState(null);
  const hint = useMemo(() => sessionHint(), []);
  const [wl, setWl] = useState(wlLoad);
  useEffect(() => { wlSave(wl); }, [wl]);
  const inWl = result && wl.some((w) => w.ticker === result.ticker);
  const toggleWl = () => {
    if (!result) return;
    setWl(inWl ? wl.filter((w) => w.ticker !== result.ticker) : [...wl, { name: result.name, ticker: result.ticker }]);
  };

  const [remote, setRemote] = useState([]);
  useEffect(() => {
    const q = query.trim();
    if (!sugOpen || !q || /\(/.test(q)) { setRemote([]); return; }
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        setRemote(j.items || []);
      } catch { setRemote([]); }
    }, 250);
    return () => clearTimeout(id);
  }, [query, sugOpen]);
  const [srvReady, setSrvReady] = useState({});
  useEffect(() => {
    (async () => {
      const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      for (const m of ["KR", "US"]) {
        try {
          const sj = await (await fetch(`/api/picks-data?what=latest&market=${m}`)).json();
          if (sj && sj.date === today && sj.data) {
            setPicksCache((pc) => ({ ...pc, [m]: { date: today, data: { ...sj.data, auto: true, at: sj.at } } }));
            setSrvReady((s) => ({ ...s, [m]: true }));
            if (m === (hint.m || "KR")) {
              const flag = "sd_ntf_" + today + m;
              if (!localStorage.getItem(flag)) {
                notify(`오늘의 ${m === "KR" ? "국내장" : "미국장"} 추천(스윙 3 + 단타 3)이 준비됐어요`);
                try { localStorage.setItem(flag, "1"); } catch {}
              }
            }
          }
        } catch {}
      }
    })();
  }, []);

  const suggestions = useMemo(() => {
    if (!sugOpen) return [];
    const local = searchStocks(query);
    const seen = new Set(local.map(([, t]) => t));
    return [...local, ...remote.filter((x) => !seen.has(x.ticker)).map((x) => [x.name, x.ticker])].slice(0, 8);
  }, [query, sugOpen, remote]);

  const [picksCache, setPicksCache] = useState({});
  const kstNow = () => new Date(Date.now() + 9 * 3600e3);
  const kstToday = () => kstNow().toISOString().slice(0, 10);
  const provisionInfo = (m) => {
    const n = new Date();
    const day = n.getDay();
    if (day === 0 || day === 6) return { open: false, msg: "⏰ 주말에는 추천픽을 제공하지 않습니다 — 다음 거래일 개장 1시간 전에 공개됩니다." };
    const t = n.getHours() + n.getMinutes() / 60;
    const at = m === "KR" ? 8 : (hint.usOpen === "22:30" ? 21.5 : 22.5);
    const label = m === "KR" ? "08:00" : (hint.usOpen === "22:30" ? "21:30" : "22:30");
    if (t < at) return { open: false, msg: `⏰ 아직 추천픽 제공 시간이 아닙니다 — ${m === "KR" ? "국내장" : "미국장"} 추천은 개장 1시간 전(${label})에 확정·공개되며, 그날 장 마감까지 고정됩니다.` };
    return { open: true };
  };
  const loadPicks = async (m) => {
    // 같은 버튼 재탭 → 접기
    if (pickMarket === m && (picks || picksLoading || picksErr)) { setPickMarket(null); setPicks(null); setPicksErr(""); setPicksLoading(false); return; }
    setPickMarket(m); setPicksErr(""); setPicks(null);
    const today = kstToday();
    const c = picksCache[m];
    if (c && c.date === today) { setPicks(c.data); return; }
    const pv = provisionInfo(m);
    if (!pv.open) { setPicksErr(pv.msg); return; }
    setPicksLoading(true);
    try {
      const latest = async () => (await fetch(`/api/picks-data?what=latest&market=${m}`)).json();
      let sj = await latest();
      if (!(sj && sj.date === today && sj.data)) {
        // 크론이 아직이면 서버 생성을 이 자리에서 트리거 → 서버에 단 한 번 확정 기록
        await fetch(`/api/cron?job=${m.toLowerCase()}`).catch(() => {});
        sj = await latest();
      }
      if (sj && sj.date === today && sj.data) {
        const d = { ...sj.data, auto: true, at: sj.at };
        setPicks(d);
        setPicksCache((pc) => ({ ...pc, [m]: { date: today, data: d } }));
      } else setPicksErr("⚠ 추천 생성이 지연되고 있습니다 — 잠시 후 다시 열어 주세요.");
    } catch (e) { setPicksErr("⚠ 추천을 불러오지 못했습니다. (" + e.message + ")"); }
    setPicksLoading(false);
  };

  const run = async (qArg) => {
    const q = typeof qArg === "string" ? qArg : query;
    setErr(""); setNews(null); setNewsErr(""); setSugOpen(false);
    let { name, ticker } = resolveTicker(q || "DEMO");
    if (/[가-힣]/.test(ticker)) {
      try {
        const r0 = await fetch(`/api/search?q=${encodeURIComponent(ticker)}`);
        const j0 = await r0.json();
        if (j0.items && j0.items[0]) { name = j0.items[0].name; ticker = j0.items[0].ticker; }
      } catch {}
    }
    setLoading(true);
    try {
      const live = await fetchChart(ticker);
      const data = live.data;
      if (!/\.(KS|KQ)$/i.test(ticker)) await loadFx();
      const r = analyze(data, parseFloat(avg) || 0, parseInt(qty) || 0, ticker);
      let regime = null;
      {
        try {
          const idx = /\.(KS|KQ)$/i.test(ticker) ? "^KS11" : "^GSPC";
          const cl = (await fetchChart(idx)).data.map((d) => d.close);
          const n2 = cl.length;
          const s20 = cl.slice(-20).reduce((a, b) => a + b, 0) / 20;
          const s60 = cl.slice(-60).reduce((a, b) => a + b, 0) / 60;
          const c = cl[n2 - 1];
          const rets = cl.slice(-21).map((v, i, a) => (i ? ((v - a[i - 1]) / a[i - 1]) * 100 : 0)).slice(1);
          const vol = Math.sqrt(rets.reduce((s, x) => s + x * x, 0) / rets.length);
          regime = vol > 2.2 ? { label: "고변동성 장세", adj: -5, advice: "포지션 축소 · 짧은 손절", tone: "warn" }
            : c > s20 && c > s60 ? { label: "상승 추세 장세", adj: 5, advice: "눌림목·돌파 매수 유효", tone: "buy" }
            : c < s20 && c < s60 ? { label: "하락 추세 장세", adj: -8, advice: "현금 확대 · 신규 매수 제한", tone: "sell" }
            : { label: "박스권/혼조 장세", adj: 0, advice: "지지·저항 단기 대응", tone: "warn" };
        } catch {}
      }
      const merged = { ...r, regime, ticker, name, isDemo: false, isLive: true, marketState: live?.marketState, currency: live?.currency };
      setResult(merged);
      recordVerdict(merged);
    } catch (e) { setErr(e.message); setResult(null); setLoading(false); return; }
    setLoading(false);
    setFilings(null);
    setEarnings(null);
    fetch(`/api/filings?ticker=${encodeURIComponent(ticker)}`).then((r) => r.json()).then((j) => { setFilings(j.items || []); setEarnings(j.earnings || null); }).catch(() => setFilings([]));
    {
      setNewsLoading(true);
      try {
        const h = histLoad();
        const general = await fullHistoryStrA(/\.(KS|KQ)$/i.test(ticker) ? "KR" : "US");
        const own = h.flatMap((e) => e.picks.filter((p) => p.ticker === ticker && p.r1 != null).map((p) => `${e.date} 추천 → 1일 ${p.r1}% / 5일 ${p.r5 ?? "?"}% / 20일 ${p.r20 ?? "?"}%`)).join("; ");
        const historyStr = [general, own ? `이 종목(${name})의 과거 추천 성적: ${own}` : ""].filter(Boolean).join(" ");
        setNews(await fetchNews(name, ticker, historyStr));
      }
      catch (e) { setNewsErr("뉴스 수집 실패 — 기술적 분석만 표시합니다. (" + e.message + ")"); }
      setNewsLoading(false);
    }
  };

  const inputS = {
    width: "100%", boxSizing: "border-box", background: T.card2, border: `1px solid ${T.line}`,
    borderRadius: 12, padding: "13px 14px", color: T.ink, fontSize: 16, fontFamily: T.mono, outline: "none",
  };
  const label = { fontSize: 12.5, color: T.info, fontFamily: T.mono, letterSpacing: "0.08em", marginBottom: 7, display: "block" };
  const chip = (on) => ({
    flex: 1, padding: "11px 8px", borderRadius: 12, textAlign: "center", fontSize: 14, fontWeight: 600, cursor: "pointer",
    background: on ? "rgba(111,195,255,0.14)" : T.card2, color: on ? T.info : T.sub,
    border: `1px solid ${on ? T.info : T.line}`,
  });

  const r = result;
  const vc = r ? toneColor(r.verdict.tone) : T.buy;
  const nAdj = newsAdjOf(news);
  const gsNow = useMemo(() => (r ? guideStats(vhLoad(), marketOf(r.ticker)) : null), [result]);
  const selfAdj = gsNow && gsNow.n >= 10 ? (gsNow.acc < 45 ? -5 : gsNow.acc >= 60 ? 3 : 0) : 0;
  const regAdj = r?.regime?.adj || 0;
  const finalScore = r ? Math.max(0, Math.min(100, r.composite + nAdj + regAdj + selfAdj)) : 0;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.sans, color: T.ink, paddingBottom: 60 }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 14px" }}>

        {/* 헤더 */}
        <header style={{ padding: "30px 2px 18px" }}>
          <h1 style={{ fontFamily: T.serif, fontSize: 34, margin: 0, letterSpacing: "-0.01em" }}>
            Yoon's <span style={{ color: T.info }}>가이드</span>
          </h1>
        </header>

        {/* AI 추천 성적표 */}
        <TrackRecord refreshKey={picks ? 1 : 0} />

        {/* 관심종목 실시간 */}
        <Watchlist wl={wl} setWl={setWl} onAnalyze={(w) => { const q = `${w.name} (${w.ticker})`; setQuery(q); run(q); }} />

        {/* 모닝 브리핑 · 추천 종목 */}
        <Card style={{ marginBottom: 16, borderColor: hint.m ? T.warn + "66" : T.line }}>
          <Eyebrow color={T.warn}>MORNING PICKS · 개장 전 추천 종목</Eyebrow>
          <div style={{ color: hint.m ? T.warn : T.sub, fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
            ⏰ {hint.msg}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => loadPicks("KR")} disabled={picksLoading} style={{
              flex: 1, padding: "13px 8px", borderRadius: 12, cursor: "pointer", fontSize: 14.5, fontWeight: 700,
              background: pickMarket === "KR" ? "rgba(245,185,74,0.15)" : T.card2,
              border: `1px solid ${hint.m === "KR" || pickMarket === "KR" ? T.warn : T.line}`,
              color: pickMarket === "KR" ? T.warn : T.ink, opacity: picksLoading ? 0.6 : 1,
            }}>🇰🇷 국내장 모닝픽{srvReady.KR && <span style={{ color: T.buy, marginLeft: 6 }}>●</span>}</button>
            <button onClick={() => loadPicks("US")} disabled={picksLoading} style={{
              flex: 1, padding: "13px 8px", borderRadius: 12, cursor: "pointer", fontSize: 14.5, fontWeight: 700,
              background: pickMarket === "US" ? "rgba(111,195,255,0.14)" : T.card2,
              border: `1px solid ${hint.m === "US" || pickMarket === "US" ? T.info : T.line}`,
              color: pickMarket === "US" ? T.info : T.ink, opacity: picksLoading ? 0.6 : 1,
            }}>🇺🇸 미국장 프리픽{srvReady.US && <span style={{ color: T.buy, marginLeft: 6 }}>●</span>} <span style={{ fontSize: 11, color: T.faint, fontWeight: 400 }}>{hint.usOpen} 개장</span></button>
          </div>

          {picksLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, color: T.sub, fontSize: 14, marginTop: 16 }}>
              <span style={{
                width: 16, height: 16, border: `2px solid ${T.line}`, borderTopColor: T.warn, borderRadius: "50%",
                display: "inline-block", animation: "spin 0.9s linear infinite",
              }} />
              오늘의 추천을 확정하고 있습니다 (뉴스·후보 수집 + AI 선별, 최대 40초)…
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
          {picksErr && <div style={{ color: T.warn, fontSize: 13.5, marginTop: 14, lineHeight: 1.6 }}>{picksErr}</div>}

          {picks && (
            <div style={{ marginTop: 16 }}>
              {picks.auto && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.buy, marginBottom: 8 }}>🔒 {picks.at || ""} 확정 — 오늘 장 마감까지 고정되며 성적표와 동일한 목록입니다</div>}
              {picks.brief && (
                <div style={{ background: T.card2, borderRadius: 12, padding: 13, fontSize: 13.5, lineHeight: 1.7, color: T.ink, marginBottom: 14 }}>
                  {picks.brief}
                </div>
              )}
              {picks.picks.map((p, i) => (
                <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 14, padding: 14, marginBottom: 12, background: T.card2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: T.mono, fontSize: 11, color: T.warn, letterSpacing: "0.2em" }}>PICK {i + 1}</div>
                      <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 800, marginTop: 4 }}>
                        {p.name} <span style={{ fontFamily: T.mono, fontSize: 13, color: T.sub, fontWeight: 400 }}>{p.ticker}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "center", border: `1px solid ${T.line}`, borderRadius: 12, padding: "7px 12px", minWidth: 58 }}>
                      <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 800, color: p.score >= 75 ? T.buy : p.score >= 55 ? T.warn : T.sub }}>{p.score}</div>
                      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>관심강도</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.65, marginTop: 10 }}>{p.reason}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10, fontSize: 12.5 }}>
                    {p.catalyst && <div><span style={{ color: T.buy, fontFamily: T.mono }}>재료</span> <span style={{ color: T.sub }}>{p.catalyst}</span></div>}
                    {p.risk && <div><span style={{ color: T.sell, fontFamily: T.mono }}>리스크</span> <span style={{ color: T.sub }}>{p.risk}</span></div>}
                  </div>
                  <button onClick={() => { const q = `${p.name} (${p.ticker})`; setQuery(q); run(q); }} style={{
                    marginTop: 12, width: "100%", padding: "11px 8px", borderRadius: 10, cursor: "pointer",
                    background: "transparent", border: `1px solid ${T.info}88`, color: T.info, fontSize: 13.5, fontWeight: 700,
                  }}>이 종목 정밀 분석 ▼</button>
                </div>
              ))}
              {picks.day_picks && picks.day_picks.length > 0 && (
                <>
                  <div style={{ fontFamily: T.mono, fontSize: 11, color: T.sell, letterSpacing: "0.25em", margin: "18px 0 10px" }}>⚡ 당일 단타 3선 · 장중 청산 전제</div>
                  {picks.day_picks.map((p, i) => (
                    <div key={"d" + i} style={{ border: `1px solid ${T.sell}44`, borderRadius: 14, padding: 13, marginBottom: 10, background: "rgba(255,107,107,0.04)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: T.serif, fontSize: 18, fontWeight: 800 }}>
                            {p.name} <span style={{ fontFamily: T.mono, fontSize: 12, color: T.sub, fontWeight: 400 }}>{p.ticker}</span>
                          </div>
                          <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.6, marginTop: 6 }}>{p.reason}</div>
                          {p.risk && <div style={{ fontSize: 12, color: T.sub, marginTop: 4 }}><span style={{ color: T.sell, fontFamily: T.mono }}>주의</span> {p.risk}</div>}
                        </div>
                        <div style={{ textAlign: "center", flexShrink: 0 }}>
                          <div style={{ border: `1px solid ${T.buy}66`, borderRadius: 12, padding: "7px 11px" }}>
                            <div style={{ fontFamily: T.serif, fontSize: 19, fontWeight: 800, color: T.buy }}>+{p.target_pct}%</div>
                            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>당일 목표</div>
                          </div>
                          <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.sub, marginTop: 5 }}>강도 {p.score}</div>
                        </div>
                      </div>
                      <button onClick={() => { const q = `${p.name} (${p.ticker})`; setQuery(q); run(q); }} style={{
                        marginTop: 10, width: "100%", padding: "9px 8px", borderRadius: 10, cursor: "pointer",
                        background: "transparent", border: `1px solid ${T.info}66`, color: T.info, fontSize: 13, fontWeight: 700,
                      }}>이 종목 정밀 분석 ▼</button>
                    </div>
                  ))}
                </>
              )}
              <div style={{ fontSize: 11.5, color: T.faint, lineHeight: 1.6 }}>
                매일 8시(국내)·개장 1시간 전(미국)에 열어 확인하세요. 스윙 픽(1·5·20일)과 단타 픽(당일 목표 적중 여부)은 자동 채점되어 다음 추천에 반영됩니다. 버튼을 다시 누르면 접힙니다.
              </div>
            </div>
          )}
        </Card>

        {/* 입력 */}
        <Card>
          <label style={label}>종목명(한글) 또는 티커</label>
          <div style={{ position: "relative" }}>
            <input style={inputS} value={query}
              onChange={(e) => { setQuery(e.target.value); setSugOpen(true); }}
              onFocus={() => setSugOpen(true)}
              placeholder="예: 삼성, 보성파워텍, 000660.KS, AAPL — 국내 전 종목 검색" />
            {suggestions.length > 0 && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 20,
                background: "#161D2B", border: `1px solid ${T.info}66`, borderRadius: 12, overflow: "hidden",
                boxShadow: "0 12px 30px rgba(0,0,0,0.55)",
              }}>
                {suggestions.map(([n, t]) => (
                  <div key={t}
                    onClick={() => { setQuery(`${n.split(" ")[0]} (${t})`); setSugOpen(false); }}
                    style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", cursor: "pointer", borderBottom: `1px solid ${T.line}`, fontSize: 14.5 }}>
                    <span style={{ color: T.ink, fontWeight: 600 }}>{n.split(" ")[0]}</span>
                    <span style={{ color: T.sub, fontFamily: T.mono, fontSize: 12.5 }}>{t}</span>
                  </div>
                ))}
              </div>
            )}
          </div>



          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>평단가 (보유 시)</label>
              <input style={inputS} value={avg} onChange={(e) => setAvg(e.target.value.replace(/[^\d.]/g, ""))} inputMode="numeric" placeholder="미보유면 비움" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>보유수량 (선택)</label>
              <input style={inputS} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="0" />
            </div>
          </div>
          <button onClick={run} disabled={loading} style={{
            width: "100%", marginTop: 12, padding: "15px 10px", borderRadius: 12, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg,#5b6cff,#7c5bff)", color: "#fff", fontSize: 16.5, fontWeight: 700, letterSpacing: "0.04em",
            opacity: loading ? 0.6 : 1,
          }}>{loading ? "시세 불러오는 중…" : "분석 ▶"}</button>
          {err && <div style={{ marginTop: 12, color: T.sell, fontSize: 13.5 }}>⚠ {err}</div>}
          <div style={{ marginTop: 12, color: T.faint, fontSize: 12, lineHeight: 1.5 }}>
            실시간 분석 · 야후 파이낸스 일봉 기준 (국내주식 시세는 최대 15~20분 지연될 수 있음)
          </div>
        </Card>

        {r && (
          <>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <div style={chip(view === "summary")} onClick={() => setView("summary")}>⚡ 한눈 요약</div>
              <div style={chip(view === "detail")} onClick={() => setView("detail")}>🔬 상세 분석</div>
            </div>

            {view === "summary" && (
              <SummaryView r={r} news={news} newsLoading={newsLoading} finalScore={finalScore} nAdj={nAdj} regAdj={regAdj} selfAdj={selfAdj} filings={filings} earnings={earnings} inWl={inWl} toggleWl={toggleWl} />
            )}

            {view === "detail" && (<>
            <DecisionCard r={r} finalScore={finalScore} showLive={false} showHeader={false} earnings={earnings} />
            {/* 종합 판단 */}
            <Card style={{ marginTop: 16, background: "linear-gradient(180deg,#0E1219,#0A0E16)", borderColor: vc + "55" }}>
              <Eyebrow color={vc}>OVERALL VERDICT{r.isLive ? " · LIVE" : r.isDemo ? " · 시세는 DEMO" : ""}</Eyebrow>
              <div style={{ fontFamily: T.serif, fontSize: 30, fontWeight: 800, letterSpacing: "0.01em" }}>
                {r.name} <span style={{ fontSize: 17, color: T.sub, fontFamily: T.mono, fontWeight: 400 }}>{r.ticker}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, gap: 10 }}>
                <span style={{ fontFamily: T.mono, color: T.sub, fontSize: 12.5 }}>
                  기준일 {r.date} · 현재가 <span style={{ color: T.ink }}>{M(r.price, r.ticker)}</span> · ATR14 {M(r.a, r.ticker)}
                </span>
                <span onClick={toggleWl} style={{
                  cursor: "pointer", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
                  color: inWl ? T.warn : T.sub, border: `1px solid ${inWl ? T.warn : T.line}`, borderRadius: 20, padding: "5px 11px",
                }}>{inWl ? "★ 관심중" : "☆ 관심등록"}</span>
              </div>
              {r.isLive && <LiveWatch ticker={r.ticker} />}
              <div style={{ marginTop: 12 }}><Gauge value={finalScore} tone={r.verdict.tone} /></div>
              <div style={{ textAlign: "center", marginTop: -6 }}>
                <span style={{ fontFamily: T.serif, fontSize: 52, fontWeight: 800, color: vc }}>{finalScore}</span>
                <span style={{ fontFamily: T.serif, fontSize: 22, color: T.faint }}>/100</span>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.faint, letterSpacing: "0.25em", marginTop: 2 }}>종합 매수 매력도</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, letterSpacing: "0.15em" }}>{r.verdict.label}</div>
                <div style={{ color: T.sub, fontSize: 13.5, marginTop: 8, lineHeight: 1.6 }}>{r.verdict.action}</div>
                <div style={{ fontFamily: T.mono, fontSize: 12, color: T.faint, marginTop: 10 }}>
                  기술 {r.composite}
                  {news && <span> {nAdj >= 0 ? "+" : "−"} 뉴스 {Math.abs(nAdj)}</span>}
                  {regAdj !== 0 && <span> {regAdj > 0 ? "+" : "−"} 시장 {Math.abs(regAdj)}</span>}
                  {selfAdj !== 0 && <span> {selfAdj > 0 ? "+" : "−"} 자가보정 {Math.abs(selfAdj)}</span>}
                  <span> = <b style={{ color: T.ink }}>{finalScore}</b></span>
                  {newsLoading && <span style={{ color: T.info }}> · 뉴스 수집 중…</span>}
                </div>
                {r.regime && <div style={{ fontFamily: T.mono, fontSize: 12, color: toneColor(r.regime.tone), marginTop: 6 }}>시장 국면: {r.regime.label} · {r.regime.advice}</div>}
              </div>
              <div style={{ marginTop: 16 }}><MiniChart data={r.chart} /></div>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", fontFamily: T.mono, fontSize: 11, color: T.faint }}>
                <span style={{ color: T.info }}>— 종가</span><span style={{ color: T.buy }}>— 20일선</span><span style={{ color: T.warn }}>— 60일선</span>
              </div>
            </Card>

            {/* 뉴스·시장 분석 */}
            {(news || newsLoading || newsErr) && (
              <Card style={{ marginTop: 14, borderColor: news ? (news.sentiment >= 15 ? T.buy : news.sentiment <= -15 ? T.sell : T.warn) + "66" : T.line }}>
                <Eyebrow color={T.info}>NEWS & MARKET · 뉴스·시장 분석</Eyebrow>
                {newsLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, color: T.sub, fontSize: 14, padding: "8px 0" }}>
                    <span style={{
                      width: 16, height: 16, border: `2px solid ${T.line}`, borderTopColor: T.info, borderRadius: "50%",
                      display: "inline-block", animation: "spin 0.9s linear infinite",
                    }} />
                    최근 뉴스·업황·시장 분위기를 웹에서 수집하고 있습니다…
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </div>
                )}
                {newsErr && <div style={{ color: T.warn, fontSize: 13.5, lineHeight: 1.6 }}>⚠ {newsErr}</div>}
                {news && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ color: T.sub, fontSize: 14 }}>뉴스 감성</span>
                      <span>
                        <span style={{ fontFamily: T.serif, fontSize: 32, fontWeight: 800, color: news.sentiment >= 15 ? T.buy : news.sentiment <= -15 ? T.sell : T.warn }}>
                          {news.sentiment > 0 ? "+" : ""}{news.sentiment}
                        </span>
                        <span style={{ marginLeft: 8, fontSize: 13, color: T.sub }}>
                          {news.sentiment >= 40 ? "호재 뚜렷" : news.sentiment >= 15 ? "호재 우세" : news.sentiment <= -40 ? "악재 뚜렷" : news.sentiment <= -15 ? "악재 우세" : "중립"}
                        </span>
                      </span>
                    </div>
                    <div style={{ height: 6, background: T.line, borderRadius: 4, marginTop: 8, position: "relative", overflow: "hidden" }}>
                      <div style={{
                        position: "absolute", top: 0, bottom: 0, left: "50%", width: `${Math.abs(news.sentiment) / 2}%`,
                        transform: news.sentiment < 0 ? "translateX(-100%)" : "none",
                        background: news.sentiment >= 0 ? T.buy : T.sell, borderRadius: 4,
                      }} />
                    </div>
                    {news.mood && <div style={{ color: T.ink, fontSize: 13.5, marginTop: 12, lineHeight: 1.6 }}>{news.mood}</div>}
                    <div style={{ marginTop: 10 }}>
                      {(news.headlines || []).map((h, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: `1px dashed ${T.line}`, fontSize: 13 }}>
                          <span style={{
                            fontFamily: T.mono, fontWeight: 800, minWidth: 18, textAlign: "center",
                            color: h.s === "+" ? T.buy : h.s === "-" ? T.sell : T.faint,
                          }}>{h.s === "+" ? "▲" : h.s === "-" ? "▼" : "—"}</span>
                          <span style={{ color: T.sub, lineHeight: 1.55 }}>{h.t}</span>
                        </div>
                      ))}
                    </div>
                    {news.summary && (
                      <div style={{ marginTop: 12, background: T.card2, borderRadius: 10, padding: 12, fontSize: 13.5, lineHeight: 1.7, color: T.ink }}>{news.summary}</div>
                    )}
                    <div style={{ fontFamily: T.mono, fontSize: 12, color: T.faint, marginTop: 10 }}>
                      종합 점수 반영: <b style={{ color: nAdj >= 0 ? T.buy : T.sell }}>{nAdj >= 0 ? "+" : ""}{nAdj}점</b> (감성 ÷ 8, 최대 ±12)
                      {r.isDemo && <span> · 데모 모드: 뉴스는 실제, 시세는 가상이므로 참고만 하세요</span>}
                    </div>
                  </>
                )}
              </Card>
            )}

            {/* 탭 */}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              {[["all", "전체"], ["buy", "매수(눌림목)"], ["sell", "매도(과열/목표)"]].map(([k, n]) => (
                <div key={k} style={chip(tab === k)} onClick={() => setTab(k)}>{n}</div>
              ))}
            </div>

            {/* 추세 국면 */}
            {(tab === "all") && (
              <Card style={{ marginTop: 14 }}>
                <Eyebrow color={T.info}>TREND PHASE · 추세 국면</Eyebrow>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <span style={{ fontFamily: T.serif, fontSize: 30, fontWeight: 800, color: r.trendLabel === "상승" ? T.buy : r.trendLabel === "하락" ? T.sell : T.warn }}>{r.trendLabel}</span>
                  <span style={{ fontFamily: T.mono, color: T.sub, fontSize: 13 }}>
                    {r.aligned ? "정배열" : "이평 미정렬"} · ADX {r.adxV.toFixed(0)}·{r.adxStrong ? "강" : "약"} · 200일선 {r.above200 ? "위" : "아래"} · {r.bullDI ? "+DI 우위" : "−DI 우위"}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginTop: 16, fontFamily: T.mono, fontSize: 13 }}>
                  {[
                    ["RSI(14)", (r.rsi ?? 0).toFixed(1), r.rsi < 35 ? T.buy : r.rsi > 70 ? T.sell : T.ink],
                    ["MACD 히스토", r.macdHist?.toFixed(0) ?? "—", (r.macdHist ?? 0) > 0 ? T.buy : T.sell],
                    ["스토캐스틱 %K", (r.stochK ?? 0).toFixed(0), r.stochK < 25 ? T.buy : r.stochK > 80 ? T.sell : T.ink],
                    ["볼린저 %B", (r.pb ?? 0).toFixed(2), r.pb < 0.2 ? T.buy : r.pb > 0.9 ? T.sell : T.ink],
                    ["20일선 이격", `${r.devATR.toFixed(1)} ATR`, Math.abs(r.devATR) > 2 ? T.warn : T.ink],
                    ["10일 모멘텀", pct(r.mom10), r.mom10 >= 0 ? T.buy : T.sell],
                    ["OBV 수급(20일)", r.obvUp ? "매집 우위" : "분산 우위", r.obvUp ? T.buy : T.sell],
                    ["52주 신고가", `${M(r.hi52, r.ticker)}`, T.ink],
                  ].map(([n, v, c]) => (
                    <div key={n} style={{ display: "flex", justifyContent: "space-between", borderBottom: `1px dashed ${T.line}`, paddingBottom: 8 }}>
                      <span style={{ color: T.sub }}>{n}</span><span style={{ color: c, fontWeight: 700 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 매수 분석 */}
            {(tab === "all" || tab === "buy") && (
              <Card style={{ marginTop: 14 }}>
                <Eyebrow color={T.buy}>PULLBACK BUY ANALYSIS · 눌림목 매수</Eyebrow>
                <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
                  <span style={{ fontFamily: T.serif, fontSize: 46, fontWeight: 800, color: r.buyScore >= 80 ? T.buy : r.buyScore >= 60 ? T.warn : T.faint }}>{r.buyScore}</span>
                  <span style={{ fontFamily: T.serif, fontSize: 20, color: T.faint }}>/100</span>
                  <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "0.2em", marginTop: 2 }}>
                    {r.buyScore >= 80 ? "강력 매수 관심" : r.buyScore >= 60 ? "매수 관심" : r.buyScore >= 40 ? "조건 미충족 — 대기" : "매수 근거 약함"}
                  </div>
                </div>
                <div style={{ marginTop: 6 }}>
                  {r.buyRows.map((row, i) => <ScoreRow key={i} r={row} color={T.buy} />)}
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint, letterSpacing: "0.2em", marginBottom: 8 }}>보조 시그널 (+{r.sigBonus * 2}점 가산)</div>
                  {r.signals.map((s) => (
                    <div key={s.name} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px dashed ${T.line}`, fontSize: 13.5 }}>
                      <span style={{ color: s.ok ? T.buy : T.faint, fontFamily: T.mono, minWidth: 16 }}>{s.ok ? "●" : "○"}</span>
                      <span style={{ color: T.ink, minWidth: 96, fontWeight: 600 }}>{s.name}</span>
                      <span style={{ color: T.sub, fontFamily: T.mono, fontSize: 12.5 }}>{s.note}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, background: T.card2, borderRadius: 12, padding: 14, fontSize: 13.5, lineHeight: 1.7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.sub }}>침체도</span><span style={{ fontFamily: T.mono, fontWeight: 700 }}>{r.depression}/100 <span style={{ color: T.faint, fontWeight: 400 }}>높을수록 눌림</span></span></div>
                  {r.nearSup && <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.sub }}>핵심 지지</span><span style={{ fontFamily: T.mono, fontWeight: 700, color: T.buy }}>{M(r.nearSup.p, r.ticker)}</span></div>}
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.sub }}>권장 손절선</span><span style={{ fontFamily: T.mono, fontWeight: 700, color: T.sell }}>{M(r.stop, r.ticker)} ({pct(((r.stop - r.price) / r.price) * 100)})</span></div>
                </div>
              </Card>
            )}

            {(tab === "all" || tab === "buy") && <BuyPlan r={r} />}
            {(tab === "all" || tab === "buy") && <PositionCalc price={r.price} stop={r.stop} ticker={r.ticker} />}
            {tab === "all" && riskList(r, filings, earnings).length > 0 && (
              <Card style={{ marginTop: 14, borderColor: T.sell + "44" }}>
                <Eyebrow color={T.sell}>RISK CARD · 위험요인</Eyebrow>
                {riskList(r, filings, earnings).map((x, i) => (
                  <div key={i} style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.8, borderBottom: `1px dashed ${T.line}`, padding: "7px 0" }}>· {x}</div>
                ))}
              </Card>
            )}

            {/* 매도 분석 */}
            {(tab === "all" || tab === "sell") && (
              <Card style={{ marginTop: 14 }}>
                <Eyebrow color={T.sell}>SELL ZONE ANALYSIS · 과열도 & 목표 구간</Eyebrow>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ color: T.sub, fontSize: 14 }}>과열도</span>
                  <span>
                    <span style={{ fontFamily: T.serif, fontSize: 34, fontWeight: 800, color: r.heat >= 80 ? T.sell : r.heat >= 55 ? T.warn : T.buy }}>{r.heat}</span>
                    <span style={{ color: T.faint, fontFamily: T.serif }}>/100</span>
                    <span style={{ marginLeft: 8, fontSize: 13, color: T.sub }}>{r.heat >= 80 ? "과열" : r.heat >= 55 ? "주의" : "보통"}</span>
                  </span>
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 12.5, color: T.sub, lineHeight: 1.9, marginTop: 6 }}>
                  {r.heatParts.map((h) => (
                    <span key={h.name}>{h.name} {h.disp} <span style={{ color: T.warn }}>({h.p.toFixed(0)}%)</span> · </span>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: T.faint, marginTop: 8 }}>과열도는 '이 종목 1년 대비 백분위'로 정규화 · 강도 점수와 무관</div>

                {/* 매도 목표 구간 */}
                <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.faint, letterSpacing: "0.2em", margin: "20px 0 10px" }}>매도 목표 구간</div>
                {r.zones.length === 0 && <div style={{ color: T.sub, fontSize: 13.5 }}>현재가 위쪽 유의미한 저항 클러스터가 없습니다 (신고가 영역).</div>}
                {r.zones.map((z) => (
                  <div key={z.order} style={{
                    border: `1px solid ${z.order === 1 ? T.buy + "88" : T.line}`, borderRadius: 14, padding: 14, marginBottom: 12,
                    background: z.order === 1 ? "rgba(61,220,151,0.05)" : T.card2,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div>
                        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.info, letterSpacing: "0.2em" }}>{z.order}차 목표 {z.order === 1 && <span style={{ background: "rgba(61,220,151,0.18)", color: T.buy, padding: "2px 8px", borderRadius: 20, marginLeft: 6 }}>★ 핵심</span>}</div>
                        <div style={{ fontFamily: T.serif, fontSize: 21, fontWeight: 800, marginTop: 6, lineHeight: 1.35 }}>
                          {M(z.lo, r.ticker)} <span style={{ color: T.faint }}>~</span> {M(z.hi, r.ticker)}
                        </div>
                        <div style={{ color: T.sub, fontSize: 12.5, marginTop: 4 }}>{z.why}</div>
                      </div>
                      <div style={{
                        border: `1px solid ${z.strength >= 45 ? "#c8551b" : T.line}`, borderRadius: 12, padding: "8px 12px", textAlign: "center",
                        color: z.strength >= 45 ? "#FF9950" : T.sub, minWidth: 64,
                      }}>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{z.strength >= 45 ? "강" : "중"}</div>
                        <div style={{ fontFamily: T.mono, fontSize: 11 }}>{z.strength}/100</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 14, marginTop: 10, fontFamily: T.mono, fontSize: 12.5, color: T.sub, flexWrap: "wrap" }}>
                      <span>거리 <b style={{ color: T.ink }}>{pct(z.distPct)}</b> ({z.distATR.toFixed(1)} ATR)</span>
                      {z.rr != null && <span>손익비 <b style={{ color: z.rr >= 2 ? T.buy : z.rr >= 1 ? T.warn : T.sell }}>{z.rr.toFixed(1)} : 1</b></span>}
                      {Math.abs(z.distATR) < 0.5 && <span style={{ color: T.warn }}>가까움</span>}
                    </div>
                  </div>
                ))}

                {/* 손절선 & 매도 모드 */}
                <div style={{ borderLeft: `3px solid ${T.buy}`, background: T.card2, borderRadius: "0 12px 12px 0", padding: 14, marginTop: 6 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{r.trendLabel === "상승" ? "추세 타기" : "방어 우선"}</div>
                  <div style={{ color: T.sub, fontSize: 13, marginTop: 5, lineHeight: 1.65 }}>
                    {r.trendLabel === "상승"
                      ? "저항 돌파 가능 · 전량 익절 보류 · 손절선 올리며 추세 태우기"
                      : "반등 시 분할 축소 · 손절선 엄수 · 신규 진입은 추세 전환 확인 후"}
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 13, marginTop: 10 }}>
                    손절선(여유형) <b style={{ color: T.sell }}>{M(r.stop, r.ticker)}</b> <span style={{ color: T.faint }}>= 지지 − 1.0 ATR</span>
                  </div>
                </div>
              </Card>
            )}

            {/* 지지 레벨 */}
            {(tab === "all" || tab === "buy") && (
              <Card style={{ marginTop: 14 }}>
                <Eyebrow color={T.warn}>SUPPORT LADDER · 지지 레벨 (재진입 참고)</Eyebrow>
                {r.supports.map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px dashed ${T.line}`, fontSize: 13.5 }}>
                    <span style={{ color: T.sub }}>{s.name}</span>
                    <span style={{ fontFamily: T.mono, fontWeight: 700 }}>{M(s.p, r.ticker)} <span style={{ color: T.faint, fontWeight: 400 }}>({pct(((s.p - r.price) / r.price) * 100)})</span></span>
                  </div>
                ))}
                {r.supports.length === 0 && <div style={{ color: T.sub, fontSize: 13.5 }}>가격대 인근 지지 레벨이 없습니다.</div>}
              </Card>
            )}

            {/* 최근 공시 */}
            {filings && filings.length > 0 && (
              <Card style={{ marginTop: 14 }}>
                <Eyebrow color={T.info}>FILINGS · 최근 공시 {/\.(KS|KQ)$/i.test(r.ticker) ? "(네이버 공시)" : "(SEC EDGAR)"}</Eyebrow>
                {filings.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: `1px dashed ${T.line}`, fontSize: 13 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: T.faint, minWidth: 74, paddingTop: 2 }}>{f.date}</span>
                    <span style={{ color: T.ink, lineHeight: 1.5 }}>{f.title}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: T.faint, marginTop: 8 }}>뉴스·시장 분석이 켜져 있으면 AI가 공시 영향(유증·CB·수주 등)을 감성점수에 반영합니다.</div>
              </Card>
            )}

            {/* 매도 플랜 (평단가 입력 시) */}
            {r.position && <SellPlan r={r} />}

            {/* 포지션 (평단가 입력 시) */}
            {r.position && (
              <Card style={{ marginTop: 14, borderColor: T.info + "55" }}>
                <Eyebrow color={T.info}>MY POSITION · 평단 기준 관리</Eyebrow>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", fontFamily: T.mono, fontSize: 13.5 }}>
                  <div><div style={{ color: T.sub, fontSize: 12 }}>평단가</div><div style={{ fontSize: 17, fontWeight: 700 }}>{M(r.position.avg, r.ticker)}</div></div>
                  <div><div style={{ color: T.sub, fontSize: 12 }}>평가 손익</div><div style={{ fontSize: 17, fontWeight: 700, color: r.position.pl >= 0 ? T.buy : T.sell }}>{pct(r.position.pl)}</div></div>
                  <div><div style={{ color: T.sub, fontSize: 12 }}>원칙 손절(-7%)</div><div style={{ fontSize: 15, fontWeight: 700, color: T.sell }}>{M(r.position.stopFromAvg, r.ticker)}</div></div>
                  <div><div style={{ color: T.sub, fontSize: 12 }}>기술적 손절</div><div style={{ fontSize: 15, fontWeight: 700, color: T.sell }}>{M(r.stop, r.ticker)}</div></div>
                </div>
                <div style={{ marginTop: 12, fontSize: 13.5, color: T.ink, background: T.card2, borderRadius: 10, padding: 12, lineHeight: 1.65 }}>{r.position.note}</div>
              </Card>
            )}

            </>)}

          </>
        )}
      </div>
    </div>
  );
}
