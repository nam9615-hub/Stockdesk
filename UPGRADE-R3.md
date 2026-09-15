# R3: conditional orders and forward paper account

## Activate after one latest-main Production deployment

1. Preserve GH_REPO / GH_TOKEN and CRON_KEY in Production. The token needs Contents read/write. Never send or commit secrets.
2. Add PAPER_TRADING_ENABLED=1 only when ready to run shared hypothetical paper accounts. Default is OFF. Keep PAPER capital defaults independent: KRW 5,000,000 and USD 5,000.
3. Existing authenticated /api/monitor scheduler runs the new paper account approximately every four minutes. No new minute-level Vercel Cron is created. Configure the scheduler's x-cron-key or Authorization Bearer to match CRON_KEY. Viewer requests never mutate the account.
4. Check GET /api/paper?market=KR and market=US: enabled, initialized, lastRun, feedErrors, orders, fills. Displayed READY deployment alone does not verify a functioning scheduler.
5. Set PAPER_TRADING_ENABLED=0 to stop paper engine processing (including exits); existing legacy recommendation grading remains independent. Never use this as a real broker kill switch. Account paused=true blocks only new simulated entries while monitoring simulated protective exits.

## Data and execution design

- New state files data/paper-KR.json / paper-US.json are written by the scheduler after activation, not seeded with historical fills. They are shared demonstration accounts in a PUBLIC repository: never place real account identifiers, funds, broker credentials or private portfolio information here.
- Price-time evidence: completed, validated 5-minute OHLCV only; reject feeds over 20 minutes stale. Signal uses observations after order creation and execution uses the next bar open with 0.1% slippage. KR per-side cost 0.125%, US 0.05%. These are hypotheses, not broker fee quotations.
- Setups: intraday VWAP pullback recovery, preceding 12-bar price range breakout with volume, opening two-bar range / VWAP / volume confirmation. These are NOT a full multi-day consolidation scanner or market-relative strength model.
- Cash, shares, fees, fill IDs, mark timestamps, order states, decision events and opportunity observations persist. Duplicate recommendation IDs do not queue again. Prior candles are not reused as pre-activation fills. All tickers share a chronological clock; ties use deterministic ticker order, not predicted profitability.
- Limits: 0.5% initial stop risk per entry, 2% aggregate initial stop risk, 8 positions, 25% reported-sector cap, per-position 8% day / 10% swing. Unknown or inconsistent sector labels still require improved classification. No borrowing or negative cash. A 10% loss from starting capital blocks new entries, not exits.
- Partial profit: half at initial target when shares permit, remaining stop trails upward only using subsequent completed closes. Stop-first when candle ordering is unknown; a stop gap uses worse open, not ideal stop price. Entry candle stops are checked; entry-candle targets are intentionally not inferred.
- Day trades close on observed regular session end. If that observation was missed, next session open is recorded as overdue exit, not falsely backfilled. Holidays, outages and early-close handling still require full operational validation.
- Swing: 3-observed-session checkpoint exits non-progressing losing positions; initial R2 horizon of 5/10/15 sessions retained. One extension of <=5 sessions (absolute max20) only for durable catalyst code, 3-session improving closes and >2% profit. This does not verify that old news remains factually valid.
- No silent swing/day conversion. Watched recommendations remain watched; expiry does not auto-reopen. Filled ticker has 24h cooldown. Fully automated event-based reconsideration requires a new fresh recommendation/version and is not complete in this release.
- Independent forward shadow accounts compare next-observed-bar entry, gap filtering and VWAP recovery on identical candidate selections and price feeds. They are not opening-auction backtests, do not establish causality or statistical superiority, and should not optimize production rules yet.
- Opportunity observations measure non-bought price movement, not achievable missed profit. They currently record the first eligible snapshot per session, not guaranteed session-close returns.
- Maximum drawdown is based on observed evaluation snapshots, not continuously sampled intraday equity. Strategy P&L counts exit fills, not independent whole trades. Benchmark index returns, complete round-trip expectancy and formal out-of-sample validation remain future work.

## Storage safety and limitations

GitHub SHA is optimistic concurrency control. A 409 does NOT retry with stale whole-file data: the next scheduler re-reads and recalculates. There is no cross-file transaction and no real order placement, so aborted simulated fills are not externally executed. Storage read failures/corruption never reset an account. Stop before 850 KB; add archival before long-term deployment. An archive UI and automatic log rotation are not implemented.

Missing bars mean incomplete observation, not guaranteed absent trades. A 5-day feed cannot reconstruct longer outages. Scheduler first fetches at most 12 unique tickers; positions take priority, so large candidate sets may wait. Provider reliability and runtime budget require production testing.

Free hosting: Git automatic deployments remain OFF. Paper updates do not require app rebuilds, but still consume GitHub API / Vercel function resources. No new AI calls are added. Read-only dashboard refreshes every minute. This cannot guarantee zero hosting costs or profitable investment.

## UI

Command center shows evaluation/cash, holding defense and waiting opportunities. Detailed events, strategy results and comparisons are collapsed. Legacy watchlist, analysis, news, history and R2 grading remain. No real money trading button.

## Verification

Unit tests and production build verify local code only. Provider API, authenticated scheduler, persistence conflicts, real mobile rendering and end-to-end Production flows must be verified after deployment. Do not describe this release as a completed or profitable autonomous investment system.
