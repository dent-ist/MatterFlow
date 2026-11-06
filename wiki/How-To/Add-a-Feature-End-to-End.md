# Add a Feature End to End

[[_TOC_]]

**What this page is for.** One checklist that takes a feature from the database to the screen and the wiki, in the order that avoids rework. It links to the detailed recipes. Use the [Feature Map](../Features/Feature-Map.md) to see an existing feature of the same shape and copy its layout.

## 0. Before you start

- Read the issue and the relevant design document (`docs/architecture.md`, `docs/requirements/decisions-addendum.md`, `docs/ux/...`). Owner decisions override the baseline.
- Check `CLAUDE.md`: no new keyboard shortcuts in the current phase; desktop only; UI standard applies.
- Work on the integration branch of the round with your own worktree ([Branching and Workflow](../Getting-Started/Branching-and-Workflow.md)).

## 1. Database

- [ ] Write the numbered script (next free number; one logical change) ([How to Change the Schema](../Database/How-to-Change-the-Schema.md)).
- [ ] Classify new tables in `db/report-access.json` and add GRANT or DENY for `mf_report_reader`.
- [ ] New permission? Insert and grant it in the same script (pattern scripts 34, 46, 60).

## 2. Backend

- [ ] Entity in `Domain/`, EF configuration in `Infrastructure/`, `[Audited]` where useful.
- [ ] Application service returning `Result<T>`; validation; `rowVersion`; audit events ([How to Add an Audit Event](../Backend/How-to-Add-an-Audit-Event.md)).
- [ ] Sensitive matter rule if the data belongs to a matter ([Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md)).
- [ ] Controller with a policy on every action ([How to Add an Endpoint](../Backend/How-to-Add-an-Endpoint.md)).
- [ ] Permission added in JSON, C#, TypeScript, starter roles and tests ([How to Add a Permission](../Backend/How-to-Add-a-Permission.md)).
- [ ] Setting needed? ([How to Add a Setting](../Backend/How-to-Add-a-Setting.md)).
- [ ] New module only if truly needed ([How to Add a Module](../Backend/How-to-Add-a-Module.md)).
- [ ] Unit, schema and integration tests ([Testing the Backend](../Backend/Testing-the-Backend.md)).

## 3. Contract

- [ ] `dotnet build -warnaserror` (rewrites `contracts/openapi/v1.json`), then `npm run api:generate`; commit both ([API Contracts](../Architecture/API-Contracts.md)).

## 4. Frontend

- [ ] Page, route, guard, menu item ([How to Add a Page](../Frontend/How-to-Add-a-Page.md)).
- [ ] Shared components only; Title Case and formats; desktop 1366x768 and 1920x1080 ([UI Standard](../Frontend/UI-Standard.md)).
- [ ] Remembered state and grid columns if the page has them ([Grids and Column Preferences](../Frontend/Grids-and-Column-Preferences.md)).
- [ ] Unit specs, guard specs, Playwright spec with axe ([Testing the Frontend](../Frontend/Testing-the-Frontend.md)).
- [ ] Update `docs/ux/design-guidelines.md` if you added or changed a pattern.

## 5. Checks

- [ ] Backend: `dotnet build -warnaserror`, unit and architecture tests, `dotnet format --verify-no-changes`, integration tests for what you touched.
- [ ] Frontend: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`.
- [ ] Screenshots before and after at both sizes for UI changes; say what you did not check.

## 6. Docs and wiki

- [ ] Update the wiki pages listed in [How to Keep the Wiki Up to Date](../Reference/How-to-Keep-the-Wiki-Up-to-Date.md): ER diagrams and Table Reference for schema, Module Guide, Routing, Permission Catalogue, Settings Catalogue, Feature Map.
- [ ] `docs/architecture.md` if a design decision changed; `docs/runbook.md` if operations change (new configuration key, new login).
- [ ] Commit messages in the right format (UI format for UI work).

## Related pages

- [Fix a Bug](Fix-a-Bug.md)
- [Release Checklist](Release-Checklist.md)
- [Feature Map](../Features/Feature-Map.md)

Last verified against commit 5336251.
