# Fix a Bug

[[_TOC_]]

**What this page is for.** A method for going from a symptom on a screen to the line of code, and a checklist for fixing it safely. The chain is always: page, route, component, API call, controller, service, table.

## 1. Find the screen's code

1. Note the address in the browser. Look it up in [Routing and Navigation](../Frontend/Routing-and-Navigation.md) to get the feature folder and the page component. If you only know the menu name, use the menu table on the same page.
2. Open the page component (`frontend/src/app/features/<area>/pages/...-page.ts`). Components are usually standalone with inline templates; search for the visible text (the label, button or heading) to find the exact element. Use the exact Title Case string ([Find Things](Find-Things.md)).
3. Find the API call: the component or its facade injects a generated client (`ClientsClient`, `TasksClient`, ...). The method name is the controller action name (for example `ListTasks`).
4. In the browser developer tools, Network tab, look at the request: URL, status, response body. An error body has a `code` and `traceId`; the code names the rule that fired (stable codes are in `backend/src/MatterFlow.SharedKernel/Results/ErrorCodes.cs`).

## 2. Find the backend code

1. From the URL (`/api/v1/<resource>`), find the controller: [Feature Map](../Features/Feature-Map.md) has a controller index, or search `Route("api/v1/<resource>"` under `backend/src`.
2. The action calls an application service (`Application/` folder of the same module). Business rules are there (validation, status rules in `Domain/`).
3. The service reads or writes through `DbContext` entities (`Domain/` and `Infrastructure/` configurations map them to tables). The table and column names are in [Table Reference](../Database/Table-Reference.md).
4. For a wrong list or count: lists are in `WorkViews` (`Application/Queries`), search in `Search`; check the visibility rule and the filters.
5. For a permission problem (403 or a missing button): the policy on the action, the permission in the role, the `*mfHasPermission` or guard in the frontend ([Authentication and Authorization](../Architecture/Authentication-and-Authorization.md)). Roles are data: check the person's roles in Administration > Users.
6. For a "not found" on something that exists: the Sensitive matter rule answers 404 for hidden matters ([Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md)).
7. For stale data or "someone else changed this": `rowVersion` 409 ([Request Lifecycle](../Architecture/Request-Lifecycle.md)).

## 3. Reproduce

- Start the demo stack ([Local Setup](../Getting-Started/Local-Setup.md)) and seed data (`npm run seed:demo`). Sign in as the right persona ([Demo Data and Personas](../Operations/Demo-Data-and-Personas.md)): many bugs only show for a role.
- Read the API directly: Swagger (`http://localhost:5080/swagger`, Development) or `curl -H 'X-Dev-User: KE\kekim' -H 'X-MatterFlow-Client: web' ...` (the client header is needed for POST, PUT, DELETE).
- Inspect the data read-only with `sqlcmd` in the SQL container.
- Write a failing test first: a unit test for a pure rule, an integration test for an endpoint, a Vitest spec for a component, a Playwright spec for a flow.

## 4. Fix and verify

- Fix the cause, not the symptom; keep module boundaries (a fix that needs another module's data goes through its Contracts).
- Never edit an applied SQL script: fix forward with a new script.
- Run the checks of the area ([Commands](../Getting-Started/Commands.md)); for UI fixes follow the UI standard and take screenshots.
- If the bug was a rule that the docs describe differently, fix the docs or the wiki page too.
- Commit message in the right format ([Branching and Workflow](../Getting-Started/Branching-and-Workflow.md)).

## Quick reference: symptom to place

| Symptom | Look at |
|---|---|
| Wrong number on the Dashboard | `WorkViews/Application/Queries` (`DashboardService`, `CapacityService`, `CalendarService`), the cache (`Dashboard:CacheSeconds`), the scope |
| A list shows too many or too few rows | The filter definitions (`shared/filters`), the query parameters sent, `TaskQueueQuery`/`TaskQueueRules`, the visibility rule |
| Wrong overdue time | `X-Time-Zone` header, `Firm:TimeZoneId`, `TaskDue`/`DueDates` |
| Save fails with 409 | `rowVersion` not sent or stale; another user saved |
| Form field missing or wrong | The published form version, the rule evaluator (`form-engine` and `FormEvaluator`) |
| Notification not sent | `Notifications` producers, preference switches, the scheduler (app pool must stay running), visibility |
| Audit entry missing | Entity not `[Audited]` or no explicit event; scope columns |
| Startup fails | Migration error, checksum, duplicate number, audit guard: [Troubleshooting](../Operations/Troubleshooting.md) |

## Related pages

- [Find Things](Find-Things.md)
- [Troubleshooting](../Operations/Troubleshooting.md)
- [Testing the Backend](../Backend/Testing-the-Backend.md)

Last verified against commit 5336251.
