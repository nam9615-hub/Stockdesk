# StockDesk R2

## Implemented

- S2.0 advisory strategy classifier using completed historical prices, persistent catalyst codes, and 20/60-session trend. AI interest score is not a probability and does not control sizing.
- Swing review checkpoint at 3 sessions; maximum holding windows of 5/10/15 trading sessions. The grade engine enforces the maximum for NEW plans only. No automatic extension, trailing stop, or broker orders.
- Short-lived momentum without durable evidence or trend is watch/day-review, NOT an executed day trade. Existing day selection still uses the opening-session re-evaluation flow.
- Missing price/volatility, declining regime, or measured gap >=5% leads to observation. Swing opening gap still requires a future entry-condition engine; the pre-open policy does not claim to have measured an unknown gap.
- Cash-constrained historical replay replaces the headline weight-compounding simulation: integer shares, cash, duplicate ticker restriction, 0.5% per-entry stop risk, 2% aggregate initial stop risk, eight-position maximum. Old simulation remains collapsed for reference.
- This replay is NOT a persistent paper account or trustworthy new-policy backtest: it uses stored outcomes, approximate entry dates, assumes entry before exit on same-day events, and marks unavailable prices at cost. KR and US use separate native-currency capitals of KRW 5,000,000 and USD 5,000. No FX conversion or merged portfolio is claimed.
- Prevent whole-file stale overwrite after GitHub 409 conflict; next scheduler run must read and recalculate. Some partial multi-file writes remain possible; transactional storage is future work.
- Do not finalize same-day daily candles. Existing closed outcomes are preserved; ambiguous intraday order still requires better bar evidence.
- Preserve watchlist, detailed analysis, history, news, candidate data. Collapse briefing and pick evidence. Add a visible strategy/holding/risk summary and clear paper-only label.
- Preserve free hosting mode: automatic Git deployments remain off. One manual latest-main Production deployment is required after the rate limit recovers.

## Still required before autonomous investment

1. Persistent paper account with timestamped orders, fills, cash, holdings, and reconciliation. This release only provides historical cash-constrained replay.
2. Intraday entry gates: gap/pullback confirmation and post-entry bars only, plus market calendars and finished-session timestamps.
3. Frozen out-of-sample comparisons: open entry vs gap rejection vs pullback entry; same candidate universe, costs, version, and sufficient sample sizes.
4. Compare selected vs unselected candidates and benchmark baskets using complete 1/5/20-day grading. R1 grading queue fixes are retained.
5. Enforce live portfolio risk, broker errors, order idempotency, price staleness, permissions, kill switch, and reconciliation before any real account connection.

No improvement in expected return is asserted. A cleaner UI and risk policy cannot establish profitability. The 5/10/15-session windows are testable policy hypotheses.
