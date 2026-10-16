# WP3 Period model (#91, P3 and C4)

Taken by `frontend/e2e/tests/dashboard-period.spec.ts` with `E2E_SCREENSHOTS` set (1366x768, 1920x1080 and 375x812; Chromium, firm zone America/New_York).

| File | Shows |
|---|---|
| `period-summary-1366/1920/375.png` | Summary: the "Period" control in the Overview row, the scope note under it, tile captions with the resolved range ("Sep 17 to Oct 16") |
| `period-summary-custom-1366/1920/375.png` | Custom range with a start after the end: inline error, "Still showing ..." the previous valid range, date fields keyboard operable, no sideways scroll at 375 |
| `period-custom-error-1366.png` | The same error on the 1366 window |
| `period-trends-1366/1920/375.png` | Trends with `?period=this-month`: same control and list, no 6 and 12 month item |
| `period-coverage-1366/1920/375.png` | Coverage with `?period=12m`: the same list plus Last 6 months and Last 12 months |
