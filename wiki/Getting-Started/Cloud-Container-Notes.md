# Cloud Container Notes

[[_TOC_]]

**What this page is for.** Tips for working in the ephemeral Linux cloud container (where AI agents and some developers work). The source is `docs/dev-environment.md` (verified there on 2026-10-14) and `docs/ux/ui-update/stack-howto.md`.

## Setup facts

| Topic | What to do |
|---|---|
| .NET | The official `dotnet-install` script is blocked by the egress proxy. Use apt: `apt-get update && apt-get install -y dotnet-sdk-10.0`. NuGet restore works through the proxy. |
| Docker | Start the daemon first: `nohup dockerd >/tmp/dockerd.log 2>&1 &`, then wait about 10 seconds. |
| SQL Server | `docker compose -f docker-compose.dev.yml up -d --wait sqlserver` (or `docker run` of `mcr.microsoft.com/mssql/server:2022-latest`). Ready in about 30 seconds. Connection strings need `TrustServerCertificate=True`. |
| Node and Angular | Node is 22.x. The latest Angular CLI refuses to run on it, so use the repo-local CLI (`npm run ng -- ...`). |
| Browser | Headless Chromium exists at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Do not run `playwright install`. |

## Rules for shared containers

- Disk is tight. Check `df -h /` before building. A full Angular or .NET build, a `node_modules` copy and Docker images all use gigabytes.
- Do not copy `node_modules`; hard-link (`cp -al`) an existing copy instead (this is what `docs/ux/ui-update/stack-howto.md` does).
- Never `pkill`. Kill only the process ids you started.
- Several agents may share one SQL Server container. Reads are fine; never reset the database or stop a container you did not start.
- The container restarts now and then and kills running work: commit and push in small steps.
- Use one git worktree per task (`git worktree add <path> origin/<branch>`) and remove it when finished.

## Related pages

- [Local Setup](Local-Setup.md)
- [Troubleshooting](../Operations/Troubleshooting.md)
- [Branching and Workflow](Branching-and-Workflow.md)

Last verified against commit b03d0ac.
