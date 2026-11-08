# Branching and Workflow

[[_TOC_]]

**What this page is for.** The rules for branches, commit messages and schema changes. Rules come from `CLAUDE.md`, `db/scripts/README.md` and `docs/ux/ui-update/README.md`; where a rule here is a convention seen in recent history rather than a written rule, the page says so. How a request becomes a released, tagged version (roles, pull request gates, full QA, UAT) is on [Change Management Process](Change-Management-Process.md).

## Branches

| Branch | Role |
|---|---|
| `dev` | The main integration branch (`CLAUDE.md`). Feature and fix branches start from `dev` and come back to it through a pull request. CI runs on pushes to `dev` and on every pull request. |
| `uat` | Planned. Receives only a commit that passed full QA and the security check on `dev`, for user acceptance testing. It does not exist yet (there is no UAT environment yet). |
| `main` | The released line. Today untouched by feature work. After UAT is accepted, the tested commit is merged here and tagged with the version ([Change Management Process](Change-Management-Process.md)). |
| `feature/<id>-name`, `fix/<id>-name` | Proposed naming for a developer's working branch, branched from `dev`. |
| `ui-update-2` | The active integration branch of the UI round (at the time of writing). Agents push with `git push origin HEAD:ui-update-2`. |
| `dependabot/*` | Automated dependency updates (`.github/dependabot.yml`). |

Rules of the UI-update rounds (`docs/ux/ui-update/README.md`):

- Work on the round's branch, not on `dev`. A round's branch is merged to `dev` only when the owner says so.
- Use one git worktree per agent or task. Do not overwrite another agent's files.
- Pull before you push (`git pull --no-rebase origin <branch>`). Never force-push. Never use `git stash` on a shared checkout.
- After merging or pulling, regenerate the OpenAPI document and the NSwag client from code; never merge those two files by hand.
- SQL script numbers are allocated by one person per round (the next free number); scripts stay immutable once pushed.

**Screenshots and the `design-evidence` branch.** Do not commit screenshots to `dev`, `main` or a feature branch. Screenshot and measurement evidence for UI work goes to the orphan branch `design-evidence` (never merged), in `evidence/<yyyy-mm-dd>-<issue-or-review>/`, at most 15 compressed images per issue (JPEG q82 or optimised PNG, 1366 or 1920 wide, about 150 KB each). Link them from the issue comment with the GitHub blob URL. Older screenshot rounds were removed from the tree and are kept in the branch `archive/docs-screenshots-2026-11`; restore a folder with `git checkout archive/docs-screenshots-2026-11 -- docs/ux/<folder>`.

## Commit messages

Two forms are used.

**UI changes** (owner request, `CLAUDE.md` and `docs/ux/ui-update/issue-template.md`):

```
UI2 #<issue> <short what changed>

- <Main navigation page> > <Tab or area>: <what changed, in plain words>
- Shared <Component>: <what changed>; visible on <pages>

Co-Authored-By: ...
Claude-Session: ...
```

One bullet per main navigation page (and tab or component), in the app's own menu and tab names, so the owner knows what to open and check. For a shared change, list the shared component first, then the pages where it shows. Plain English, no file lists. The ID prefix differs by round (`UI2 #1234` on `ui-update-2`, `WPx DB-16 ...` on `dev`).

**Other changes**: a short first line with the work package or issue id, for example `WPx US-13 Users: unassigned tasks open in a right side panel (#1105)`. This is the pattern in recent `dev` history; it is a convention, not a written rule (unverified as a rule).

**Wiki changes**: first line `Wiki: <what>`, a blank line, one bullet per page or section changed.

## Schema changes: no EF migrations, immutable scripts

- The schema is `db/scripts/00-baseline.sql` plus numbered SQL scripts after it (from 67); it is changed only by adding a numbered SQL script in `db/scripts/`. There are no EF migrations. The old chain 01 to 66 is archived in `db/scripts/archive/` (issue #1307).
- A merged script is never edited (a checksum guard enforces this at startup). Fix forward with a new script.
- The owner's note (`CLAUDE.md`): the app is not deployed, so a data backfill for old rows is rarely needed, but the old scripts were squashed into one baseline and scripts after it stay immutable. The baseline itself is edited only together with a rebuild of every demo and test database (`npm run db:reset`) until the first real deployment.
- Details: [How to Change the Schema](../Database/How-to-Change-the-Schema.md).

## Other rules to respect

- **Module boundaries** are enforced by tests: see [Backend Modules](../Architecture/Backend-Modules.md).
- **NuGet versions** live only in `backend/Directory.Packages.props`.
- **API changes** must keep `contracts/openapi/v1.json` and the generated client in sync.
- **Permissions** come from `contracts/permissions.json`; keep backend and frontend in step.
- **Shortcuts**: new keyboard shortcuts go in `frontend/src/app/shared/layout/shortcut-registry.ts` with the handler, but no new or changed shortcuts are allowed in the current phase (owner decision, backlog issue #420).
- **Auth**: the `Dev` provider is for Development and Test only.
- **UI**: follow `docs/ux/design-guidelines.md` for every screen you touch; see [UI Standard](../Frontend/UI-Standard.md).
- **Desktop only** (owner, 2026-11-04): review at 1366x768 and 1920x1080; no phone or tablet layouts.
- **Wiki**: update the matching wiki page in the same change, see [How to Keep the Wiki Up to Date](../Reference/How-to-Keep-the-Wiki-Up-to-Date.md).

## Related pages

- [Continuous Integration](Continuous-Integration.md)
- [Add a Feature End to End](../How-To/Add-a-Feature-End-to-End.md)
- [Release Checklist](../How-To/Release-Checklist.md)

Last verified against commit b03d0ac.
