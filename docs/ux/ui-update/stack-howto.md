# Stack how-to (cloud container) for the UI update 2 crawl and for QA

Written by Agent U on 2026-11-04. The stack below was started from a worktree of `origin/ui-update-2` at `/home/user/wt/ui-designer` and is LEFT RUNNING. Demo data: `seed:demo --aged --seed 7` (run tag `DRLEN`). Nothing here is secret (the SQL password is the public dev password of `docker-compose.dev.yml`).

## What is running

| Part | How it runs | Port | Logs / pid |
| --- | --- | --- | --- |
| Docker daemon | `nohup dockerd >/tmp/dockerd.log 2>&1 &` | | `/tmp/dockerd.log` |
| SQL Server 2022 | container `matterflow-sql` from `docker-compose.dev.yml` (volume `matterflow-sql-data`) | 127.0.0.1:1433 | `docker logs matterflow-sql` |
| API | `dotnet run --no-build --project backend/src/MatterFlow.Api` (Development, Dev auth) | 5080 | `/home/user/ud-run/api.log`, `api.pid` |
| Web | `npm run start:api` in `frontend/` (`ng serve --configuration api`, proxies `/api` to 5080) | 4200 | `/home/user/ud-run/web.log`, `web.pid` |

`frontend/node_modules` in the worktree is a hard-link copy (`cp -al`) of `/home/user/wt/mdetail/frontend/node_modules` (no extra disk). `frontend/dist/form-engine` was built once with `npm run ng -- build form-engine`.

## Start from nothing (about 3 minutes)

```bash
nohup dockerd >/tmp/dockerd.log 2>&1 &          # wait about 12 s
cd <worktree of origin/ui-update-2>
cp -al /home/user/wt/mdetail/frontend/node_modules frontend/node_modules      # once
cd frontend && /home/user/.mf-heavy/heavy.sh timeout 900 npm run ng -- build form-engine && cd ..   # once
/home/user/.mf-heavy/heavy.sh timeout 1200 dotnet build backend/src/MatterFlow.Api -c Debug          # after code changes
docker compose -f docker-compose.dev.yml up -d --wait sqlserver
docker compose -f docker-compose.dev.yml run --rm --no-deps sqlserver-init                          # creates the empty database
docs/ux/ui-update/stack-start.sh                 # API :5080 and web :4200, as KE\kekim (pass another account as first argument)
node tools/seed-demo/seed-demo.mjs --aged --seed 7     # about 3 minutes, only on an empty database
```

The root `npm start` is not used (no root `node_modules`); `stack-start.sh` sets the same environment variables the `api:run` script sets.

## Stop and restart

```bash
kill $(cat /home/user/ud-run/api.pid) $(cat /home/user/ud-run/web.pid)   # only your own processes; never pkill
docs/ux/ui-update/stack-start.sh                                          # start again (the data stays in the Docker volume)
docker compose -f docker-compose.dev.yml down        # stop SQL Server (add -v to delete the data; then run the init and the seed again)
```

If `kill` leaves a child behind, find it with `ps aux | grep -E "MatterFlow.Api|ng serve"` and kill that pid only.

## Personas (Dev auth)

The Dev provider signs in as `Auth__Dev__DefaultUser`, or as the header `X-Dev-User` (Playwright: `extraHTTPHeaders`). Accounts of the demo seed:

| Persona | Account | Notes |
| --- | --- | --- |
| Director | `KE\testuser02` | sees every sensitive matter; admin menu shows Users and Audit Logs only |
| Pod Lead | `KE\testuser06` | Dashboard (no Breakdowns/Trends), Pod Work |
| Technician | `KE\testuser01` | My Work, Task Queue, no Dashboard tabs; sees no sensitive matters |
| Project Manager | `KE\testuser35` | manages one matter; the only persona with My Matters |
| System Admin | `KE\kekim` | everything; 7 unread notifications |
| Pending | `KE\newhire` | provisioned on first request with no role: Access Pending |

## The crawl scripts

`docs/ux/ui-update/crawl/` holds the Playwright scripts that made `screenshots/` (Chromium from `/opt/pw-browsers`, no `playwright install`): `node crawl.js <outDir> <persona|all> <WxH|all> [folderRegex]`. They need the stack above. Screenshots are 8-bit PNG at deviceScaleFactor 1.

## Data the crawl changed

Crawl step "Add priority" created the priority `UI sample`; the profile save step turned Saturday ON in `KE\testuser02`'s work days (left on); the Settings > Dashboard step set Level 1 to 2 hours (default is 1). Reset with `npm run db:reset`-equivalent: `docker compose ... down -v`, init, API start, seed.

## Disk

`df -h /home` showed about 5.7 GB free at the start (allowance fixed per session). The worktree, node_modules (hard links), dotnet build output, the Docker image (2.35 GB, already pulled by an earlier agent) and the screenshots (about 30 MB after palette compression) are what this stack uses. Delete nothing that you did not create.
