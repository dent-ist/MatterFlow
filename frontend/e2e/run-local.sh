#!/usr/bin/env bash
# Runs the whole Playwright suite against a throwaway real stack:
#   SQL Server 2022 (docker, random loopback port) + the published API (Dev auth) serving the built Angular app on one origin.
# Tears everything down afterwards (only the container and process this script started).
#
#   frontend/e2e/run-local.sh [playwright args...]        e.g. frontend/e2e/run-local.sh -g SCN-015
#
# Environment (all optional):
#   E2E_API_PORT=5190        port of the API / app (http://127.0.0.1:$E2E_API_PORT)
#   E2E_SKIP_BUILD=1         reuse artifacts/e2e-publish from an earlier run (skips npm build and dotnet publish)
#   E2E_KEEP_STACK=1         leave SQL and the API running after the tests (prints how to stop them)
#   E2E_RID=linux-x64        runtime identifier used for the publish
#   E2E_CHROMIUM_PATH=...    Chromium executable (default: the preinstalled one if present, else Playwright's own browser)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
api_port="${E2E_API_PORT:-5190}"
rid="${E2E_RID:-linux-x64}"
publish_dir="$root/artifacts/e2e-publish"
sql_name="mf-e2e-sql-$$"
sql_password='MatterFlow_Dev1!'
api_pid=""

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

echo "==> API on http://127.0.0.1:$api_port"
conn="Server=127.0.0.1,$sql_port;Database=MatterFlow;User Id=sa;Password=$sql_password;TrustServerCertificate=True"
(
  cd "$publish_dir"
  export ASPNETCORE_ENVIRONMENT=Development
  export ASPNETCORE_URLS="http://127.0.0.1:$api_port"
  export ConnectionStrings__Default="$conn"
  export ConnectionStrings__MatterFlow="$conn"
  export Hosting__ServeSpa=true
  export Auth__Provider=Dev
  export Auth__Dev__DefaultUser='ke\kekim'
  export Bootstrap__SystemAdmins__0='ke\kekim'
  export Seed__StarterConfiguration__Enabled=true
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
