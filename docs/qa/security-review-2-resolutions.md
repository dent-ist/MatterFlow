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
- **Deferred, done in the performance pass (ticket 64).** The dashboard has a 15 s output cache keyed by user, period, time zone, local date and the Dashboard.ViewDepartment right (`Dashboard:CacheSeconds`, 0 = off; it expires, it is not invalidated, so a figure can be up to 15 s old), and the Task queues, search, audit browser and dashboard reads run with a 15 s command timeout (`Queries:ReadCommandTimeoutSeconds`), answered as 503 `QUERY_TIMEOUT`. Tests: `PerformanceRound1Tests`, `DashboardCacheTests`.

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
- **Deferred, done in the performance pass (ticket 64).** The Comments tab shows "Showing n of total" and a Load more button that fetches the next page (`skip`/`take`); a reload after a post, edit or delete keeps what was loaded. Tests: `task-comments.spec.ts` (long threads).

## SEC2-11 Low: read models and view permissions

- **Commit.** `bcdbaf8` (assets), `c009581` (search).
- **Fix.** Linked assets show a generic name, no type and no external reference without `Asset.View`; the inactive-asset conflict message does not name the asset. Search hits omit Matter reference, name and the project secondary line without `Matter.View`.
- **Tests.** `Sec2ReadModelAndDateTests.Sec2_11_...`.
- **Deferred.** A search term that matches a Matter number still finds the related records without `Matter.View` (the match itself is the leak; the displayed text is not). Documented rather than changed: all starter roles hold every View permission.

## SEC2-12 Info: link display

- **Fix (server).** Links with credentials (`https://google.com@evil.com`) and links containing bidi control characters are no longer kept as links (the text stays). `CommentHtmlHostileInputTests.Links_with_credentials_...`.
- **Deferred, done in the performance pass (ticket 64).** The comment view shows the real host (with a non-default port, internationalized names in punycode) in parentheses after every http(s) link and a warning mark for credentials in the address, direction-control characters and link text that names another site. Tests: `rich-text.spec.ts` (decorateLinks), `task-comments.spec.ts` (links).

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

## Addendum 3: rich text with safe tables (issue #80, decision R)

Descriptions and comments now accept tables, so the sanitizer's allow-list grew for the first time since SEC2-01/02. This note records what is allowed, how it was tested, the adversarial self-review and the residual risks. (The review was done by the developer of the change; no independent reviewer was available in the session. It is written as a checklist so a second pair of eyes can repeat it.)

### What is allowed (server, authoritative: `MatterFlow.SharedKernel.Text.RichHtml`)

| Kind | Allowed | Everything else |
|---|---|---|
| Elements | `p br strong b em i u ul ol li a table thead tbody tfoot tr th td caption colgroup col` | unwrapped (text kept) or, for `script style template noscript iframe object embed svg math frame frameset applet textarea select title xmp noembed noframes`, removed with their content |
| Attributes | `href` on `a` (http, https, mailto; absolute; no credentials; no control or direction characters; **no `< > " `` ` `` ** in the value); `rel="noopener noreferrer"` set by the server; `colspan`, `rowspan` on `td`/`th` (digits only, 2-100, 1 dropped, anything else removed); `scope` on `th` (`row col rowgroup colgroup`, lower-cased) | every other attribute on every element (a per-element policy runs after the sanitizer; `href` on `<b>` and `colspan` on `<p>` are removed) |
| Text | bidirectional embedding and override controls (U+202A-202E) removed from text | |
| Structure | tables nested to depth 3, deeper ones flattened to paragraphs; whitespace between table parts dropped; comments, processing instructions and conditional comments never emitted | |
| Limits | 200 cells per field (`TABLE_TOO_LARGE`), 100,000 stored characters and 300,000 input characters for a description (`HTML_TOO_LARGE`), 20,000 for a comment; tag and depth caps checked by a linear pre-scan before any parser runs (`TOO_COMPLEX`) | |
| Fixpoint | every result is sanitized again and must equal itself, else the input is refused (`Unstable`), so a browser re-parse of the stored text cannot differ from what was checked | |

The browser adds Angular's own sanitizer on every render and removes images, frames, forms and styles again (`decorateLinks`). The editor rebuilds pasted and dropped HTML from the same allow-list into new elements (nothing from the source is moved over).

### Tests

- `RichHtmlSecurityTests` (unit): a corpus of about 230 hostile inputs (script, style, iframe, svg and math, mXSS patterns including the DOMPurify bypass families with `<mglyph>`, `<noscript>`, `<form>` nesting and `<annotation-xml>`, namespace confusion inside `table`/`caption`/`colgroup`/`select`/`template`, `<base>`, `<meta>`, `javascript:`/`data:`/`vbscript:` URLs with entity and whitespace tricks, attribute smuggling through `colspan`/`rowspan`/`scope`, duplicate attributes, huge and deeply nested tables, foster parenting, CDATA, comments and conditional comments, CSS in attributes) run through all three limit profiles. Each output is re-parsed by an independent AngleSharp parser and checked against its **own** allow-list (elements, per-element attributes, HTML namespace only, no comment or foreign node, safe `href`) and must be a sanitizer fixpoint. A fixed-seed fuzzer (4,000 mutated and recombined inputs, 1,500 generated table grammars) checks the same invariant and that no input is ever `Unstable`. Round-trip tests check `sanitize(sanitize(x)) == sanitize(x)`.
- `RichHtmlTableTests`: kept structure, implied `tbody`, Outlook clean-up (styles, `mso-*`, `o:p`, conditional comments, fonts, empty spans), every `colspan`/`rowspan`/`scope` value class, nesting depth, 200/201 cells (also nested and across tables), a cell flood refused in under 200 ms, size limits, worst-case timing, plain-text rendering.
- Existing `CommentHtmlTests` and `CommentHtmlHostileInputTests` (nesting, timing, stack) still pass on the shared implementation.
- `TaskRichDescriptionApiTests` (integration): create, update, read through the API with a table, hostile HTML, plain text, empty content, every limit error (`HTML_TOO_LARGE`, `TOO_LONG`, `TABLE_TOO_LARGE`, `TOO_COMPLEX`), a legacy text description (unchanged echo is a no-op, title-only edit keeps text, a real edit converts), audit rows hold plain text, comments with tables.
- `EmailHtmlTests` (unit): `.eml` HTML body with a table kept and scripts, styles and images gone, over-limit and hostile nesting fall back to the text body with a warning, pasted HTML sanitized and its header lines removed.
- `TaskDescriptionFormatSchemaTests`: script 25 keeps existing rows `TEXT`, check constraint, not null.
- Frontend: `paste-clean.spec.ts` (Outlook sample, hostile paste, idempotence, depth, 200 cells), editor specs (hostile paste and drop, tables, keyboard), details-tab and create-page specs. Playwright `rich-description.spec.ts` in Chromium: Outlook paste kept through save and reload, hostile paste neutralised in the editor, on the server and on the page (no dialog, `window.__pwn` unset), email file and pasted email keep their table, legacy text unchanged, axe on the table, keyboard table editing, the 200-cell error.

### Findings of the work itself

1. **`href` was allowed on any element** (the sanitizer's attribute list is global). Found by the fuzzer (`<b href=...>`). Harmless but wrong; closed by the per-element policy.
2. **Markup characters inside an `href` value** (`mailto:a@b.example?subject=<script>`) survived inside a quoted attribute. Not exploitable in the HTML context it is stored for, but it is the building block of mXSS when markup is re-embedded elsewhere. Found by the corpus. Links with `<`, `>`, `"` or `` ` `` in the address are no longer links.
3. **Direction override characters in text** could reorder pasted figures. Removed from text (they were already refused in links).
4. The tag-count cap (1,000) was too low for a 200-cell Outlook table (about 8 tags per cell); it is a limit per field kind now (comment 2,500, description 10,000, email 20,000).

### Adversarial self-review (checklist)

| Question | Result |
|---|---|
| mXSS: can the parse, serialize, parse round trip change meaning? | Every output is verified a fixpoint at write time; the corpus covers the known families (`<mglyph>`/`<style>` in `<math><mtext><table>`, `<form>` nesting, `<noscript>`, `<svg><desc>`, `<select><template>`). None survives. |
| Namespace confusion through `svg` or `math` inside a table | Removed with content before the allow-list; output asserted HTML-namespace only. |
| `<form>`, `<base>`, `<meta>`, `<link>` | Unwrapped or removed, never emitted (corpus, plus `base` plus relative link case). |
| Attribute value smuggling (`colspan="2 onclick=..."`, duplicate attributes, quotes, newlines) | Span values must be 1-3 ASCII digits; everything else removes the attribute; the output is re-parsed in tests and only the allowed attributes are accepted. |
| CSS | There is no `style` attribute, no `style` element and no `class` in the output, so no CSS reaches the page. |
| Entities and encodings (`&#x6A;avascript`, `&colon;`, null bytes, `%3C`) | Decoded by the parser before the scheme check; the scheme check is on the decoded value. |
| Resource exhaustion (nesting, tag floods, cell floods, huge input, regex) | Linear pre-scan before any parser; depth 20, tags and cells capped; 16 MB parser thread as a backstop; cell floods answered in milliseconds; no unbounded regex (`<[^<>]*>`). |
| Stored data leaking into other sinks (audit, search, exports) | Audit stores the plain-text rendering; search does not index descriptions. |
| Client-only protection | None relied on: the server sanitizes on every write; the browser sanitizes on every render. |
| Dragging content into the editor (not intercepted by the earlier editor, SEC2 section 6) | Now intercepted: drop is rebuilt like a paste; files are refused. |

### Residual risks

- **Parser differences.** The allow-list is applied with AngleSharp; browsers parse differently in rare corners. The fixpoint rule, the plain element set and Angular's sanitizer on render are the answer; no known case. A parser bug in AngleSharp that crashes (not the stack-depth class) would surface as a 500 for that one request, not as stored data.
- **Cost of a worst-case save.** A description at the caps (10,000 tags nested 20 deep in stacks) takes seconds of CPU on one request thread (measured in `The_worst_case_inside_the_description_caps_stays_within_a_few_seconds`); rate limits (`TaskWritesPerMinute`) bound the abuse by one signed-in user. Not a new class of risk, but a larger one than a 20 KB comment.
- **Deceptive content, not code.** A table can state anything (wrong amounts, a link whose text names another site). Links show their real host and a warning for mismatches (SEC2-12), bidirectional controls are removed from text, but a table's content is as trustworthy as the person who pasted it, as before.
- **Privilege.** Pasting a whole email keeps its quoted chain; the privilege reminder stays on intake, the Description and comments, and the audit trail keeps plain text only.
- **Legacy text descriptions** are displayed escaped and never interpreted as HTML.

