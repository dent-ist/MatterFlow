# Local Setup

[[_TOC_]]

**What this page is for.** How to run SQL Server, the API and the web app on your own machine (Windows or Linux), how Dev authentication and personas work, and how to load demo data. The full text is in `README.md`; this page is the short version.

## Prerequisites

- .NET SDK 10 (`global.json`).
- Node.js 22.12 or newer and npm (the root and frontend `package.json` require `>=22.12`).
- Docker (for SQL Server 2022 and for the Docker-based tests).
- Angular CLI is pinned to v21 through the repo-local CLI. Always use `npm run ng -- ...` inside `frontend/`, never a global or latest CLI.

## One command (from the repository root)

```
npm install        # root helper tools (concurrently, cross-env)
npm run setup      # frontend dependencies and the form-engine library (first time, and after dependency changes)
npm start          # SQL Server in Docker, then the API on :5080 and the Angular dev server on :4200
```

`npm start` sets the Development environment itself: local Docker connection string, initial admin `KE\kekim`, Dev authentication, starter data. It stops both servers on Ctrl+C.

| Part | Address |
|---|---|
| Web app (Angular dev server, proxies `/api` to the API) | http://localhost:4200 |
| API | http://localhost:5080 (liveness `/health/live`, readiness `/health/ready`) |
| Swagger UI (Development only) | http://localhost:5080/swagger (OpenAPI JSON at `/openapi/v1.json`) |
| SQL Server | `127.0.0.1:1433`, database `MatterFlow`, user `sa`, the public dev password in `docker-compose.dev.yml` |

Other root scripts: `db:up`, `db:down`, `db:reset` (deletes the database volume and starts again), `api`, `web`, `form-engine`, `start:user1` to `start:user3` (sign in as another Dev user), `seed:demo`.

The compose file only creates an empty database. The API creates the schema itself at startup by running the numbered scripts (see [Database Overview](../Database/Overview.md)).

## Dev authentication and personas

The `Dev` provider is only allowed when `ASPNETCORE_ENVIRONMENT` is `Development` or `Test`; production uses Windows authentication. Never weaken that guard (see [Authentication and Authorization](../Architecture/Authentication-and-Authorization.md)).

- `Auth:Dev:DefaultUser` is the user every browser request is signed in as (`npm start` uses `KE\kekim`, the bootstrap System Admin).
- The header `X-Dev-User` (or in Development the query `?devUser=`) names the caller for one request.
- `backend/src/MatterFlow.Api/appsettings.Development.json` seeds `KE\user1` to `KE\user10` (role Data Technician) from `Dev:Users`.
- A user with no roles lands on the **Access Pending** page until an admin assigns a role (Administration > Users).

Personas of the demo data are listed in [Demo Data and Personas](../Operations/Demo-Data-and-Personas.md).

## Demo data

With the app running, in a second terminal at the repository root:

```
npm run seed:demo
npm run seed:demo -- --tasks 50 --seed 7
npm run seed:demo -- --dry-run
```

The seeder talks to the real HTTP API, so every record passes the normal validation. Options and what it creates: see [Demo Data and Personas](../Operations/Demo-Data-and-Personas.md) and `README.md`.

## Run the API and web app separately

```
docker compose -f docker-compose.dev.yml up -d --wait sqlserver
docker compose -f docker-compose.dev.yml run --rm --no-deps sqlserver-init
cd backend && dotnet run --project src/MatterFlow.Api        # needs ConnectionStrings__Default and __MatterFlow, Auth__Dev__DefaultUser
cd frontend && npm ci && npm run start:api                   # real API; plain `npm start` uses an in-memory stub
```

## Windows notes

- PowerShell: set environment variables with `$env:NAME = 'value'`.
- Keep `.gitattributes` line endings; SQL scripts are hashed after line-ending normalisation, but write them LF.
- `npm install` at the root and `npm ci` in `frontend/` are separate (the frontend has its own `.npmrc` with `legacy-peer-deps`).

## Related pages

- [Commands](Commands.md)
- [Cloud Container Notes](Cloud-Container-Notes.md)
- [Troubleshooting](../Operations/Troubleshooting.md)
- [Configuration Reference](../Operations/Configuration-Reference.md)

Last verified against commit b03d0ac.
