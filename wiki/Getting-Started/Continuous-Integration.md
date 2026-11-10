# Continuous Integration

[[_TOC_]]

**What this page is for.** What the GitHub Actions workflows check, when they run, and how to reproduce each check on your machine before you push. Source: `.github/workflows/*.yml`, `.github/actions/setup-dotnet`, `.github/dependabot.yml`.

## Workflows

| Workflow | When | What it does |
|---|---|---|
| `ci.yml` | Push to `dev` and every pull request, except changes that only touch `docs/**` or `*.md` (so wiki-only changes do not run it) | Three parallel jobs, below |
| `e2e.yml` | Manually, weekly (Mondays 03:43 UTC), and on pull requests carrying the label `e2e` | Playwright suite against a real stack, then the `sensitive-*` specs with the sensitive-matter switch on |
| `nightly.yml` | Weekly (Mondays 03:17 UTC) and manually | Full backend suite (unit, architecture, schema, integration), frontend test and build, NuGet vulnerability scan, `npm audit --omit=dev --audit-level=high` |
| `publish.yml` | Manually | Builds the IIS package with `deploy/publish.sh ... win-x64` and checks its contents; uploads it as an artifact |
| `codeql.yml` | Weekly (Mondays 04:41 UTC) and manually | CodeQL analysis for C# and JavaScript/TypeScript |
| Dependabot | Monthly, grouped | Minor and patch updates only; major versions are ignored on purpose (owner, 2026-10-24) |

## The three jobs of `ci.yml`

| Job | Steps | Reproduce locally |
|---|---|---|
| `backend` | Build `-c Release -warnaserror`; OpenAPI drift check (`git diff --exit-code -- ../contracts/openapi/v1.json` after the build); `dotnet format --verify-no-changes`; unit and architecture tests | In `backend/`: `dotnet build -warnaserror`, then `git diff --exit-code -- ../contracts/openapi/v1.json`, `dotnet format --verify-no-changes`, `dotnet test tests/LptHub.UnitTests`, `dotnet test tests/LptHub.ArchitectureTests` |
| `backend-integration` | Pre-pull the SQL Server image, build, run `LptHub.IntegrationTests` and `LptHub.SchemaTests` (about 5 minutes) | Needs Docker: `dotnet test tests/LptHub.IntegrationTests` and `dotnet test tests/LptHub.SchemaTests` |
| `frontend` | `npm ci`; `npm run lint`; `npm run format:check`; `npm test`; API client drift check (`npm run api:generate` then `git diff --exit-code -- src/app/api/generated`); `npm run build` | In `frontend/`: the same commands |

A newer push to the same branch or pull request cancels the run in progress.

## Common reasons CI fails

| Symptom | Cause and fix |
|---|---|
| OpenAPI drift | You changed an endpoint or DTO and did not commit the regenerated `contracts/openapi/v1.json`. Build the backend and commit the file. |
| API client drift | You changed the OpenAPI document and did not run `npm run api:generate`. Commit `src/app/api/generated/`. |
| Architecture test failure | A module references something it must not, or a controller action has no policy, or a new endpoint is not in `SensitiveAccessCatalog`. See [Backend Modules](../Architecture/Backend-Modules.md) and [Testing the Backend](../Backend/Testing-the-Backend.md). |
| `ReportAccessCatalogueTests` fails | A new table is not classified in `db/report-access.json` and not granted or denied in its script. See [How to Change the Schema](../Database/How-to-Change-the-Schema.md). |
| Format check | Run `dotnet format` or `npx prettier --write` on the changed files. |
| Lint colour or icon-size scripts | A colour literal or off-scale size in a template or stylesheet; use the tokens. |
| Duplicate script prefix | Two scripts share a number; renumber the unmerged one. |

## Related pages

- [Commands](Commands.md)
- [Troubleshooting](../Operations/Troubleshooting.md)
- [Release Checklist](../How-To/Release-Checklist.md)

Last verified against commit b03d0ac.
