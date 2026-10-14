# Security review 2

Scope: everything added to `dev` after security review 1 (HEAD `d6c0570`, binaries built 2026-10-14 16:21): the Task module (`MatterFlow.WorkManagement`), queues and dashboard (`MatterFlow.WorkViews`), global and advanced search (`MatterFlow.Search`, `Perm:A|B` policies in Identity), the audit browser, production hosting (`Hosting/`), the users lookup, the intake limits, and the matching Angular features. Round 1 is `security-review-1.md` / `security-review-1-resolutions.md`.

Method: code reading with file:line evidence, throwaway .NET programs under the scratchpad (not in the repository) that run the real `CommentHtml` source against HtmlSanitizer 9.2.1039 / AngleSharp 1.7.2, the named regression tests, `dotnet list package --vulnerable --include-transitive`, `npm audit`. No source file was changed. Nothing was run against a browser or a real IIS site; items that depend on those are marked "needs confirmation".

## 1. Executive summary

The Task, queue, search and audit code is in good shape on the questions that usually go wrong. Every new action has a policy that matches the permission catalog, ids are always scoped to their parent (comment to task, link to task, step to workflow instance, asset and project to the Task's Matter), the Task's Matter/Type/Workflow are immutable in the API and in the database (`TR_Task_Immutable`), every Task write checks a row version under an `UPDLOCK` row lock, SQL is parameterized everywhere, sort fields are whitelisted, and the comment sanitizer survived a 58-payload XSS battery with no live content and a stable second pass. Angular never bypasses its sanitizer. Dependency scans are clean. All round-1 High/Medium fixes still hold.

The serious problem is the comment sanitizer's availability, not its XSS safety:

1. **A comment containing a few hundred nested `<pre>` (or `<listing>`) tags overflows the stack inside AngleSharp and kills the whole API process.** A stack overflow cannot be caught. Any user with `Task.Comment` (every starter role) can do it with one request of 1.5 to 13 KB.
2. **A 19.8 KB comment of nested `<div>` costs 67 seconds of one CPU core** (cubic time in the block-wrapper rewrite that `CommentHtml` adds itself). The work is synchronous and ignores cancellation. A handful of concurrent requests pins the server.
3. Only the intake endpoints have rate limiting, so nothing slows either attack, or the expensive search, audit and dashboard queries.

Everything else is Medium or below: carried-over unvalidated `ASSET_REF`/`USER_REF` values (SEC-12), a server that does not enforce `Dashboard.ViewDepartment`, an activity feed that prints old and new values in the sentence that is meant to be value-free, editable "non-deletable" cancel reasons, and a few robustness items.

Counts: 1 Critical, 1 High, 2 Medium, 7 Low, 3 Info.

## 2. Findings

| ID | Severity | Where | Summary |
|---|---|---|---|
| SEC2-01 | Critical | `WorkManagement/Domain/CommentHtml.cs:100` (via `TaskCommentService.cs:223`) | Nested `<pre>`/`<listing>` in a comment overflows the stack in AngleSharp and crashes the API process |
| SEC2-02 | High | `CommentHtml.cs:109-124` | Cubic CPU in the block-wrapper rewrite: 19.8 KB of nested `<div>` takes 67 s |
| SEC2-03 | Medium | `Intake/Api/IntakeRateLimiting.cs`, `Program.cs:109` | No rate limiting or cost cap on comment writes, search, audit search, dashboard |
| SEC2-04 | Medium | `Configuration/Domain/Forms/Rules/FormValueRules.cs:90,97` | `ASSET_REF`/`USER_REF` values are never checked (SEC-12 carried over; the Task module that was to fix it now exists) |
| SEC2-05 | Low | `WorkViews/Api/DashboardController.cs:22` | `Dashboard.ViewDepartment` is not enforced by the server |
| SEC2-06 | Low | `TaskActivityNarrator.cs:118-131`, `AuditEventsController.cs:75-76` | Activity sentence repeats old/new values without `Audit.View`; secret masking not applied outside the audit browser |
| SEC2-07 | Low | `TaskCommentService.cs:92-125` | Cancel / On Hold reason comments can be edited by their author |
| SEC2-08 | Low | `TaskLifecycleService.cs:179` | Bulk completion confirms a stale dialog: no workflow row version |
| SEC2-09 | Low | `TaskQueueService.cs:294,320`, `AuditSearchService.cs:126` | `createdTo`/`completedTo`/`to` = `9999-12-31` gives HTTP 500 |
| SEC2-10 | Low | `TaskCommentService.cs:25,37`, `:73-85` | Comment thread and revision list are unbounded; one GET can return about 20 MB |
| SEC2-11 | Low | `TaskAssetService.cs:26-38`, `SearchService.cs:264-275` | Read models return data of types the caller may not hold the View permission for |
| SEC2-12 | Info | `CommentHtml.cs:67,86` | Comment links can be visually deceptive (`https://google.com@evil.com`, bidi characters) |
| SEC2-13 | Info | `ReadinessHealthCheck.cs:64`, `IntakeController.cs:79-81` | `/health/ready` does real work per call; JSON paste endpoint inherits the 12 MB body ceiling |
| SEC2-14 | Info | `UsersLookupController.cs:35` | Users lookup lists Access Pending users and tasks can be assigned to them |

### SEC2-01 Critical: stack overflow in the comment sanitizer terminates the process

- **Evidence.** `CommentHtml.StripDroppedElements` parses the raw body with `body.InnerHtml = html` (`CommentHtml.cs:100`) before any size or depth rule other than "at most 20,000 characters" (`TaskCommentService.cs:218-223`). AngleSharp's tree builder recurses once per nested `<pre>`/`<listing>` (the "prevent new line" step, `HtmlDomBuilder.PreventNewLine` -> `InBodyStartTag` -> `InBody` -> `Home`). Reproduction with the real source file (`Sanitize` called on a thread-pool thread):

  | Input | Stack | Result |
  |---|---|---|
  | `<pre>` x 1,600 (8 KB) | 8 MB | ok |
  | `<pre>` x 2,500 (12.5 KB) | 8 MB (default Linux thread-pool) | `Stack overflow.`, exit 134 |
  | `<pre>` x 4,000 (20 KB) | 8 MB | `Stack overflow.`, exit 134 |
  | `<pre>` x 250 / x 300 | 1 MB | ok / `Stack overflow.` |
  | `<listing>` x 250 / x 300 | 1 MB | ok / `Stack overflow.` |

  AngleSharp 1.8.4 (newest stable) overflows at the same inputs, so a package bump does not fix it. A .NET stack overflow is not catchable: the process dies, `GlobalExceptionHandler` never runs, and every in-flight request and transaction of every user is lost. Under IIS in-process hosting the worker process is killed and restarted by WAS; the attacker repeats the request. (Whether IIS pool threads have 1 MB or more is needs confirmation; at 8 MB the payload still fits in the 20,000-character limit.)
- **Exploit.** Any signed-in user with `Task.Comment`: `POST /api/v1/tasks/{id}/comments` with `{"bodyHtml":"<pre><pre>...x300"}` (also `PUT .../comments/{id}`). The Cancel / On Hold reason path is not affected (it uses `ToSafeHtml`, plain-text escaping).
- **Fix.** Before any parser runs, scan the raw string once in linear time: reject (400 `TOO_COMPLEX`) when the number of `<` exceeds about 1,000 or the tag nesting depth exceeds about 20 (count open tags minus close tags, ignoring void elements). Better, replace the pre-parse with the same stack-less tokenizer approach used for `HtmlToText` in the SEC-02 fix, and give the Ganss/AngleSharp stage only input that is already depth-bounded. Add unit tests with `<pre>`, `<listing>`, `<div>`, `<b>`, `<table>` nests at 20,000 characters, run on a thread with a 256 KB stack, and an assertion on elapsed time. Consider moving sanitizing onto a dedicated thread with an explicit stack size as defence in depth (it does not remove SEC2-02).
- **Effort.** Small (half a day with tests).

### SEC2-02 High: cubic running time in the block-wrapper rewrite

- **Evidence.** `StripDroppedElements` rewrites every `div`, `h1..h6`, `blockquote`, `pre`, `section`, `article`, `address`, `tr` into a `<p>` inside a loop that calls `QuerySelectorAll(...).Reverse().ToList()` and then `element.Replace(...)` for each one (`CommentHtml.cs:109-124`). For nested wrappers this is cubic. Timing of `Sanitize` (warm, Release):

  | Input | Length | Time |
  |---|---|---|
  | `<div>a` x 100 + `</div>` x 100 | 1.2 KB | 0.09 s |
  | x 200 | 2.4 KB | 0.4 s |
  | x 400 | 4.8 KB | 1.2 s |
  | x 800 | 9.6 KB | 9.6 s |
  | x 1,650 | 19.8 KB | **66.7 s** |
  | `<div>` x 4,000 (unclosed) | 20 KB | 1.3 s |
  | `<div><b>` x 2,400 | 19 KB | 1.2 s |

  For n=600 `StripDroppedElements` alone takes 3.4 s, `HtmlSanitizer` on the same raw input 50 ms. The call is synchronous and takes no `CancellationToken`, so a client that disconnects does not stop it. Ordinary 20 KB text takes 7 ms.
- **Exploit.** Four concurrent 20 KB comments occupy four cores for over a minute each. Same endpoint as SEC2-01, same permission.
- **Fix.** As SEC2-01 (depth and tag-count cap makes the worst case a few milliseconds). Also stop rewriting block wrappers through the DOM one element at a time: do it once in a single tree walk, or let the allow-list unwrap them and insert paragraph breaks when serializing. Add a performance test (for example "20,000-character hostile bodies sanitize in under 200 ms").
- **Effort.** Small to medium, together with SEC2-01.

### SEC2-03 Medium: no rate limiting or cost cap on the expensive new endpoints

- **Evidence.** The only limiter is the `GlobalLimiter` in `IntakeRateLimiting.cs`, which returns `GetNoLimiter("other")` for everything that is not `POST /api/v1/intake` (lines 34-54). New endpoints with real cost: `POST/PUT comments` (sanitizer, SEC2-01/02); `GET /search` (up to five `LIKE '%term%'` scans, no index can help, one per keystroke after a 250 ms debounce) and `GET /search/advanced` (hit query plus a separate count query, `SearchService.cs:80-81`); `GET /audit/search` with `q` (`LIKE '%q%'` on `Summary`/`FieldKey` of the whole, ever-growing audit table, `AuditSearchService.cs:133`) and `GET /audit/facets` (two `SELECT DISTINCT` scans); `GET /dashboard` (15 sequential queries, `DashboardService.cs`, no caching). IIS `maxQueryString` (2,048 by default) limits `status=` floods; page sizes are capped at 100 to 200 everywhere.
- **Exploit.** A script loop from one authenticated user keeps SQL Server scanning `Task`, `Asset` (hundreds of thousands of rows per the code comments) and `AuditEvent`. Ordinary lawyers see the whole application slow down.
- **Fix.** Add a per-user fixed-window limiter for the JSON API (for example 300 requests/minute) with tighter named policies for comment writes (30/min), search (60/min), audit search (20/min); short output cache (5 to 10 s, per user and query) for the dashboard; `CommandTimeout` of about 15 s on the read queries. Consider an index plus full-text only if search latency is a business problem.
- **Effort.** Small.

### SEC2-04 Medium: `ASSET_REF` and `USER_REF` values are never validated (SEC-12 carried over)

- **Evidence.** `FormValueRules.cs:90` accepts any positive integer for `AssetRef`/`UserRef` (`IsPositiveInteger`, line 97). The round-1 resolution said the Task module would add a reference checker; the Task module exists (`TaskService.cs:286`, `:337`, `:534`; step values in `WorkflowInstanceService.cs`) and `IFormReferenceChecker` / `INVALID_REFERENCE` / `CROSS_MATTER_REFERENCE` for form values do not exist (`grep` finds nothing). The only scoping is the Angular picker (`create-task-page.ts:312`, `:427`).
- **Exploit.** `POST /api/v1/tasks` with `formValues: {"source_asset": 4711}` where asset 4711 belongs to another Matter (or does not exist, or `USER_REF` names a disabled user). The value is stored. A viewer's read-only picker then resolves the id to a name. Whether that shows another Matter's asset name to a user with `Asset.View` is needs confirmation (depends on the picker's lookup call, not read in detail). For a firm with Matter-level confidentiality this is the kind of cross-reference that audits flag, even though Phase 1 has no per-Matter visibility.
- **Fix.** Implement the planned `IFormReferenceChecker` (Assets and Identity) and call it for visible `ASSET_REF`/`USER_REF` fields in submit and draft mode with the owner's `MatterId` (Task request form: `task.MatterId`; step forms: the Task's Matter). Return `CROSS_MATTER_REFERENCE` / `INVALID_REFERENCE`.
- **Effort.** Medium.

### SEC2-05 Low: department dashboard figures are only hidden in the browser

- **Evidence.** `DashboardController.cs:22` requires `Task.View` only; `DashboardService.GetAsync` computes open, unassigned, overdue, on-hold, by-Pod, by-Type, aging, recent Tasks (title, matter ref and name) for everybody. `Dashboard.ViewDepartment` is checked only in `dashboard-page.ts:136` (`*mfHasPermission`). The documents disagree with the code: `docs/qa/permission-matrix-tests.md:91` ("department scope needs `Dashboard.ViewDepartment`... personal figures only, not 403"), `docs/ux/ux-spec.md:266,295,1198` (UAT-S01-6), `docs/qa/traceability.md:262` (VIEW-05), against the controller comment ("department-wide counts for everyone with Task.View", addendum E). The seeded Data Technician and Data Scientist roles do not hold the permission, so for them the code is more permissive than the matrix.
- **Impact.** Low: the same rows are available to those users through `/task-queue`. The permission is nonetheless dead on the server, and test principle 5 of the matrix ("backend authoritative") is not met.
- **Fix.** Product decision. Either enforce it (return `Mine` only and null/empty department blocks without the permission) or retire `Dashboard.ViewDepartment` and update the matrix, UX spec and traceability.
- **Effort.** Small.

### SEC2-06 Low: activity sentence defeats the `Audit.View` value gate; masking is not applied outside the audit browser

- **Evidence.** `TaskActivityService` returns `OldValue`/`NewValue` only when the caller holds `Audit.View` (`:75-76`), but `TaskActivityNarrator.FieldChange` builds the always-returned `Summary` from the same values: `"{label} set to {Clip(NewValue)}"` and `"{label} changed from {Clip(OldValue)} to {Clip(NewValue)}"` (`TaskActivityNarrator.cs:126,130`, clipped at 80 characters). Only `description` is excluded (line 121). This holds for every `FIELD_CHANGED` row: title, requestor name and email, due date, project, priority and every `form:<key>` field. `AuditValueGuard` (secret masking of tokens, passwords, JWTs) is applied by `GET /audit/search` but not by the activity endpoint (`AuditReader.cs:42-43` only truncates) and not by `GET /audit/events` (`AuditEventsController.cs:75-76`).
- **Impact.** FND-04 chose `Task.View` for old/new values, so what leaks is bounded: a `Task.View` user sees previous values (for example an earlier requestor email) and any secret-looking text a form field once held. The gate in code is nevertheless inconsistent with itself.
- **Fix.** Either drop the gate and document FND-04, or build the sentence without values for callers without `Audit.View` ("Requestor email changed"). Run `AuditValueGuard` on every outbound audit value (activity and `/audit/events`).
- **Effort.** Small.

### SEC2-07 Low: the "non-deletable" cancel and hold reasons can be rewritten

- **Evidence.** `EditAsync` (`TaskCommentService.cs:92-125`) checks only author, row version and `!IsDeleted`. It never looks at `Purpose`. The DB trigger `TR_TaskComment_Guard` forbids changing task, author and purpose, not the body (`db/scripts/12-tasks.sql:146-157`). `StatusReasonAsync` (`TaskPresenter.cs`) shows the latest body only, so after an edit the Task header shows the rewritten reason; the original is in `TaskCommentRevision` (readable by `Task.View` through `/revisions`) and the audit event says only "Comment edited".
- **Fix.** Reject edits when `Purpose != Normal` (409 `COMMENT_NOT_EDITABLE`), or mark an edited reason visibly on the Task header. The UI already hides delete for these comments; do the same for edit.
- **Effort.** Small.

### SEC2-08 Low: bulk completion can complete steps the user never saw

- **Evidence.** `TaskLifecycleService.CompletionAsync` calls `BulkCompleteUnresolvedAsync(..., new StepActionContext(task.Status, task.Id, task.MatterId), ct)` (`:179`) without the workflow row version. The request carries only the Task row version (`CompleteTaskRequest`), and step actions never modify the `Task` row, so the Task row version does not change when someone else saves values or starts a step. User A opens the "mark them all completed?" dialog (`GET /tasks/{id}/completion`), user B edits a step input, user A confirms: B's step is completed with B's half-finished values. Failure mode is a wrong "completed" mark, audited as bulk.
- **Fix.** Send and enforce the workflow `rowVersion` (or a hash of `Unresolved` step ids) with `completeUnresolvedSteps=true`; reply 409 `CONCURRENCY_CONFLICT` on mismatch.
- **Effort.** Small.

### SEC2-09 Low: `DateOnly` overflow gives HTTP 500

- **Evidence.** `createdTo.AddDays(1)` (`TaskQueueService.cs:294`), `completedTo.AddDays(1)` (`:320`) and the audit `to` (`AuditSearchService.cs:126`) throw `ArgumentOutOfRangeException` for `9999-12-31` (reproduced: `DateOnly.MaxValue.AddDays(1)` throws). `GET /task-queue?createdTo=9999-12-31`, `/my-work`, `/pod-work`, `/audit/search?to=9999-12-31` end in `GlobalExceptionHandler` as a logged error and a 500. `ConvertTimeToUtc` itself clamps and is fine. No crash, no data exposure; error-log noise and an easy way to trigger alerts.
- **Fix.** Validate the range of the date filters (for example 1900-01-01 to 2200-12-31) or use `AddDays` on a clamped value, and return 400.
- **Effort.** Small.

### SEC2-10 Low: unbounded comment thread and revision payloads

- **Evidence.** `ListAsync` returns up to `MaxListed = 1000` comments with full bodies and no paging (`TaskCommentService.cs:25,37`); each body can be 20,000 characters, so one `GET /tasks/{id}/comments` can be about 20 MB of uncompressed JSON (API JSON is deliberately not compressed). There is no per-Task or per-user cap on comments, so a `Task.Comment` user can build such a thread; the default oldest-first order then hides later comments beyond 1,000. `ListRevisionsAsync` (`:73-85`) has no limit; every edit appends a revision of up to 20 KB with no cap on edits.
- **Fix.** Page the thread (cursor like the activity feed), cap comments per Task per user per hour (see SEC2-03), cap revisions per comment (for example 50) or return metadata and fetch a body on demand.
- **Effort.** Small to medium.

### SEC2-11 Low: read models return data of types the caller cannot view

- **Evidence.** `GET /tasks/{id}/assets` needs `Task.View` only and returns each asset's display name, type and `ExternalReference` (`TaskAssetService.cs:26-38`, `:204`); the matrix lists `Asset.View` for asset reads. Search hits of type Project, Asset and Task include Matter reference and name (`SearchService.cs:264-275`, `:316-333`, `:370-385`), so a caller holding `Project.View` or `Asset.View` but not `Matter.View` sees Matter names; a number such as `343-12` matches by Matter reference through `RelatedTiers`. Linking with `Asset.Link` but without `Asset.View` can read names of inactive assets from the 409 text (`TaskAssetService.cs`, `ASSET_INACTIVE` message). All starter roles hold every View permission (PM-X-15), so there is no practical impact today; it matters the first time a custom role is narrowed.
- **Fix.** Either document "view permissions are not independent" in the matrix, or null the joined fields without the owning View permission.
- **Effort.** Small.

### SEC2-12 Info: comment links can mislead readers

`IsSafeLink` accepts any absolute http/https/mailto URI (`CommentHtml.cs:86`), including userinfo (`https://google.com@evil.com`, verified to survive), IP-literal hosts and bidi control characters. Allow-listed schemes mean no script execution; the risk is phishing inside an internal note. Consider showing the host next to the link text when it differs, and stripping `U+202A..U+202E`, `U+2066..U+2069` from hrefs.

### SEC2-13 Info: operational notes

- `/health/ready` is anonymous at application level and, per call, opens a SQL connection, reads the migration table and re-parses all 17 embedded scripts (`ReadinessHealthCheck.cs:64`, about 124 KB, SHA-256 per script). The shipped `web.config` turns anonymous authentication off, so IIS requires Windows sign-in first; load balancers that probe it need an allowance. Output is a fixed reason code only (no information disclosure). Cache the result for a few seconds.
- `IntakeRequestLimitsAttribute` is applied to the whole `IntakeController` and raises the request ceiling to 12 MB (`IntakeController.cs:79-81`) also for the JSON paste endpoint. Pasted text is still capped at `MaxEmailBytes` characters, with the concurrency and per-user limits. Keeping the 2 MB default for `parse-email/text` would remove 10 MB of avoidable buffering.
- `db/scripts` has no `16-*.sql` (15, then 17). Harmless, but confirm nothing was dropped in a merge.

### SEC2-14 Info: assignee rules

`GET /users/lookup` (`Task.Assign`) lists all active users, including Access Pending users with no role, and `ValidateAssigneesAsync` accepts them, so a task can be assigned to someone who cannot open it. A non-member assignee is only a warning (`USER_NOT_IN_POD`) by design. Inactive Pods and users are rejected.

## 3. Verified OK

Authorization and IDOR

- Policies on every new action match `permissions.json` and the matrix: Task read endpoints `Task.View`; create `Task.Create` plus `Task.Assign` / `Task.SetPriority` checked before any write (`TaskService.cs:213-226`); edit `Task.Edit` plus `Task.SetPriority` for a priority change; assign, priority, complete, cancel, reopen each own policy; `/status` checks the per-transition permission from the lifecycle matrix inside the locked transaction (`TaskLifecycleService.cs:77-85`); bulk completion also needs `Workflow.Execute` (`:171-173`); step actions `Workflow.Execute`, step reopen `Workflow.StepReopen`; asset links need `Asset.Link` and `Task.Edit` (`TaskAssetService.cs:164-168`); comments `Task.Comment` and author only; Pod Work requires `Task.View` and `Pod.View` (two `[Authorize]` attributes combine with AND); audit browser `Audit.View`; users lookup `Task.Assign`.
- `Perm:A|B` (`AccessAuthorization.cs`): alternatives are split from the attribute string only (a client cannot choose a policy name), an empty list fails closed, pending and disabled users are rejected before the alternatives are tried. Search endpoints are open to any single View permission and each type is skipped or rejected without its own View permission (`SearchService.cs:55`, `:82-84`); counts are not computed for hidden types.
- IDs are scoped to the parent: comment and revision lookups filter on `TaskId` and `!IsDeleted`; link role change and unlink on `(TaskId, AssetId)`; step actions load steps from the instance of the locked Task only; assets and projects must belong to the Task's Matter (`CROSS_MATTER_REFERENCE`), backed by two composite foreign keys (`14-task-links.sql`); priority, pod, user, workflow and Task Type are checked for existence, active state and eligibility.
- Mass assignment: request DTOs contain only editable fields (no status, creator, number, ids of the Task); unknown query keys are a 400 (`FilterParsing.EnsureKnown`).
- Immutability: `UpdateTaskRequest` Matter/Type/Workflow echo mismatch is 409 `IMMUTABLE_FIELD` (`TaskService.cs:397-406`) and the database trigger `TR_Task_Immutable` rejects changes to `MatterId`, `TaskTypeId`, `WorkflowInstanceId`, `TaskNumber`, `FormVersionId` even for a direct write; `TR_Task_NoDelete`, `TR_TaskComment_NoDelete`, `TR_TaskCommentRevision_AppendOnly` hold.
- Concurrency: create/update/assign/priority/status/complete/cancel/reopen compare and re-track the Task row version after `UPDLOCK, ROWLOCK` (`TaskTransactions.LockTaskAsync`); comment edit tracks the comment row version; link role change checks the link row version under the Task lock; step actions check the workflow row version; all DTO row versions are `[Required]` and the `RowVersionRulesTests` architecture test passes. The only unguarded write paths are comment add/delete and link/unlink (no version needed by design; see SEC2-08 for the one gap).
- Step actions follow the Task status guard in the engine (`TaskStepGuard`): blocked on Cancelled/On Hold, reopen allowed on Completed with an active-Matter check under the Matter lock.
- Soft-deleted comments do not leak: excluded from list, status reason, revisions and (not indexed in) search; audit rows hold only the purpose code. Revisions of deleted comments are not readable (`FindVisibleAsync`).

XSS and HTML

- 58 payloads against the real `CommentHtml` + HtmlSanitizer 9.2.1039 (script, svg, math, mXSS vectors with noscript/style/form/select/template/xmp/plaintext/listing, nested anchors, javascript/data/vbscript/protocol-relative/entity/tab/newline schemes, event handlers, style/class/id/name, `base`, `meta`, iframe/object/embed, comments, CDATA, processing instructions, `srcset`, `formaction`): no payload leaves an executable tag, attribute or scheme; `target` and `rel` from input are dropped and `rel="noopener noreferrer"` is always set on links that keep an `href`; second-pass output equals first-pass output for all 58 (no mutation by re-parsing); DOM clobbering via `id`/`name` is removed.
- Angular: the only `[innerHTML]` bindings are the comment bodies (`task-comments.ts:122,151`) and the status reason (`task-detail-page.ts:123`), both server-sanitized or escaped and then run through Angular's own sanitizer; there is no `bypassSecurityTrust*`; `DomSanitizer.sanitize` is used for the editor start value; the editor reduces paste to plain text (`rich-text-editor.ts:onPaste`), `normalizeLink` rejects `javascript:`/`data:`/relative links; `render()` adds `target="_blank"` and Angular keeps `rel` (verified in `@angular/core` attribute allow-list); `[href]` bindings for asset references and documentation links are guarded by Angular URL sanitizing plus `rel="noopener noreferrer"`; titles, descriptions, search and queue text use interpolation (plain text). No CSV or other export exists.
- CSP is enforced (not report-only): `script-src 'self'`, no inline script in the production `index.html`; `style-src 'unsafe-inline'` remains for Angular and PrimeNG as documented in SEC-08. Comments contain no images, so `img-src` is not widened.

Injection and queries

- All user text reaches SQL as parameters. `SearchTerm.EscapeLike` escapes `\`, `%`, `_`, `[` with `ESCAPE '\'`; the raw SQL for Clients uses typed `SqlParameter`s with sizes matching the escaped pattern lengths (`SearchService.cs`); ranking predicates are expression trees with parameterised holders; audit search escapes the same set (`AuditSearchService.cs:206-210`); sort and direction are whitelisted (`TaskQueueRules.SortFields`, `TaskService.SortFields`); `IN` lists are `Contains` over de-duplicated ints. Page sizes: queue 100, search advanced 100, audit 200, activity 100, lookup 50, global search 50 per type.
- Time zone: `X-Time-Zone` is validated to 64 characters of `[A-Za-z0-9/_+-]`, must contain `/` or be `UTC`, and falls back to the firm zone, so it cannot reach the file system or break parsing. Overdue is computed from "now" converted to the viewer zone in SQL predicates and per-row flags alike (`TaskQueueRules`, `DueDates`); DST gaps are handled in `UserTimeZone.ToUtc`.

Hosting

- Static files: framework `PhysicalFileProvider` (no traversal), no unknown file types, no directory browsing, no source maps in the production build (`angular.json` production has no `sourceMap`), hashed assets `immutable`, everything else `no-cache`, text compression only for static text types (JSON never compressed, BREACH-safe).
- SPA fallback is GET/HEAD only and never answers for `/api`, `/health`, `/openapi` (404 problem instead of `index.html`), case-insensitive.
- Headers: `SecurityHeadersMiddleware` is first in the pipeline, so error and static responses carry CSP, nosniff, frame, referrer, permissions and COOP headers; `/api` gets `default-src 'none'` and `Cache-Control: no-store` set at `OnStarting`, so also on errors. HSTS outside Development. No `Server` header. `AllowedHosts` defaults to localhost; the production template has an invalid placeholder so a forgotten setting fails closed. No CORS is configured (same origin only). No cookies exist under Windows authentication; the CSRF guard requires `X-MatterFlow-Client: web` and a JSON or multipart content type for every non-safe `/api` call, and rejects `Sec-Fetch-Site: cross-site`.
- `/health/ready` returns only `ready` or one of four fixed reason codes, never a message. `--migrate-only` is reachable only through the command line or `MATTERFLOW_MIGRATE_ONLY` on the host, uses `ConnectionStrings:Migrations`, logs only the exception message, exits 0/1, and skips seeds and the audit-store guard by design.
- `web.config` turns anonymous authentication off, so static files and health checks also need a Windows sign-in; request body 12 MB at IIS, 2 MB in the app.

Data and audit

- New actions are audited in the same transaction with actor, time (interceptor) and correlation id: task created/updated (`FIELD_CHANGED` per field), assignment (`TASK_ASSIGNED` old/new JSON), status (`TASK_STATUS_CHANGED` with cause and `commentId`, bulk note), comments (added/edited/deleted), asset link/unlink/role change, step start/values/complete/skip/reopen (values changes also through the `[Audited]` `FormValueSet`). The bulk completion's step events, comment and status change share the request correlation id. Audit text is clipped to column widths so a long value cannot fail a business save.
- Audit tamper resistance is unchanged: scripts 14, 15 and 17 only add tables and indexes; `AuditProtectionSchemaTests` pass.
- No log call in the new modules writes request content; the global handler logs the exception only. The sensitive matter flag is display-only by design (addendum O) and is carried consistently in search and queue rows.
- Search results and the dashboard do not include comment text.

Round 1 regression (all hold on current `dev`)

| ID | Check | Result |
|---|---|---|
| SEC-01 self-grant | `UserAdministration.SetRolesCoreAsync` still requires System Admin for the System Admin role and held permissions for other roles (`:170-177`); `IdentityPrivilegeTests` (all) | Pass |
| SEC-02 HTML DoS (intake) | `EmailParseServiceTests`, `HtmlToTextTests` and related (408 unit tests selected by name) | Pass |
| SEC-03 last admin | `InAdminGuardAsync` lock still wraps role and active changes; `Two_admins_*` concurrency tests inside `IdentityPrivilegeTests` | Pass |
| SEC-04 audit DENY | `AuditProtectionSchemaTests` (6) | Pass |
| SEC-05 ReDoS | `FormRules*`, `PortablePattern*` unit tests | Pass |
| SEC-08 headers | `SecurityHeadersTests`, `SpaHostingTests`, `ReadinessAndMigrateOnlyTests` | Pass (53 integration tests in total with the identity set) |
| SEC-09 row versions | `RowVersionRulesTests` architecture test; all 35 architecture tests; every new update-style DTO has `[Required] RowVersion` | Pass |

Note: the comment sanitizer has no unit test for nesting depth, timing or the stack; the tests that exist cover happy paths and the usual XSS strings, which is why SEC2-01/02 got through.

## 4. Dependency results

- `dotnet list MatterFlow.sln package --vulnerable --include-transitive`: no vulnerable package in any of the 24 projects (source `api.nuget.org`, queried 2026-10-14).
- `dotnet list package --deprecated`: only `xunit 2.9.3` (test project, "Legacy", alternative `xunit.v3`). Not a security issue.
- `npm audit` (all) and `npm audit --omit=dev`: found 0 vulnerabilities (Angular 21.2.25, PrimeNG 21.1.10).
- Relevant to SEC2-01: HtmlSanitizer 9.2.1039 is the newest stable release and resolves AngleSharp 1.7.2; AngleSharp 1.8.4 (newest stable) has the same stack overflow, so the fix must be in application code.
- `Microsoft.EntityFrameworkCore*` stays at 10.0.0 while ASP.NET packages are 10.0.13; no advisory today, keep an eye on it.

## 5. Prioritized fix list

| Order | Finding | Action | Effort |
|---|---|---|---|
| 1 | SEC2-01 | Linear pre-scan or tokenizer: cap tag count and nesting depth before AngleSharp; add `<pre>`/`<listing>`/deep-nest tests on a 256 KB stack | S |
| 2 | SEC2-02 | Remove the per-element DOM rewrite (or bound it by the same cap); add a time assertion test | S-M |
| 3 | SEC2-03 | Per-user rate limits and read timeouts; short cache for the dashboard | S |
| 4 | SEC2-04 | Implement the `IFormReferenceChecker` planned in SEC-12 | M |
| 5 | SEC2-07 | Block edits of Cancel / On Hold reason comments | S |
| 6 | SEC2-08 | Enforce workflow row version for `completeUnresolvedSteps` | S |
| 7 | SEC2-06 | Make the activity sentence value-free without `Audit.View`; apply `AuditValueGuard` to activity and `/audit/events` | S |
| 8 | SEC2-05 | Decide and align: enforce `Dashboard.ViewDepartment` on the server, or retire it and fix the docs | S |
| 9 | SEC2-09, SEC2-10 | Date range validation; page comments, cap revisions | S |
| 10 | SEC2-11 to SEC2-14 | Document or tighten as listed | S |

## 6. Needs confirmation / not covered

- Real thread stack size of IIS in-process request threads on the target server (SEC2-01 crashes at 8 MB with 12.5 KB and at 1 MB with 1.5 KB, so the exploit holds either way; only the minimum size differs). A one-time test on the staging site with a 3,000-tag `<pre>` body (expect a worker process restart) would settle it.
- SEC2-04: whether the read-only reference picker shows the name of an asset of another Matter.
- Load balancer or monitoring probes of `/health/ready` (SEC2-13).
- Not exercised: a real browser (paste handling, drag and drop of HTML into the editor is not intercepted, which only affects the author's own editor and is sanitized again on the server), a running IIS site, and full integration suite (only the named regression tests were run, as instructed).
