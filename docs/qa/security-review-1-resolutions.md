# Security review 1: resolutions

Resolves `docs/qa/security-review-1.md` on branch `worktree-agent-ab1ce70e042400d95` (based on `dev` at `f96190d`). Commit ids are the branch commits; the PM may see different ids after merge or rebase.
"Reproduced" means the review's reproduction was repeated as an automated test that fails without the fix (checked for the concurrency tests by disabling the lock) or the hostile input was run against the old code path; the review's manual reproductions with a running API were not repeated.

Status legend: **Fixed**, **Fixed (partly)** with what is deferred, **Noted** (Info, no change), **Deferred**.

| ID | Status | Commit |
|---|---|---|
| SEC-01 | Fixed | 5ead8a2 |
| SEC-02 | Fixed | 4b10936 |
| SEC-03 | Fixed | 5ead8a2 |
| SEC-04 | Fixed | 53dae93 |
| SEC-05 | Fixed | e1c3846 |
| SEC-06 | Fixed | 8c93c3d |
| SEC-07 | Fixed | 8c93c3d |
| SEC-08 | Fixed | 85a7764 |
| SEC-09 | Fixed | 5ead8a2 (identity), 3043583 (forms) |
| SEC-10 | Fixed | 2231332 |
| SEC-11 | Fixed (CVE); MimeKit/MsgReader already current | 4c85f67 |
| SEC-12 | Deferred to the Task module (note below) | none |
| SEC-13 | Fixed | 8c93c3d |
| SEC-14 | Fixed | 8e86a53 |
| SEC-15 | Fixed (documentation aligned to code) | 8e86a53 |
| SEC-16 | Fixed | 0bbe921 |
| SEC-17 | Fixed (deadlock mapping, RCSI check and runbook step) | 5ead8a2, 8e86a53, 53dae93 (runbook) |
| SEC-18 | Fixed | 8e86a53 |
| SEC-19 | Fixed (partly): global rate limiting deferred | 85a7764 |
| SEC-20 | Fixed | 0bbe921 |
| SEC-21 | Fixed | e1c3846 |
| SEC-22 | Fixed | 8e86a53 |
| SEC-23 | Fixed (startup warning); Task module must still replace the guard | 8e86a53 |
| SEC-24 | Noted; warning added | 8c93c3d |
| SEC-25 | Noted | none |
| SEC-26 | Fixed | 4b10936 |
| SEC-27 | Fixed (documentation) | 8e86a53 and doc edits |

Existing tests that encoded insecure or now-removed behavior were updated, not weakened: `WalkingSkeletonTests` (optional `rowVersion`, and a non-admin `User.Manage` holder deactivating System Admins), `AuthenticationSelectionTests` (`Staging` + `dev` expected `Dev`), `FormRulesEdgeCaseTests` (`(a|aa)*b$` was used as a "valid" slow pattern; it is now rejected at publish, so the timeout test uses a slow but still portable pattern), `Huge_header_value_is_bounded` kept as is (an undecoded 2 MB header is still fine), and the integration tests that saved or published form drafts without a row version now use `FormDraftApi`.

## SEC-01 Privilege escalation through User.Manage / Role.Manage

- **Fix:** `UserAdministration.SetRolesAsync`: only a System Admin may grant or revoke the System Admin role (403 `PERMISSION_DENIED`); everybody else may grant only roles whose permissions they hold themselves ("no grant above own level"). `SetActiveAsync`: only a System Admin may activate or deactivate a System Admin (extra hardening: a `User.Manage` holder could otherwise switch an admin off). `RoleAdministration.CreateAsync/UpdateAsync`: permissions newly added to a role must be held by the caller unless the caller is a System Admin. The rule is documented as PM-X-12 in `docs/qa/permission-matrix-tests.md`.
- **Tests:** `IdentityPrivilegeTests.User_manager_cannot_grant_themselves_the_system_admin_role`, `User_manager_cannot_grant_system_admin_to_someone_else_or_revoke_it`, `System_admin_can_grant_and_revoke_the_system_admin_role`, `User_manager_cannot_grant_a_role_that_carries_permissions_they_do_not_hold`, `Role_manager_cannot_add_permissions_they_do_not_hold_but_a_system_admin_can`, `User_manager_cannot_deactivate_a_system_admin`.
- **Decision for the product owner:** removing a permission from a role is not restricted (only adding is), and revoking a non-admin role is allowed for any `User.Manage` holder.

## SEC-02 Email intake CPU denial of service

- **Fix:** `HtmlToText` no longer builds a document tree: HtmlAgilityPack is replaced by a single-pass, stack-less tokenizer (linear time, independent of nesting depth; so no depth cap is needed, the old stack-overflow test with 20,000 nested `<div>` still passes). Input is capped at 1,000,000 characters, scanning stops as soon as the 200,000-character output is full, and the cancellation token is polled, so the timeout now stops the work. HtmlAgilityPack is removed from the repository. For `.eml`, a decoded top-level header (Subject, From, Date, Received, ...) longer than 64 KB is rejected before MimeKit's non-cancellable decoder runs (the 9 MB Subject took 6.5 s). Intake uploads are limited to 2 concurrent parses for the whole server (queue of 4) and 30 requests per minute per user; excess gets 429 `TOO_MANY_REQUESTS` with `Retry-After` (`Intake:MaxConcurrentParses`, `MaxQueuedParses`, `RequestsPerMinutePerUser`, `MaxHeaderBytes`).
- **Tests:** `EmailParseServiceTests.Hostile_nested_html_eml_of_150_kb_is_read_in_well_under_a_second` (30,000 nested divs, 150 KB, asserted under 1 s), `Hostile_nested_html_eml_of_a_megabyte_is_still_fast`, `A_huge_decoded_header_is_rejected_before_the_slow_decoder_runs`, `A_huge_folded_subject_is_rejected_too`, `A_cancelled_html_conversion_stops_instead_of_finishing_in_the_background`, `HtmlToTextTests.Nested_tags_are_converted_in_linear_time`, `Input_beyond_the_size_cap_is_ignored`, `IntakeApiTests.Hostile_nested_html_upload_is_answered_quickly`, `A_user_who_exceeds_the_intake_request_budget_gets_429`.
- **Residual (deferred):** MsgReader and MimeKit parsing itself is still not cancellable (measured slow-but-bounded inputs: header-heavy mails under 3 s); the concurrency limit bounds the CPU they can use to 2 cores. Nested part headers inside a multipart are not size-checked. The memory copies (4 to 5 per upload) are unchanged; a streamed reader is the Info item SEC-25.

## SEC-03 Last-admin race (and SEC-17 deadlocks)

- **Fix:** `SetRolesAsync` and `SetActiveAsync` run in one transaction that first takes the exclusive transaction-owned application lock `MatterFlow.AdminGuard` (`AdminGuardLock`); the last-admin check, the write and the commit happen under it. A SQL deadlock victim (1205) becomes a retryable 409 `CONCURRENCY_CONFLICT` instead of a 500. Identity rows are updated set-based in `SetActiveAsync` so a concurrent sign-in cannot fail the save.
- **Tests:** `IdentityPrivilegeTests.Two_admins_deactivating_each_other_at_the_same_time_never_leave_zero_active_admins` and `Two_admins_revoking_each_others_role_at_the_same_time_never_leave_zero_admins` (6 rounds each, barrier-synchronized; both fail without the lock).

## SEC-04 Audit append-only enforcement

- **Fix:** `db/scripts/13-security-hardening.sql` (immutable after merge; see the numbering note below): creates the database roles `mf_app` and `mf_migrator` (unless a principal of that name exists), applies the audit permissions unconditionally (`INSERT, SELECT`; `DENY UPDATE, DELETE`; `DENY ALTER` for `mf_app`, which also denies TRUNCATE, trigger changes and DROP), makes `TRUNCATE TABLE` impossible for everybody with the empty guard table `dbo.AuditEventGuard` whose foreign key references `dbo.AuditEvent`, and adds a database DDL trigger against DROP TABLE of the audit tables and DROP/ALTER of the append-only trigger. The API checks at startup (`AuditStoreGuard`, `HAS_PERMS_BY_NAME`) that its own identity cannot UPDATE, DELETE or ALTER the audit table: Production refuses to start unless `Security:AllowPrivilegedDatabaseIdentity=true`, other environments log a warning. A missing `ConnectionStrings:Migrations` now logs a warning. `docs/runbook.md` section 3 documents the DBA step (map the login into `mf_app`), the separate migration login, and monitoring.
- **Tests (SchemaTests, `AuditProtectionSchemaTests`):** a real SQL login in `mf_app` can INSERT and SELECT but UPDATE, DELETE, TRUNCATE, DROP TRIGGER, DISABLE TRIGGER, ALTER TABLE, DROP TABLE, CREATE TABLE and reading the guard table fail; the `mf_migrator` role cannot rewrite rows; a privileged login cannot TRUNCATE or drop the audit objects or the guard foreign key; the startup probe returns 1 for sa and 0 for `mf_app`; ordinary DDL (new columns, other tables) still works. `AuditStoreGuardTests` covers the startup decision.
- **Honest limits:** SQL Server raises no DDL event for `DISABLE TRIGGER` or for dropping a DDL trigger, so sysadmin/db_owner can still disable the INSTEAD OF trigger deliberately; detection is a monitoring task (documented). An existing deployment whose app login is `sa` or db_owner will be refused in Production until it is switched to `mf_app`.

## SEC-05 ReDoS in form patterns (and SEC-21 text length)

- **Fix:** the portable subset now rejects (1) a repeated group (`*`, `+`, `{n,}`, `{n,m}` with m > 1, or `{n}` with n > 1) that contains, at any depth, a quantifier with min != max (`(a+)+`, `(a*)*`, `(a?){30}`, `(a{1,5}){1,5}`), (2) a repeated group containing an alternation (`(a|aa)+`, `(\w|\d)+`, `(?:png|jpg)*`), (3) two directly adjacent unbounded quantifiers (`a*a*`, `[A-Z]+[0-9]*`). Fixed counts inside groups (`(\d{3}-){2}`), optional groups (`(a+)?`, `(?:png|jpg)?`) and separated quantifiers (`\d+\.\d+`) stay valid. Implemented identically in `PortablePattern.cs`, `portable-pattern.ts` and the reference evaluator in `contracts/validate-contracts.mjs`; `contracts/form-rules.md` section 3.1 documents the rules; 19 vectors added (152 to 171). At evaluation time both engines never run a pattern outside the subset (no match, `PATTERN`; JavaScript has no regex timeout). .NET per-match timeout lowered to 100 ms and a 0.5 s regex budget per `Evaluate` call. The form designer also flags such patterns. `contractVersion` stays 1 (pre-release tightening).
- **SEC-21:** text-family fields without `maxLength` now default to 1,000 (TEXT), 2,000 (URL) and 20,000 (TEXTAREA) UTF-16 code units (`TOO_LONG`), in `.NET`, TypeScript and the reference evaluator; an explicit `maxLength` replaces the default.
- **Tests:** shared vectors in both stacks (`FormRulesVectorTests`, `evaluator.spec.ts`), `FormRulesEdgeCaseTests.Backtracking_hazard_patterns_are_rejected_at_publish`, `Safe_shapes_stay_in_the_subset`, `Slow_but_portable_pattern_times_out_as_no_match_and_does_not_hang`, `Regex_time_is_budgeted_per_evaluation_not_per_field` (40 fields: was 10 s), `Text_without_max_length_is_capped_by_the_platform_default`, `portable-pattern.spec.ts`.
- **Product owner:** the subset is deliberately conservative. Patterns that were allowed and are now rejected include `^\d+(,\d+)*$` and `^[A-Z]+[0-9]+$`; the designer message points to alternatives (`^[\d,]+$`, `^[A-Z]+\d{1,10}$`). A form published before this change with such a pattern keeps working as "never matches" (every value fails with `PATTERN`) until it is republished.

## SEC-06 / SEC-07 Bootstrap on a mutable name; unaudited privileged grants

- **Fix:** `Bootstrap:SystemAdmins` grants System Admin only while the system has no active System Admin (and once per user, as before); a listed name seen while an admin exists is logged at Warning and ignored. `USER_PROVISIONED`, `ADMIN_BOOTSTRAPPED` and `USER_IDENTITY_RENAMED` are written as audit events through `IAuditWriter`; the username refresh is a tracked save with an audit entry instead of an `ExecuteUpdate`. A failed provisioning retry discards the re-queued audit entries (`IAuditWriter.DiscardPending`) so a lost JIT race leaves no event for a user that was not created. A Windows identity without a SID (account-name fallback) logs a warning (SEC-24).
- **Tests:** `IdentityResolverTests.Provisioning_and_bootstrap_leave_audit_events`, `Concurrent_first_requests_write_exactly_one_provisioning_event_for_the_right_user`, `A_renamed_account_is_recorded`, `Bootstrap_is_not_applied_to_a_listed_name_while_an_active_system_admin_exists`, `A_recycled_account_name_does_not_inherit_system_admin`.
- **Product owner:** with several names in `Bootstrap:SystemAdmins`, only the first to sign in becomes admin (the others must be granted by that admin). If every admin is deactivated, a listed name that has not been bootstrapped yet can claim the role again (intended recovery path).

## SEC-08 Security headers (and SEC-19 configuration hygiene)

- **Fix:** `SecurityHeadersMiddleware` (first in the pipeline, so errors carry the headers): CSP (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, and `default-src 'none'` for `/api`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `Cache-Control: no-store` on `/api`; HSTS (1 year) outside Development; no `Server` banner. The Angular production build previously inlined critical CSS through `onload="this.media='all'"`, which this CSP blocks; `angular.json` now sets `inlineCritical: false` and the built `index.html` has no inline script or handler (verified). `style-src 'unsafe-inline'` remains because Angular component styles and PrimeNG inject style elements.
- **SEC-19:** `AllowedHosts` defaults to `localhost;127.0.0.1;[::1]` (production must set the real host name, documented in the runbook; an unset value fails loudly with 400); request bodies are capped at 2 MB for the JSON API by `RequestBodyLimitMiddleware` (intake uploads keep their own 10 MB limit); runbook example uses `Encrypt=True;TrustServerCertificate=False`; the dev compose file binds SQL Server to 127.0.0.1; the `Origin` claim in architecture 6.6 is corrected (only `Sec-Fetch-Site` and the custom header are checked).
- **Tests:** `SecurityHeadersTests` (headers on 200, 401, 404 and health in Development and a non-Development environment, API vs app CSP, HSTS only outside Development, unknown host refused, body limit middleware). The HSTS/headers tests run in the `Test` environment because a `Production` host needs Negotiate, which `TestServer` cannot provide.
- **Deferred:** global rate limiting of the JSON endpoints (only the intake endpoints are limited); `UseHttpsRedirection` (IIS binds HTTPS only; HSTS covers browsers).

## SEC-09 Mandatory row versions

- **Fix:** `rowVersion` is `[Required]` on user roles/status/profile, role update, form draft save and the publish query parameter; `SaveRoleRequest` is split into `CreateRoleRequest` (no version) and `UpdateRoleRequest`. The Angular designers read the current row version when they never loaded one. New architecture test `RowVersionRulesTests` fails when an update-style request lacks a required, non-nullable `RowVersion` (allow-list: `SetPrimaryPodRequest`, `ReorderRequest`). OpenAPI and the NSwag client were regenerated.
- **Tests:** `IdentityPrivilegeTests.User_and_role_updates_require_a_row_version`, `Stale_row_version_on_role_update_is_a_conflict`, `FormsApiTests.Saving_or_publishing_a_draft_without_a_row_version_is_rejected`, `RowVersionRulesTests`.

## SEC-10 Dev provider guard

- **Fix:** allow-list: `Auth:Provider=Dev` starts only when `ASPNETCORE_ENVIRONMENT` is `Development` or `Test`; any other name is refused at startup. The `?devUser=` query form exists in Development only (header only in `Test`). README, architecture and runbook updated.
- **Tests:** `AuthenticationSelectionTests.Dev_provider_is_refused_in_every_environment_that_is_not_development_or_test` (Staging, UAT, PreProd, `production` lower case, typo, empty), `RequestForgeryGuardTests.Dev_provider_cannot_be_enabled_in_any_other_named_environment`, `Dev_query_form_is_disabled_outside_development`.
- **Not done:** refusing Dev when a non-loopback URL is bound (the allow-list covers the real risk).

## SEC-11 Dependency advisories

- **Fix:** `System.Security.Cryptography.Pkcs` pinned to 10.0.13 in `Directory.Packages.props` (transitive pinning); `Microsoft.Data.SqlClient` 6.1.1 to 6.1.7. `dotnet list package --vulnerable --include-transitive` now reports nothing for every project. MimeKit 4.18.1 and MsgReader 6.2.0 are already the newest releases; HtmlAgilityPack was removed (SEC-02). The nightly workflow gets a `dependency-audit` job (fails on vulnerable NuGet packages, runs `npm audit --omit=dev --audit-level=high`).
- **Verification:** all unit, schema and integration tests pass on the bumped versions. SqlClient 7.x is a major bump and was not taken.

## SEC-12 ASSET_REF / USER_REF values are not checked (note for the Task module; no change made)

`FormValueRules.IsPositiveInteger` is the whole check, so a reference can point at nothing, at an asset of another Matter or at an inactive user. Suggested design, to be built with the Task module: an optional `IFormReferenceChecker` (implemented by Assets and Identity) called from `FormSubmissionValidator.Evaluate` for visible `ASSET_REF` / `USER_REF` fields with the owner's `MatterId`, producing `INVALID_REFERENCE` or `CROSS_MATTER_REFERENCE` (already defined in `ErrorCodes`). Note also SEC-23: the Task module must `Replace` (not `TryAdd`) the `IMatterTaskGuard` registration; the API now logs a warning at startup while the placeholder guard is registered.

## SEC-13 False 409 after cache expiry

- **Cause refined:** the review's suggested fixes (reload or a separate DbContext) do not help alone, because the sign-in bookkeeping itself changes `AppUser.RowVersion` inside the request that edits the user. **Fix:** the last-sign-in stamp moved to `UserIdentity.LastLoginAt` (script 13; written at most every 5 minutes), so sign-ins no longer touch the row an administrator edits; the resolver detaches what it loaded. `AppUser.LastLoginAt` is obsolete (kept for history); the users list shows the newest identity stamp.
- **Test:** `IdentityResolverTests.An_admin_editing_their_own_profile_right_after_the_cache_expired_succeeds`.

## SEC-14 Pod member details

`PodMemberDto.Email` and `Roles` are returned only to callers with `User.View` or `Pod.Manage`; others get null and an empty list. Test: `PodsApiTests.Pod_members_show_email_and_roles_only_to_callers_who_may_see_the_directory`.

## SEC-15 Read endpoints versus the matrix doc

Decision: the code is authoritative for this release. `docs/qa/permission-matrix-tests.md` now states that roles and the permission catalog are readable with `User.View`, lookups and task types with `Task.View`, form schemas with `Task.View`. Known limitation recorded: a user with `Asset.View` or a custom-field permission but without `Task.View` cannot load that form schema (every starter role holds `Task.View`). Owner-kind-aware read permissions are a follow-up.

## SEC-16 Duplicate keys

The three `Message.Contains("duplicate key")` checks use SQL error numbers 2601 and 2627. Guard: `SourceHygieneRulesTests.Duplicate_keys_are_never_detected_by_message_text`.

## SEC-17 Deadlocks and READ_COMMITTED_SNAPSHOT

The admin lock (SEC-03) removes the reproduced deadlock; a remaining 1205 maps to 409. RCSI cannot run inside a migration transaction: `docs/runbook.md` section 3 gives the DBA command and the API warns at startup when it is off (`DatabaseSettingsCheck`). A generic retry of other units of work was not added.

## SEC-18 Seeds

Seeds run under the session application lock `MatterFlow.Seed` (`SeedLock`), also when migrations are a separate step (`Migrations:Enabled=false`; `Seeds:Enabled=false` turns them off, and no connection string means no seeds), and the starter roles are recorded once in `dbo.SeedMarker` (script 13) instead of being inferred from "no custom role exists". An existing database with roles but no marker is marked, not re-seeded. Tests: `StartupSeedTests` (two instances starting together, seeds with migrations off, no resurrection after deleting every custom role, marker backfill).

## SEC-20 Audit text lengths

`AuditEvent.ClipToColumnLimits` cuts `EventType` (64), `ObjectType` (40), `ObjectId` (40), `FieldKey` (100) and `Summary` (500) with a trailing `...` before saving; `OldValue`/`NewValue` stay unlimited. Tests: `AuditEventClippingTests`.

## SEC-22 / SEC-23 / SEC-24 / SEC-25 / SEC-26 / SEC-27

- **SEC-22 Fixed:** `AssetService.GetAsync` uses the new non-creating `IFormDefinitionResolver.FindDefinitionIdAsync`.
- **SEC-23:** see SEC-12 (startup warning added; the Task module must replace the guard).
- **SEC-24 Noted:** whether Negotiate defers to IIS authentication still needs the planned Windows rehearsal (R-09, WIN-01..08). A Windows identity keyed on the account name (no SID) now logs a warning.
- **SEC-25 Noted:** no change (functional limit, not a vulnerability).
- **SEC-26 Fixed:** 405 returns `METHOD_NOT_ALLOWED`, 429 `TOO_MANY_REQUESTS`.
- **SEC-27 Fixed:** audit endpoint path corrected, `/client-log` marked as not implemented, `USER_PROVISIONED` and `ADMIN_BOOTSTRAPPED` are real audit events now.

## Items the project manager and product owner must decide or watch

1. **Script numbering:** `13-security-hardening.sql` leaves number 12 free for the Task module's `12-tasks.sql`. The runner fails on "a new script numbered lower than the highest applied one", so no persistent database should run script 13 before 12 is merged and applied.
2. **Production database identity:** the API now refuses to start in Production when its own database login can UPDATE, DELETE or ALTER `dbo.AuditEvent` (`sa`, `db_owner`). The DBA must map the app login into `mf_app` and provide `ConnectionStrings:Migrations`; `Security:AllowPrivilegedDatabaseIdentity=true` is the documented temporary exception.
3. **`AllowedHosts`** must be set to the real host name at deployment, and `maxAllowedContentLength` in IIS to 12 MB.
4. **Form pattern subset and default text lengths** (SEC-05, SEC-21) change what designers may publish and what users may type; communicate to form designers.
5. **Task module** (other developer): `IMatterTaskGuard` must be replaced, ASSET_REF/USER_REF validation (SEC-12), `rowVersion` mandatory on every update DTO (architecture test now enforces it for all modules), and new write endpoints should go through the existing `*Request` naming so the rule applies.
6. **Behavior changes visible to users:** a `User.Manage` holder can no longer deactivate System Admins; pod member e-mail and roles are hidden from callers without `User.View` or `Pod.Manage`; intake is limited to 30 uploads per minute per user.
