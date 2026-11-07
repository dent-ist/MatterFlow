# Reports screen checks (mocked API)

Browser checks of the Reports screens that need **no API, no database and no data**: a static server serves the production build of the Angular app and Playwright answers every `/api/**` call from `mock.mjs` (a fake person with every permission, three reports, a 2,380-row and a 50,000-row result, saved views, the Report Setup lists). Nothing is written anywhere. Desktop only (1366x768 and 1920x1080, D-82). Issue #726.

```
cd frontend && npm run build                      # dist/frontend/browser
node tools/reports-checks/axe.mjs   frontend/dist/frontend/browser 4660 [filter]   # axe at both sizes, every state; SHOTS=<dir> saves 1366 JPEGs
node tools/reports-checks/keys.mjs  frontend/dist/frontend/browser 4661            # Tab order, grid heading stops and Shift+Arrow resize, Saved Views menu and dialogs (focus in, Esc out, focus return)
node tools/reports-checks/perf.mjs  frontend/dist/frontend/browser 4662            # 50,000 rows: first rows, page change, sort, heap, long tasks
node tools/reports-checks/dup.mjs   frontend/dist/frontend/browser 4664            # two columns named Name: the requests the grid sends (SHOTS=<dir>)
node tools/reports-checks/favourites.mjs frontend/dist/frontend/browser 4665       # #723: axe at both sizes on the list with stars, the Favourites chip and the Recent line, the star by keyboard, a failed press, chips that fit (SHOTS=<dir>)
```

Needs Chromium (`E2E_CHROMIUM_PATH`, default the cloud container's `/opt/pw-browsers/chromium-1194`) and the `playwright` and `axe-core` packages of a frontend `node_modules` (`FRONTEND_DIR`, default `frontend/`). The server of the mock answers instantly, so the timings measure the browser (parse, render, change detection), not the network or the database. Unmatched calls of the shell are logged at the end of `axe.mjs`; they answer `[]` or `{}`.
