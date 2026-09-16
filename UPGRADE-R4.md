# R4: repeated intraday decisions and Korean sessions

- Existing R3 already evaluates waiting orders and holdings on authenticated monitor calls, not just the open. Completed 5-minute bars, 4-minute run throttle; not tick-level real-time trading.
- Opening setup changes to fresh breakout/pullback checks after 60 observed minutes. This does not generate new news-based stock recommendations or re-enable policy-watch orders.
- KR scheduled windows: NXT pre 08:00–08:50, KRX regular 09:00–15:30, NXT after 15:40–20:00. Breaks excluded. NXT main overlaps KRX; this is NOT SOR routing. Source: https://nextrade.co.kr/ . Holiday/halt/eligible-stock feeds remain necessary.
- Current Yahoo KR OHLCV is only accepted during KRX regular hours. NXT windows return an explicit blocked status; no stale KRX quote is filled as NXT. No dedicated NXT data provider is connected in this update, so actual extended-hours simulation is NOT enabled.
- KRX day positions close on the completed 15:25 bar. Delayed closing bars are recoverable on the next run under the existing 20-minute freshness limit; outages may force next-session exit.
- External scheduler must call the fixed Production /api/monitor endpoint with existing authentication throughout the day. Recommend every 5 minutes, weekdays KST 08:00–20:05 (last calls recover final regular bars), preserving US overnight schedule. Dashboard refresh is read-only, not a scheduler. No new Vercel cron or external scheduler settings are provisioned here.
- NXT activation requires timestamped completed OHLCV, current eligible stock list, venue-specific pauses and a limit-order liquidity model. Do not enable by simply widening Yahoo timestamps or adding includePrePost.
- GitHub code update still requires latest-main Production deployment. Paper only; no broker orders.
