# Release Checklist

[[_TOC_]]

**What this page is for.** What to check before and during a release. MatterFlow has not been deployed yet (`CLAUDE.md`), so this checklist is built from the CI definitions and `docs/runbook.md` (sections 5 to 9, 12) and has not been rehearsed on a real server. The remaining owner items are in runbook section 9 ("What the product owner must verify on the real server"). Which branch a release comes from and the steps before it (pull request, full QA, security check, UAT, tag) are on [Change Management Process](../Getting-Started/Change-Management-Process.md).

## Before the release branch is merged to `dev`

- [ ] Branch rules respected: the round's integration branch is merged to `dev` only when the owner says so; `main` is untouched until the owner decides.
- [ ] CI green on the pull request: build with warnings as errors, OpenAPI drift check, format, unit and architecture tests, integration and schema tests, frontend lint, format, unit tests, client drift check, production build ([Continuous Integration](../Getting-Started/Continuous-Integration.md)).
- [ ] Weekly or on-demand workflows green: e2e (label the pull request `e2e` to run it), nightly full backend suite and dependency audits, CodeQL.
- [ ] No duplicate or edited SQL scripts; the next script number is free ([How to Change the Schema](../Database/How-to-Change-the-Schema.md)).
- [ ] `contracts/openapi/v1.json` and `frontend/src/app/api/generated` are regenerated and committed.
- [ ] Initial bundle under 700 kB; axe clean on changed pages; screenshots at 1366x768 and 1920x1080 exist for UI changes.
- [ ] Docs updated: architecture decisions, runbook (new configuration keys, logins, operations), design guidelines, and the wiki ([How to Keep the Wiki Up to Date](../Reference/How-to-Keep-the-Wiki-Up-to-Date.md)).
- [ ] New configuration keys added to `deploy/appsettings.Production.template.json` and [Configuration Reference](../Operations/Configuration-Reference.md).
- [ ] `Dev` authentication guard untouched; production uses Windows authentication.

## Build the package

1. Run the manual `publish` workflow, or locally `deploy/publish.sh <out> win-x64` (Linux or macOS) or `deploy/publish.ps1` (Windows). The workflow checks the package contents and uploads it as an artifact named `matterflow-publish-<sha>`.
2. The package is framework-dependent: the server needs the .NET 10 Hosting Bundle.

## Deploy (summary of runbook section 7)

1. Announce a window. Take a full database backup (the rollback point).
2. Unzip the package to a staging folder; copy the live `appsettings.Production.json` into it (it is not in the package).
3. Run `dotnet MatterFlow.Api.dll --migrate-only` as the migrator account with `ASPNETCORE_ENVIRONMENT=Production`; stop if the exit code is not 0.
4. Stop the site, swap folders (keep the previous one), start the site.
5. Verify `/health/ready`, sign in, open the Dashboard and one task. Keep the previous folder and the backup for at least a week.
6. Rollback: with no schema change, swap folders back; with schema scripts applied, fix forward or restore the backup (old binaries refuse to start against scripts they do not contain).

## First deployment extras (runbook sections 5, 9, 11, 12)

- [ ] IIS site, application pool identity, Windows authentication on, anonymous off, `AllowedHosts` set to the real host names, site in the Intranet zone.
- [ ] Database roles and members (`mf_app`, `mf_migrator`) and the audit table permissions; the API refuses to start if its identity can alter the audit table.
- [ ] `READ_COMMITTED_SNAPSHOT` set by the DBA (recommended).
- [ ] `deploy/configure-iis.ps1` run so the notification scheduler keeps running.
- [ ] Report login created and the startup check green (or reports left off).
- [ ] `Features:SensitiveMatterAccess` decided: run `tools/db/sensitive-matters-report.sql` first, then switch on (runbook section 12).
- [ ] `Bootstrap:SystemAdmins` set (`ke\kekim`); first sign-in grants System Admin once.
- [ ] Backup plan and a restore drill scheduled (runbook section 8).

## Related pages

- [Deployment and Hosting](../Architecture/Deployment-and-Hosting.md)
- [Runbook](../Operations/Runbook.md)
- [Configuration Reference](../Operations/Configuration-Reference.md)

Last verified against commit 5336251.
