# Demo Data and Personas

[[_TOC_]]

**What this page is for.** How to fill a local MatterFlow with realistic demo data, and which accounts to sign in as to see the app the way a Director, Pod Lead, Technician, Project Manager, System Admin or new hire sees it. Full text and every option: `README.md` ("Demo data") and `docs/ux/ui-update/stack-howto.md` (the demo stack of the UI update). All data in this repository is demo data; nothing is deployed.

## Load demo data

With the API running (Dev authentication) run from the repository root:

```
npm run seed:demo                                  # about 3 minutes, default numbers
npm run seed:demo -- --tasks 50 --seed 7           # options after the double dash
npm run seed:demo -- --dry-run                     # plan only, creates nothing
node tools/seed-demo/seed-demo.mjs --aged --seed 7 # moves dates back so At risk and On hold for days show (Docker needed)
```

- The seeder (`tools/seed-demo/seed-demo.mjs`, helpers in `tools/seed-demo/lib/`) talks to the **real HTTP API** as the Dev admin `KE\kekim` and as the test users, so every record passes the normal validation. Nothing is written to the database directly, except `--aged`, which runs `UPDATE` statements in the SQL container (demo tasks only).
- It is safe to run again: users, pods, clients, matters, projects and assets are created only when missing; tasks are only added when the Demo matters have none (`--tasks N` adds another tagged batch).
- Options: `--api`, `--admin`, `--users` (default 50), `--tasks` (default 200), `--seed` (same seed gives the same plan), `--tag`, `--concurrency` (3), `--aged`, `--sql-container`, `--sql-password`, `--dry-run`; the same as environment variables `SEED_*`.

### What it creates

| Area | Content |
|---|---|
| Users | 50 active test users `Test User 01..50` (`KE\testuser01..`), roles: 31 Data Technician, 11 Data Scientist, 4 Pod Lead, 3 Project Manager, 1 Director (Test User 02); one or two pods each; four out of office |
| Pods | If none exist, four `Demo ... Pod` pods |
| Organization | 5 clients (numbers 90001 to 90005), 12 matters (80001 to 80012), 4 projects, 60 assets |
| Sensitive matters | Two of the 12 matters are Sensitive: one has a Project Manager, one has none. The run ends by listing accounts that see all, what they manage, only their assigned tasks, or none. The rule works only with `Features__SensitiveMatterAccess=true` |
| Project Manager personas | Test User 35 manages exactly one matter; Test User 19 manages three; their matters hold an overdue, an unassigned, an On hold and (with `--aged`) an At risk task |
| Tasks | 200 by default, spread across task types, statuses (about 20 percent New, 37 percent In Progress, 10 percent On Hold, 23 percent Completed, 8 percent Cancelled), about 27 percent unassigned, overdue and due soon mixes, request forms and workflow steps filled, comments |

Limitations: completed tasks are completed when the seeder runs, so "Completed" dashboard figures fall on today; the API's per-user write limit (120 per minute) is respected by pacing.

## Dev accounts and personas

The Dev provider signs in as `Auth__Dev__DefaultUser`, or as the request header `X-Dev-User` (Playwright sets it through `extraHTTPHeaders`). Switching persona in the browser means restarting the API with another default user (`npm run start:user1` to `start:user3`, or `stack-start.sh <account>` in the UI-update stack) or using a tool that sends the header.

| Persona | Account | What they see |
|---|---|---|
| System Admin | `KE\kekim` | Everything; the bootstrap admin of `npm start` |
| Director | `KE\testuser02` | Sees every Sensitive matter; Administration menu shows Users and Audit Logs only |
| Pod Lead | `KE\testuser06` | Dashboard (no Breakdowns or Trends), Pod Work |
| Technician | `KE\testuser01` | My Work and Task Queue; no Dashboard tabs except the unassigned queue; sees no Sensitive matters |
| Project Manager | `KE\testuser35` | Manages one matter; the persona with My Matters |
| Project Manager (three matters) | `KE\testuser19` | Manages three matters (out of office) |
| New hire | `KE\newhire` | Provisioned on first request with no role: Access Pending |
| Plain Dev users | `KE\user1` to `KE\user10` | Role Data Technician, seeded from `appsettings.Development.json` (`Dev:Users`) |

The starter roles and what they hold are in [Authentication and Authorization](../Architecture/Authentication-and-Authorization.md) (`StarterRoles.cs`); each permission is in [Permission Catalogue](../Reference/Permission-Catalogue.md).

## Walking skeleton (first login flow)

1. Sign in as `KE\newhire`: Access Pending.
2. Sign in as `KE\kekim`: Administration > Users shows `KE\newhire` under Pending access.
3. Open the user, tick a role, Save. Sign in as `KE\newhire` again: the permitted screens appear.

Covered by `backend/tests/MatterFlow.IntegrationTests/Identity/WalkingSkeletonTests.cs`.

## Test personas (automated)

End-to-end tests create their own personas with a known permission set through the admin API (`frontend/e2e/support/personas.ts`); integration tests use `SensitiveUniverse` (six personas for the Sensitive matter walk) and `TaskHarness`. See [Testing the Frontend](../Frontend/Testing-the-Frontend.md) and [Testing the Backend](../Backend/Testing-the-Backend.md).

## Reset

`npm run db:reset` deletes the database volume; start the app again (it rebuilds the schema) and re-run the seeder. Take care if other people or agents share the SQL container.

## Related pages

- [Local Setup](../Getting-Started/Local-Setup.md)
- [Troubleshooting](Troubleshooting.md)
- [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md)

Last verified against commit 6c2e523.
