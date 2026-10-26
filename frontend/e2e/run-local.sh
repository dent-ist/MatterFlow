#!/usr/bin/env bash
# Runs the whole Playwright suite against a throwaway real stack:
#   SQL Server 2022 (docker, random loopback port) + the published API (Dev auth) serving the built Angular app on one origin.
# Tears everything down afterwards (only the container and process this script started).
#
#   frontend/e2e/run-local.sh [playwright args...]        e.g. frontend/e2e/run-local.sh -g SCN-015
#
# Environment (all optional):
#   E2E_API_PORT=5190        port of the API / app (http://127.0.0.1:$E2E_API_PORT). If it is already in use the script stops with a message
#                            (it never reuses a stack somebody else started). When not given, the first free port from 5190 up is chosen and printed.
#   E2E_SKIP_BUILD=1         reuse artifacts/e2e-publish from an earlier run (skips npm build and dotnet publish)
#   E2E_KEEP_STACK=1         leave SQL and the API running after the tests (prints how to stop them)
#   E2E_RID=linux-x64        runtime identifier used for the publish
#   E2E_AXE_PATH=...         axe.min.js for the accessibility checks (default: the installed axe-core package)
#   E2E_CHROMIUM_PATH=...    Chromium executable (default: the preinstalled one if present, else Playwright's own browser)
#   E2E_SENSITIVE_ACCESS=1   start the API with the go-live switch of the sensitive-matter rule on (Features__SensitiveMatterAccess=true, epic #788).
#                            It is also turned on by itself when a Playwright argument names a sensitive-*.spec.ts file. Off otherwise, as in
#                            appsettings.json; the sensitive-* specs skip themselves when the switch is off.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
# Is something listening on 127.0.0.1:$1? (bash /dev/tcp; no ss/lsof needed)
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
if [ -n "${E2E_API_PORT:-}" ]; then
  api_port="$E2E_API_PORT"
  if port_in_use "$api_port"; then
    echo "ERROR: port $api_port is already in use (another stack or agent?). The readiness check would pass against that listener, so the run was refused." >&2
    echo "       Pick a free port: E2E_API_PORT=<port> $0 ..., or leave E2E_API_PORT unset to get a free one." >&2
    exit 2
  fi
else
  api_port=5190
  while port_in_use "$api_port"; do api_port=$((api_port + 1)); done
  echo "==> E2E_API_PORT not set: using free port $api_port"
fi
rid="${E2E_RID:-linux-x64}"
publish_dir="$root/artifacts/e2e-publish"
sql_name="mf-e2e-sql-$$"
sql_password='MatterFlow_Dev1!'
api_pid=""

# The go-live switch of the sensitive-matter rule: off for the ordinary suite, on for the sensitive-* specs (named in the arguments or by E2E_SENSITIVE_ACCESS=1).
sensitive_access="${E2E_SENSITIVE_ACCESS:-0}"
for arg in "$@"; do
  case "$arg" in *sensitive-*) sensitive_access=1 ;; esac
done
if [ "$sensitive_access" = "1" ]; then sensitive_switch=true; else sensitive_switch=false; fi

cleanup() {
  status=$?
  if [ "${E2E_KEEP_STACK:-0}" = "1" ]; then
    echo "Stack left running: kill ${api_pid:-<none>}; docker rm -f $sql_name"
  else
    [ -n "$api_pid" ] && kill "$api_pid" 2>/dev/null || true
    docker rm -f "$sql_name" >/dev/null 2>&1 || true
  fi
  exit $status
}
trap cleanup EXIT

mkdir -p "$root/artifacts"
[ -d "$root/frontend/node_modules" ] || (cd "$root/frontend" && npm ci)

if [ "${E2E_SKIP_BUILD:-0}" != "1" ] || [ ! -x "$publish_dir/MatterFlow.Api" ]; then
  echo "==> Build and publish (Angular build inside wwwroot)"
  SKIP_FRONTEND_INSTALL=1 "$root/deploy/publish.sh" "$publish_dir" "$rid"
fi

echo "==> SQL Server container $sql_name"
docker run -d --name "$sql_name" -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=$sql_password" \
  -p 127.0.0.1::1433 mcr.microsoft.com/mssql/server:2022-latest >/dev/null
sql_port="$(docker port "$sql_name" 1433/tcp | head -n1 | sed 's/.*://')"
for _ in $(seq 1 90); do
  if docker exec "$sql_name" /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$sql_password" -b \
    -Q "IF DB_ID('MatterFlow') IS NULL CREATE DATABASE MatterFlow" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
echo "    SQL Server on 127.0.0.1:$sql_port"

echo "==> API on http://127.0.0.1:$api_port (sensitive-matter rule: $sensitive_switch)"
conn="Server=127.0.0.1,$sql_port;Database=MatterFlow;User Id=sa;Password=$sql_password;TrustServerCertificate=True"
reports_conn="Server=127.0.0.1,$sql_port;Database=MatterFlow;User Id=mf_reports;Password=MatterFlow_Reports1!;TrustServerCertificate=True;Encrypt=True;Application Name=MatterFlow.Reports;ApplicationIntent=ReadOnly;Connect Timeout=10;Max Pool Size=8"
(
  cd "$publish_dir"
  export ASPNETCORE_ENVIRONMENT=Development
  export ASPNETCORE_URLS="http://127.0.0.1:$api_port"
  export ConnectionStrings__Default="$conn"
  export ConnectionStrings__MatterFlow="$conn"
  # The read-only report login (epic #671): every report runs under it, never under the application login. The login itself is created below,
  # once the API has applied the schema (which creates the database role mf_report_reader); Reports stay "not ready" until it exists.
  export ConnectionStrings__ReportsReadOnly="$reports_conn"
  export Hosting__ServeSpa=true
  export Auth__Provider=Dev
  export Auth__Dev__DefaultUser='ke\kekim'
  export Bootstrap__SystemAdmins__0='ke\kekim'
  export Seed__StarterConfiguration__Enabled=true
  export Features__SensitiveMatterAccess="$sensitive_switch"
  # The notification scheduler (timer inside the API, epic #753) ticks every minute here instead of every five, so the scheduled-notification
  # specs do not wait five minutes. Production keeps the defaults (first run after 30 s, then every 5 minutes).
  export Notifications__Scheduler__InitialDelaySeconds=2
  export Notifications__Scheduler__IntervalMinutes=1
  # The per-user request budgets (RateLimits, SEC2-03) are sized for people. The suite runs all workers and every setup call as one System
  # Admin, so under load it used up the task-write budget (429 TOO_MANY_REQUESTS on POST /tasks in test setup). Raised for this throwaway
  # stack only; the defaults in code and in production configuration are unchanged.
  export RateLimits__ApiPerMinute=1000000
  export RateLimits__TaskWritesPerMinute=1000000
  export RateLimits__CommentWritesPerMinute=1000000
  export RateLimits__SearchPerMinute=1000000
  export RateLimits__AdvancedSearchPerMinute=1000000
  export RateLimits__AuditPerMinute=1000000
  export RateLimits__DashboardPerMinute=1000000
  exec ./MatterFlow.Api
) >"$root/artifacts/e2e-api.log" 2>&1 &
api_pid=$!

for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:$api_port/health/ready" >/dev/null 2>&1; then ready=1; break; fi
  kill -0 "$api_pid" 2>/dev/null || { echo "API exited early:"; tail -n 40 "$root/artifacts/e2e-api.log"; exit 1; }
  sleep 2
done
[ "${ready:-0}" = "1" ] || { echo "API did not become ready"; tail -n 40 "$root/artifacts/e2e-api.log"; exit 1; }

echo "==> Read-only report login (tools/db/provision-report-login.sql, the same script npm start runs)"
docker cp "$root/tools/db/provision-report-login.sql" "$sql_name:/tmp/provision-report-login.sql" >/dev/null
docker exec "$sql_name" /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$sql_password" -d MatterFlow -b -i /tmp/provision-report-login.sql >/dev/null
# The API probed the login at its start, before it existed: ask it to probe again (the admin page's "Check again").
curl -sf -X POST -H 'X-Dev-User: ke\kekim' -H 'X-MatterFlow-Client: web' "http://127.0.0.1:$api_port/api/v1/report-admin/status/check" >/dev/null \
  || { echo "Reports are not ready"; tail -n 40 "$root/artifacts/e2e-api.log"; exit 1; }

echo "==> Playwright"
cd "$root/frontend"
if [ -z "${E2E_CHROMIUM_PATH:-}" ] && [ -x /opt/pw-browsers/chromium-1194/chrome-linux/chrome ]; then
  export E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
  export E2E_NO_SANDBOX=1 # the preinstalled browser runs as root in the sandbox container
fi
export E2E_BASE_URL="http://127.0.0.1:$api_port"
# For the few tests that need a row the API can no longer create (a description saved as plain text before rich text, decision R): they run
# one UPDATE inside this throwaway container and skip themselves when these are not set.
export E2E_SQL_CONTAINER="$sql_name"
export E2E_SQL_PASSWORD="$sql_password"
npx playwright test -c e2e/playwright.config.ts "$@"
