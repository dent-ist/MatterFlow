# Security review 2: resolutions

Resolution notes for `security-review-2.md`. Each entry: the fix, the commit, the regression test, and what was deferred and why. All regression tests were written to fail on the code before the fix (the stack-overflow payloads crash the test host on the old code).

## Tests changed because they encoded the old behavior

| Test | Why it changed |
|---|---|
| `TaskLifecycleApiTests` (4 direct `complete` calls), `TaskAtomicityTests`, `TaskStarterConfigurationTests`, `TaskHarness.CompleteAsync` | A bulk completion now sends `workflowRowVersion` (SEC2-08). The calls only gained the new mandatory field. |
| `UsersLookupApiTests.Lookup_returns_active_users_by_name_...` | The lookup now offers only users that hold a role; the test users get a role first (SEC2-14). |
| `task-detail-page.spec.ts` bulk confirm expectation, `aCheck` factory | The confirm call carries `workflowRowVersion` from the completion check (SEC2-08). |
| `DatabaseApiFactory` | The per-user API budgets are lifted to 1,000,000 per minute for the shared test host; `ApiRateLimitingTests` lowers them again (SEC2-03). |

## SEC2-01 Critical: stack overflow in the comment sanitizer

- **Fix.** `CommentHtmlGuard` is a linear pre-scan that runs before AngleSharp. It counts every `<` followed by a letter (also inside attribute values, raw-text elements and `/>`, so it never reports less depth than a parser builds), pops only on a closing tag that matches the innermost open tag, and rejects more than 1,000 tags or a nesting depth above 20. Void elements and elements that cannot nest in HTML (`p`, `li`, table parts, `option`, ...) add no depth. The comment service answers 400 `VALIDATION_FAILED` with field error `bodyHtml` / `TOO_COMPLEX`. `CommentHtml.Sanitize` also throws `CommentTooComplexException` for direct callers and runs the parser on a dedicated thread with a 16 MB stack as defence in depth. The email intake path does not use AngleSharp (its own stack-less `HtmlToText`), so it is not affected; no other code feeds user HTML to AngleSharp or HtmlSanitizer.
- **Commit.** `7dfd425`.
- **Tests.** `CommentHtmlHostileInputTests` (unit: the exact payloads `<pre>` x2,500/4,000, `<listing>`, `div`, `span`, `font`, `b`, formatting adoption, `table`, `template`, `svg`, `math`, self-closing `div`, upper case, attribute-quote trick, stray closers; each under 500 ms, plus a realistic comment that must pass) and `TaskCommentsApiTests.Sec2_01_...` (POST and PUT return 400 quickly and the host keeps serving).
- **Deferred.** Nothing. The caps are constants; make them options only if a legitimate comment ever needs more than 20 levels or 1,000 tags.

## SEC2-02 High: cubic block-wrapper rewrite

- **Fix.** The per-element `QuerySelectorAll` / `Replace` loop is gone. One read-only post-order walk writes the paragraph-wrapped markup into a `StringBuilder`; combined with the SEC2-01 caps the worst accepted input (20 nested `div` x 24) sanitizes in about 40 ms in a Debug build. The 19.8 KB nested-`div` payload is rejected in well under 100 ms.
- **Commit.** `7dfd425`.
- **Tests.** `CommentHtmlHostileInputTests.Nested_divs_of_19_8_KB_fail_fast_...` and `Worst_case_inside_the_caps_is_fast`; the existing `CommentHtmlTests` XSS battery (58 payloads, idempotence) still passes unchanged.
- **Deferred.** Nothing.

## SEC2-03 Medium: rate limits and cost caps

- **Fix.** `ApiRateLimiting` adds per-user fixed-window budgets (partition = signed-in user) chained behind the intake limiter: all API calls 1,200/min, comment writes 30/min, other task writes 120/min, search typeahead 180/min, advanced search 60/min, audit browser 60/min, dashboard 60/min. Rejections are 429 with `Retry-After` and the problem-details body `TOO_MANY_REQUESTS`. All values are configurable under `RateLimits:*` (0 switches one off). `QueryLimitMiddleware` rejects API calls whose query string exceeds 4,096 characters or 100 values (repeated keys count) with 400 `QUERY_TOO_LARGE`.
- **Commit.** `5f15637`.
- **Tests.** `ApiRateLimitingTests` (each budget, `Retry-After`, per-user isolation, query caps).
- **Deferred.** The short output cache for the dashboard and the 15 s `CommandTimeout` on read queries: a cache needs a per-user, per-time-zone key and invalidation rules the product owner should agree on, and the budget already bounds the cost (60 calls/min/user). Tracked as follow-up.

## SEC2-04 Medium: ASSET_REF and USER_REF validation (SEC-12)

- **Fix.** New extension point `IFormReferenceValidator` (+ `FormReferenceContext`, `FormReferenceCodes`) in `Configuration.Contracts`; `FormSubmissionOptions.References` / `FormSaveOptions.References` switch the checks on. The forms validator and the value store call `FormReferenceChecks` after the pure evaluator, only for visible, valid, changed fields (stored legacy values never block an unrelated edit). `AssetReferenceValidator` (Assets) requires an existing, active Asset of the same Matter (`INVALID_REFERENCE`, `CROSS_MATTER_REFERENCE`). `UserReferenceValidator` (Configuration, through `IUserDirectory`) requires an existing, active user. A reference field without a registered validator fails closed. Wired into Task create/update (Matter of the Task), step value saves (Matter from `StepActionContext`), Asset forms (Asset's Matter) and the Client/Matter/Project custom fields (no Matter scope, existence and active only). Completion-time re-validation of stored step values does not pass a context, so a later deactivation never blocks a Task.
- **Commit.** `2121aee`.
- **Tests.** `TaskReferenceFieldsApiTests` (same Matter OK, other Matter, nonexistent, inactive asset, nonexistent and disabled user, update only checks changed fields).
- **Deferred.** Step forms save Draft values, so a step created before this fix may still hold an unchecked reference until it is edited; no data migration was done.

## SEC2-05 Low: `Dashboard.ViewDepartment`

- **Commit.** `c009581`.
- **Fix.** Enforced. Without the permission the response keeps its shape but every department block is empty or zero; only `mine` is filled. Documents (permission matrix, UX spec, traceability) already describe this rule.
- **Test.** `DashboardApiTests.Sec2_05_...`.
- **Product decision.** The seeded Data Technician and Data Scientist roles do not hold `Dashboard.ViewDepartment`, so they now see only their own block, as the matrix says.

## SEC2-06 Low: activity sentences and masking

- **Commit.** `bcdbaf8` (sentence), `c009581` (masking).
- **Fix.** Without `Audit.View` a field-change sentence names the field only ("Requestor email changed"). `AuditValueGuard` now also runs on the activity feed (`AuditReader`) and on `GET /audit/events`. Status and assignment sentences keep their values: they are the point of the timeline and FND-04 gives them to `Task.View`.
- **Test.** `TaskActivityApiTests.Sec2_06_...`.
- **Deferred.** The search-style summary of non-task audit events is unchanged.

## SEC2-07 Low: Cancel / On Hold reasons

- **Commit.** `bcdbaf8`.
- **Fix.** Editing any comment with a non-NORMAL purpose is 409 `COMMENT_NOT_EDITABLE`; `canEdit` is false for them.
- **Test.** `TaskCommentsApiTests.Sec2_07_...`.

## SEC2-08 Low: bulk completion row version

- **Commit.** `bcdbaf8`.
- **Fix.** `GET /tasks/{id}/completion` returns `workflowRowVersion`; `POST /tasks/{id}/complete` with `completeUnresolvedSteps=true` requires `workflowRowVersion` (400 `VALIDATION_FAILED` if missing) and answers 409 `CONCURRENCY_CONFLICT` when the workflow changed since the check. OpenAPI and the generated client were regenerated; the Task detail store sends the version of the check the user confirmed and, on a conflict, shows the fresh list again.
- **Tests.** `TaskLifecycleApiTests.Sec2_08_...`, `task-detail-page.spec.ts` (confirm payload, stale confirmation).

## SEC2-09 Low: `9999-12-31`

- **Commit.** `c009581`.
- **Fix.** `QueueClock.EndOfDayUtc` and the audit search clamp the exclusive upper bound for the last representable day instead of overflowing.
- **Test.** `Sec2ReadModelAndDateTests.Sec2_09_...` (queue, my work, pod work, audit search).

## SEC2-10 Low: comment threads and revisions

- **Commit.** `bcdbaf8`.
- **Fix.** `GET .../comments` takes `skip` and `take` (default and maximum 200, was a silent 1,000 cut). A comment accepts at most 50 edits and a Task at most 2,000 comments (409 `COMMENT_LIMIT`), which bounds the revision list and the thread.
- **Test.** `TaskCommentsApiTests.Sec2_10_...`.
- **Deferred.** The Task detail page still loads the first 200 comments only (it did not page before either); a "load more" control is a UI task.

## SEC2-11 Low: read models and view permissions

- **Commit.** `bcdbaf8` (assets), `c009581` (search).
- **Fix.** Linked assets show a generic name, no type and no external reference without `Asset.View`; the inactive-asset conflict message does not name the asset. Search hits omit Matter reference, name and the project secondary line without `Matter.View`.
- **Tests.** `Sec2ReadModelAndDateTests.Sec2_11_...`.
- **Deferred.** A search term that matches a Matter number still finds the related records without `Matter.View` (the match itself is the leak; the displayed text is not). Documented rather than changed: all starter roles hold every View permission.

## SEC2-12 Info: link display

- **Fix (server).** Links with credentials (`https://google.com@evil.com`) and links containing bidi control characters are no longer kept as links (the text stays). `CommentHtmlHostileInputTests.Links_with_credentials_...`.
- **Deferred.** Showing the real host next to the link text in the Angular comment view: pure presentation, no security boundary left once the server drops the deceptive forms.

## SEC2-13 Info: operational notes (no code change)

- `/health/ready` re-reads and hashes all embedded scripts per call: cache the result for a few seconds before pointing a load balancer at it (needs an IIS allowance because anonymous authentication is off).
- `IntakeRequestLimitsAttribute` raises the body ceiling to 12 MB for the JSON paste endpoint too; moving `parse-email/text` out of the attribute would restore the 2 MB default.
- `db/scripts` has no `16-*.sql`; it was never merged (15 then 17), nothing was dropped.

## SEC2-14 Info: assignee lookup

- **Commit.** `c009581`.
- **Fix.** `GET /users/lookup` lists only active users that hold a role (not Access Pending). The assignment rule in `ValidateAssigneesAsync` still accepts any active user by id, as designed.
- **Test.** `UsersLookupApiTests.Sec2_14_...`.

## Verification

Backend: `dotnet build -warnaserror` and `dotnet format --verify-no-changes` clean; Architecture 35, Unit 1,019, Schema 52, Integration 556 tests pass. Frontend: lint, prettier and production build pass; `ng test frontend` has two failures in `work-filter-bar.spec.ts` (`#fb-q` not found), a file this work does not touch.
