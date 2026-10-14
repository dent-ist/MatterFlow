# Dev environment notes (cloud container)

Verified 2026-10-14 in the ephemeral Linux container.

## .NET
- The official `dotnet-install` script is blocked (403 from the egress proxy). Use apt:
  `apt-get update && apt-get install -y dotnet-sdk-10.0` (10.0 is LTS; SDK 10.0.112). `dotnet` lands in `/usr/bin`; no PATH changes needed.
- If a project needs .NET 8: `apt-get install -y dotnet-sdk-8.0`.
- NuGet restore works through the proxy.

## SQL Server (for integration tests and local runs)
- Start the Docker daemon first: `nohup dockerd >/tmp/dockerd.log 2>&1 &` then wait ~10s.
- `docker run -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD=<pw> -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest` (image pulls fine; ready in ~30s).
- Connection strings need `TrustServerCertificate=True`.

## Angular / browser
- Node is v22.22.0. `@angular/cli@latest` needs Node >= 22.22.3 and refuses to run. **Pin Angular CLI to v21 or lower** (v21.2.x verified) or use the repo's local `@angular/cli`.
- Headless Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` works with `--headless --no-sandbox --disable-gpu`. Do not run `playwright install`.
