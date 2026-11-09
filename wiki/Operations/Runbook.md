# Runbook

[[_TOC_]]

**What this page is for.** A map of `docs/runbook.md` (the operations guide, about 470 lines) so you can jump to the right section. The runbook is the source of truth for install, upgrade, backup and support; this page only summarises and points. MatterFlow has not been deployed yet; the rehearsal on a domain-joined IIS server is still open (runbook section 9).

| Section of `docs/runbook.md` | What it covers | Wiki page |
|---|---|---|
| 1 Target topology | One IIS site, in-process hosting, SQL Server, optional AD lookup | [Deployment and Hosting](../Architecture/Deployment-and-Hosting.md) |
| 2 Configuration | Every production setting with defaults | [Configuration Reference](Configuration-Reference.md) |
| 3 Database and migrations | Roles, schema runner, `READ_COMMITTED_SNAPSHOT` | [Database Overview](../Database/Overview.md) |
| 4 First login behaviour | Just-in-time provisioning, Access Pending, bootstrap admin | [Authentication and Authorization](../Architecture/Authentication-and-Authorization.md) |
| 5 Install on Windows Server with IIS | Step by step install, Hosting Bundle, app pool, authentication, `configure-iis.ps1` | [Deployment and Hosting](../Architecture/Deployment-and-Hosting.md) |
| 6 Health checks and monitoring | `/health/live`, `/health/ready`, scheduler health | [Troubleshooting](Troubleshooting.md) |
| 7 Upgrade and rollback | `--migrate-only`, upgrade procedure, rollback rules | [Release Checklist](../How-To/Release-Checklist.md) |
| 8 Backup and restore | Proposed policy, restore drills | [Release Checklist](../How-To/Release-Checklist.md) |
| 9 What the owner must verify on the real server | Open items before go-live | [Release Checklist](../How-To/Release-Checklist.md) |
| 10 Troubleshooting | Site fails to start, 500.19, 400 invalid hostname, `/health/ready` 503, display names | [Troubleshooting](Troubleshooting.md) |
| 11 Reports: the read-only report login | Login creation, the one-time `DENY EXECUTE` step in `master` for the `xp_` procedures (`xp_dirtree` and others, issue #1292), startup check states and the warning | [Reports Module](../Architecture/Reports-Module.md) |
| 12 Sensitive matters: switching on the rule | Go-live steps for `Features:SensitiveMatterAccess` | [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md) |
| 13 Project Manager experience | What support should know (My Matters) | [Feature Map](../Features/Feature-Map.md) |
| 14 and 15 PM v2 | Assets disposition and size, filter index, On hold reasons, At risk, export, saved views | [Feature Map](../Features/Feature-Map.md) |
| 16 Application name and icon | Branding settings | [Settings Catalogue](../Reference/Settings-Catalogue.md) |
| 17 Matter detail: Productions, Notes, AI switch | Operations notes for epic #1001 | [Module Guide](../Backend/Module-Guide.md) |
| 18 Landing pages | Set a role's landing page, personal choice, "I land on the wrong page" | [Authentication and Authorization](../Architecture/Authentication-and-Authorization.md) |

Other operational documents: `docs/frontend-bundle.md` (bundle size), `docs/qa/performance-round-1.md` and `docs/qa/sensitive-matters-performance.md` (performance), `tools/perf/README.md` (load test tools), `docs/qa/risk-register.md`, `docs/qa/security-review-1.md` and `security-review-2.md` (with resolutions).

## Related pages

- [Configuration Reference](Configuration-Reference.md)
- [Troubleshooting](Troubleshooting.md)
- [Documentation Map](../Reference/Documentation-Map.md)

Last verified against commit a8f9659.
