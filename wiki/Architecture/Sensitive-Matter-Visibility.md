# Sensitive Matter Visibility

[[_TOC_]]

**What this page is for.** The rule that hides a Sensitive matter from people who should not see it, where it is implemented, how it is tested, and what you must do so that a new endpoint or query complies. Design and decisions: `docs/architecture.md` section 6.8, `docs/ux/sensitive-matters/README.md` (68-row read-path inventory and test plan), decisions addendum section AJ, go-live notes `docs/runbook.md` section 12.

## The rule

A matter flagged `IsSensitive` is visible only to:

- its Primary and Secondary project manager,
- holders of `Matter.ViewSensitive` (the System Admin counts as a holder),
- and, for their own tasks only, the people a task on it is currently assigned to.

Everyone else gets "nothing": the matter is absent from every list, count, search, notification, audit view, picker and export, and a direct address answers 404 identical to a missing id. The rule applies only when the go-live switch `Features:SensitiveMatterAccess` is `true` (default `false`; read once at start).

## Where it lives

| Piece | Location |
|---|---|
| The port `IMatterVisibility` (the only place the rule is written) | `backend/src/MatterFlow.SharedKernel/Visibility/IMatterVisibility.cs`; implemented by `MatterVisibility` in `backend/src/Modules/MatterFlow.Identity/Access/MatterVisibility.cs` |
| C# predicates (expression trees) | `SharedKernel/Visibility/VisibilityPredicates.cs`: `VisibleMatters`, `VisibleTasks`, `WhereMatterVisible`, `WhereTaskVisibleBy`; single-record gates `CanSeeMatterAsync`, `CanSeeTaskAsync`; the generic 404 |
| SQL twin for raw SQL readers | Three inline functions `dbo.fnMatterVisible`, `dbo.fnTaskVisible`, `dbo.fnAssetVisible` (script 35), denied to `mf_report_reader` |
| "Managed by me" scope | `IManagedMatterScope` (`SharedKernel/Visibility/ManagedMatterScope.cs`, implemented in Identity), passes through `IMatterVisibility` |
| Per-request preparation | `ViewerPreparationFilter` and `[PreparesViewer]`: loads the sensitive matters the caller manages as short id lists |
| Task copy of the flag | `dbo.Task.IsMatterSensitive` kept in step by triggers (script 37) for speed |
| Audit scope | `dbo.AuditEvent.IsSensitiveScope` (script 36): history stays restricted after un-marking |
| Row sources for other modules | `IMatterAccessSource` and `ITaskAccessSource` rows; module boundaries are unchanged |
| Sensitive flag and managers | `dbo.Matter.IsSensitive`, `PrimaryManagerId`, `SecondaryManagerId` (scripts 28 and 34) |

There is no EF global query filter on purpose (decided against; architecture 6.8). The rule is explicit in every read.

## Rules for handlers

1. Load through the visible source first, then validate. A hidden id in a request body is the same "not found" validation as a missing one.
2. Counts come from the visible set, never from a subtraction.
3. Background work never runs as "see all": notification producers and the scheduler check each recipient with `ForAsync(recipient)`; a notification is also filtered when read.
4. Caches (Dashboard, My Matters) carry a visibility stamp in their key.
5. The API tells the screen what it may open (`canOpen: false`, `matterCanOpen: false`); the frontend never decides visibility itself and never stores matter data in `localStorage`.
6. Marking a matter Sensitive can remove the caller's own access: `PUT /matters/{id}` answers 409 `SENSITIVE_CONFIRMATION_REQUIRED` and the screen repeats with `confirmLossOfAccess: true`. Creating a sensitive matter without a manager and without `Matter.ViewSensitive` is 400 `SENSITIVE_NEEDS_MANAGER`.
7. Reports are not covered by the rule (option A: they read as the report login, outside the port, for trusted roles only; addendum AI item 6, issue #808). One exception goes the other way: the report parameter lookup `GET /reports/{id}/lookups/{parameter}` (owner decision 13) never lists or resolves a sensitive matter for anybody, so a person who may only run reports learns nothing about the existence of one. It is classified `List` and walked by the persona suite. A report author who needs a sensitive matter filters by typing its number in a text parameter.

## How to make a new endpoint compliant

1. Decide which kind it is: a resource by id, a list, an aggregate, a write, or neutral (no matter data).
2. Read data through the shared visible sources of your module (for example `TaskAccess.Visible`, `AssetAccess.Visible`, `WhereMatterRowVisible`) or `IMatterVisibility`. Do not call `Set<Matter>()`, `Set<WorkTask>()`, `Set<Project>()` or `Set<Asset>()` directly.
3. **Classify the endpoint** in `backend/tests/MatterFlow.IntegrationTests/Security/SensitiveAccessCatalog.cs`. The key is the HTTP method and the exact route pattern, for example `"GET api/v1/notes/{noteId:int}"`. Give the kind (`Gated`, `List`, `Aggregate`, `Write`, `Neutral`, `Open`), the kind of id (`IdKind`), a reason, and the calls the persona walk sends (placeholders `{matter}`, `{task}`, `{project}`, `{asset}`, `{client}`, `{user}`). `SensitiveEndpointCatalogTests` fails when an endpoint is unclassified or the catalog names one that no longer exists.
4. If you added a source file that touches the matter, task, project or asset sets (or raw SQL on those tables, or the audit and notification tables), add it with a reason to the allow-lists in `backend/tests/MatterFlow.ArchitectureTests/VisibilitySourceRulesTests.cs` after review.
5. Run the persona walk (needs Docker): `dotnet test tests/MatterFlow.IntegrationTests --filter "FullyQualifiedName~Sensitive"`.

## The tests

| Test | What it proves |
|---|---|
| `SensitiveEndpointCatalogTests` | Every endpoint is classified; no stale entries |
| `SensitivePersonaWalkTests` / `PersonaWalk` | Sends every catalogued GET as six personas and compares a hidden id with a missing id byte for byte; sweeps bodies and headers for the sentinel text of every matter the persona may not see. Personas: P1 primary manager, P2 secondary manager, P3 task assignee, P4 holder of `Matter.ViewSensitive`, P5 unrelated user, P6a unauthenticated, P6b no permission. It runs with the switch on and off, each against its own matrix |
| `SensitiveMutationTests` | Revocation takes effect immediately; a deliberately broken rule is caught (the walk is not vacuous) |
| `MatterContentApiTests`, `SensitivePmV2Tests` | Productions, Notes and PM v2 endpoints |
| `VisibilitySourceRulesTests` (architecture) | No unreviewed direct reads or raw SQL; no global query filters |
| Playwright `sensitive-*.spec.ts` | Screen behaviour; needs the switch on (`frontend/e2e/run-local.sh` sets it for these specs) |

## Related pages

- [Authentication and Authorization](Authentication-and-Authorization.md)
- [How to Add an Endpoint](../Backend/How-to-Add-an-Endpoint.md)
- [Testing the Backend](../Backend/Testing-the-Backend.md)

Last verified against commit ba461d2.
