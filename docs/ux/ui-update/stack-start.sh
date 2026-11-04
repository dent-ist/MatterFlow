#!/usr/bin/env bash
# Starts the dev stack from a worktree of origin/ui-update-2 (run from the worktree root). See stack-howto.md.
# Usage: stack-start.sh [account]   (default account KE\kekim = System Admin; the Dev provider signs every browser request in as it)
set -u
ACCOUNT="${1:-KE\\kekim}"
ROOT="$(pwd)"; LOGS="${MF_LOGS:-/home/user/ud-run}"; mkdir -p "$LOGS"
export ASPNETCORE_ENVIRONMENT=Development
export "ConnectionStrings__Default=Server=127.0.0.1,1433;Database=MatterFlow;User Id=sa;Password=MatterFlow_Dev1!;TrustServerCertificate=True;Connect Timeout=60"
export "ConnectionStrings__MatterFlow=$ConnectionStrings__Default"
export "Bootstrap__SystemAdmins__0=KE\\kekim" Seed__StarterConfiguration__Enabled=true
export "Auth__Dev__DefaultUser=$ACCOUNT"
export Features__SensitiveMatterAccess=true
(nohup dotnet run --no-build --project backend/src/MatterFlow.Api > "$LOGS/api.log" 2>&1 & echo $! > "$LOGS/api.pid")
(cd frontend && nohup npm run start:api > "$LOGS/web.log" 2>&1 & echo $! > "$LOGS/web.pid")
echo "API http://localhost:5080  web http://localhost:4200  logs $LOGS"
