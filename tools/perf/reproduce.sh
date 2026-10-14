#!/usr/bin/env bash
# Reproduces the performance round (docs/qa/performance-round-1.md) on a throwaway stack:
#   SQL Server 2022 container (random loopback port) -> published API (Release, Dev auth) -> realistic dataset -> load tests -> top statements.
# Everything it starts is removed again (the container, the API process); results go to artifacts/perf-results/.
#
#   tools/perf/reproduce.sh                    # Scale 1, 50 and 100 virtual users, 60 s each
#   PERF_SCALE=0.1 PERF_VUS="20" PERF_DURATION=20 tools/perf/reproduce.sh      # quick smoke run
#
# Environment (all optional):
#   PERF_SCALE=1            dataset size factor (1 = 25,000 Tasks, 52k Assets, 485k audit events; needs about 3 GB of disk)
#   PERF_VUS="50 100"       virtual-user counts, one run each
#   PERF_DURATION=60        seconds per run (after PERF_WARMUP=10 seconds of warm-up)
#   PERF_THINK=400-1600     think time range between a user's requests in ms (0-0 with PERF_NO_LIMITS=1 is the saturation test)
#   PERF_NO_LIMITS=1        lift the per-user API rate limits (for the saturation test)
#   PERF_SQL_MEMORY_MB=3072 memory the SQL Server container may use (MSSQL_MEMORY_LIMIT_MB)
#   PERF_API_DIR=...        use an already published API folder instead of publishing (artifacts/perf-publish)
#   PERF_KEEP=1             leave SQL and the API running afterwards (prints how to stop them)
#   PERF_RESTORE_BETWEEN=1  restore the freshly seeded database before each run (default; 0 keeps the data the previous run changed)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
scale="${PERF_SCALE:-1}"
vus_list="${PERF_VUS:-50 100}"
duration="${PERF_DURATION:-60}"
warmup="${PERF_WARMUP:-10}"
think="${PERF_THINK:-400-1600}"
memory="${PERF_SQL_MEMORY_MB:-3072}"
publish_dir="${PERF_API_DIR:-$root/artifacts/perf-publish}"
results="$root/artifacts/perf-results"
sql_name="mf-perf-sql-$$"
sql_password='MatterFlow_Perf1!'
api_pid=""

need_kb="$(awk -v s="$scale" 'BEGIN { print (s >= 0.5) ? 6000000 : 2500000 }')"
free_kb="$(df -Pk "$root" | awk 'NR==2 {print $4}')"
if [ "$free_kb" -lt "$need_kb" ]; then
  echo "Only $((free_kb / 1024)) MB free on the disk of $root; this run needs about $((need_kb / 1024)) MB (SQL Server data, log, backup and the publish output)." >&2
  exit 1
fi

cleanup() {
  status=$?
  if [ "${PERF_KEEP:-0}" = "1" ]; then
    echo "Stack left running: kill ${api_pid:-<none>}; docker rm -f $sql_name"
  else
    [ -n "$api_pid" ] && kill "$api_pid" 2>/dev/null || true
    docker rm -f "$sql_name" >/dev/null 2>&1 || true
  fi
  exit $status
}
trap cleanup EXIT

sqlcmd() { docker exec "$sql_name" /opt/mssql-tools18/bin/sqlcmd -I -C -S localhost -U sa -P "$sql_password" "$@"; }

mkdir -p "$results"

if [ ! -f "$publish_dir/MatterFlow.Api.dll" ]; then
  echo "==> dotnet publish (Release, linux-x64) -> $publish_dir"
  dotnet publish "$root/backend/src/MatterFlow.Api/MatterFlow.Api.csproj" -c Release -r linux-x64 --self-contained false -o "$publish_dir" -p:OpenApiGenerateDocuments=false >/dev/null
fi

echo "==> SQL Server container $sql_name"
docker run -d --name "$sql_name" -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=$sql_password" -e "MSSQL_MEMORY_LIMIT_MB=$memory" \
  -p 127.0.0.1::1433 mcr.microsoft.com/mssql/server:2022-latest >/dev/null
sql_port="$(docker port "$sql_name" 1433/tcp | head -n1 | sed 's/.*://')"
for _ in $(seq 1 90); do
  sqlcmd -b -Q "SELECT 1" >/dev/null 2>&1 && break
  sleep 2
done
# Pre-sized files (no growth pauses during the load), simple recovery, read committed snapshot as the runbook asks.
sqlcmd -b -Q "CREATE DATABASE MatterFlow; ALTER DATABASE MatterFlow SET RECOVERY SIMPLE; ALTER DATABASE MatterFlow SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE; ALTER DATABASE MatterFlow MODIFY FILE (NAME=MatterFlow, SIZE=1024MB, FILEGROWTH=256MB); ALTER DATABASE MatterFlow MODIFY FILE (NAME=MatterFlow_log, SIZE=512MB, FILEGROWTH=256MB);"

api_port="${PERF_API_PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"
connection="Server=127.0.0.1,$sql_port;Database=MatterFlow;User Id=sa;Password=$sql_password;TrustServerCertificate=True;Encrypt=False;Max Pool Size=200;Application Name=MatterFlow"

start_api() {
  (
    cd "$publish_dir"
    export ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS="http://127.0.0.1:$api_port"
    export ConnectionStrings__MatterFlow="$connection" ConnectionStrings__Migrations="$connection"
    export Seed__StarterConfiguration__Enabled=true Security__AllowPrivilegedDatabaseIdentity=true Hosting__ServeSpa=false
    export Dev__Users__0__Username=perf.admin Dev__Users__0__DisplayName="Perf Admin" Dev__Users__0__Roles__0="System Admin"
    export Logging__LogLevel__Default=Warning
    if [ "${PERF_NO_LIMITS:-0}" = "1" ]; then
      for budget in ApiPerMinute CommentWritesPerMinute TaskWritesPerMinute SearchPerMinute AdvancedSearchPerMinute AuditPerMinute DashboardPerMinute; do
        export "RateLimits__$budget=1000000"
      done
    fi
    exec dotnet MatterFlow.Api.dll >"$results/api.log" 2>&1
  ) &
  api_pid=$!
  for _ in $(seq 1 90); do
    curl -s -o /dev/null -H 'X-MatterFlow-Client: web' -H 'X-Dev-User: perf.admin' "http://127.0.0.1:$api_port/api/v1/me" && return 0
    sleep 1
  done
  echo "The API did not start; see $results/api.log" >&2
  return 1
}

stop_api() {
  [ -n "$api_pid" ] && kill "$api_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
  api_pid=""
}

echo "==> API on port $api_port (migrates the schema and seeds the starter configuration)"
start_api
stop_api

echo "==> Seeding the dataset (Scale=$scale)"
docker cp "$here/seed-perf-data.sql" "$sql_name:/tmp/seed-perf-data.sql"
sqlcmd -b -d MatterFlow -v "Scale=$scale" -i /tmp/seed-perf-data.sql | tee "$results/seed.txt" | tail -16

echo "==> Backup of the seeded database (restored before every run)"
sqlcmd -b -Q "BACKUP DATABASE MatterFlow TO DISK='/var/opt/mssql/data/seeded.bak' WITH INIT, COMPRESSION" >/dev/null

docker cp "$here/top-queries.sql" "$sql_name:/tmp/top-queries.sql"
for vus in $vus_list; do
  if [ "${PERF_RESTORE_BETWEEN:-1}" = "1" ]; then
    sqlcmd -b -Q "ALTER DATABASE MatterFlow SET SINGLE_USER WITH ROLLBACK IMMEDIATE; RESTORE DATABASE MatterFlow FROM DISK='/var/opt/mssql/data/seeded.bak' WITH REPLACE; ALTER DATABASE MatterFlow SET MULTI_USER;" >/dev/null
  fi
  echo "==> $vus virtual users, ${duration}s (think $think ms)"
  start_api
  node "$here/loadtest.mjs" --base "http://127.0.0.1:$api_port" --vus "$vus" --duration "$duration" --warmup "$warmup" --think "$think" \
    --out "$results/run-$vus.json" | tee "$results/run-$vus.md"
  sqlcmd -d MatterFlow -W -w 600 -i /tmp/top-queries.sql >"$results/top-queries-$vus.txt"
  stop_api
done

echo "Results are in $results (run-*.md tables, run-*.json raw data, top-queries-*.txt statements and missing-index hints)."
