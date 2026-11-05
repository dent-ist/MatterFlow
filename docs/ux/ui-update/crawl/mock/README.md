# API mock for screenshots (UI update 2, batch 3a)

Used when the demo stack (ports 4200 / 5080) is not running. It answers every operation of `contracts/openapi/v1.json` with sample data generated from
the schemas (lists have 4 rows). The data is generic ("Sample Alpha", "TSK-100"), so a page looks plausible but not like the demo database. Nothing is saved.

```bash
node docs/ux/ui-update/crawl/mock/server.mjs 5293                       # the API mock
cd frontend && npm run ng -- serve --port 4293 --proxy-config ../docs/ux/ui-update/crawl/mock/proxy.json   # the app (stub sign-in as Director)
CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node docs/ux/ui-update/crawl/mock/shots-batch3a.mjs <outDir>
```

- `server.mjs`: the mock; the `overrides` list pins answers that need real values (add more there when a page needs them).
- `shot.mjs`: launch and viewport helpers for Playwright (`@playwright/test` from `frontend/node_modules`).
- `shots-batch3a.mjs`: opens each dialog of batch 3a at 1366x768 and 1920x1080 and saves a screenshot plus measurements.
- `shots-batch3b.mjs`: batch 3b (confirm dialogs #1141, drawers #1142, menus #1143): `node shots-batch3b.mjs <outDir> '<id regex>' [appUrl]`; saves a screenshot plus measurements per scenario and prints `MISS` for a scenario the mock data cannot open (Dashboard swimlane cards and coverage cells need real data).
- Use other ports than 4200 / 5080: those belong to the demo stack.
