# Conventions

[[_TOC_]]

**What this page is for.** The naming, layout and style rules of the repository in one place, so new code looks like the old code. Rules are taken from `.editorconfig`, `backend/Directory.Build.props`, `docs/architecture.md` section 11, `docs/ux/design-guidelines.md` and the code; where the repository has no written rule, the page says "observed".

## Repository and formatting

| Topic | Rule |
|---|---|
| Encoding and line ends | UTF-8, LF (`.cmd` and `.bat` are CRLF); final newline; trim trailing whitespace (not in `.md`) |
| Indentation | 2 spaces by default; C#, SQL and csproj as in `.editorconfig` (C# and SQL 4, csproj 2) |
| C# | .NET 10, C# 14, nullable enabled, implicit usings, file-scoped namespaces (warning), `using` outside the namespace, `var` where the type is apparent; warnings are errors in CI (`TreatWarningsAsErrors` when `CI=true`), code style enforced in build |
| NuGet | Versions only in `backend/Directory.Packages.props` |
| TypeScript and templates | Prettier formatting (`npm run format:check`), ESLint (`angular-eslint`), strict TypeScript |
| Comments | Code comments explain why and cite the issue or decision (`epic #788`, `decision AS item 12`) |

## Backend

| Topic | Rule |
|---|---|
| Module layout | `Domain/`, `Application/`, `Infrastructure/`, `Api/`; public surface in `.Contracts`; composition `Add<Module>Module` |
| Dependencies | Only SharedKernel and other modules' Contracts ([Backend Modules](../Architecture/Backend-Modules.md)) |
| Entities | No navigation properties across modules; scalar ids; domain types free of EF |
| Services | Return `Result<T>`; no exceptions for business failures; controllers only map |
| DTOs | Records with `[Required]` and length attributes; update requests carry `RowVersion` |
| Authorization | `Perm:<code>` policy on every action; never role names |
| Time | `IClock` and the firm time helpers only; no `DateTime.Now` |
| Controllers | Route `api/v1/<plural-kebab>`; non-CRUD actions as sub-resource POSTs; `Name = "..."` on every HTTP attribute |
| Tests | Names are sentences with underscores in tests (`Every_endpoint_operation_is_classified_...`); CA1707 is off for tests |

## API (see `docs/architecture.md` section 11)

- JSON camelCase; enums as strings; ids as numbers; dates `yyyy-MM-dd`; instants ISO 8601 UTC with `Z`; `rowVersion` as a base64 string.
- Matter references always carry both parts: `clientNumber`, `matterNumber`, `matterRef` (`00343-00012`). Number inputs accept 1 to 5 digits and are normalised (400 `INVALID_NUMBER_FORMAT`).
- Paging `page` (1 based) and `pageSize` (default 25, max 100) returning `{items, total, page, pageSize}`; audit uses keyset paging (`afterId`). Sorting `sort=priority,-dueAt`; unknown filters or parameters are 400.
- Errors are `application/problem+json` with `type` `urn:matterflow:error:<code-in-kebab-case>`, `code`, `traceId`, optional `errors` and `meta`.

### Error codes (constants in `backend/src/MatterFlow.SharedKernel/Results/ErrorCodes.cs`)

UPPER_SNAKE_CASE, stable once released (clients and tests depend on them). Families seen: validation (`VALIDATION_FAILED`, `FORM_VALIDATION_FAILED`, `INVALID_NUMBER_FORMAT`), access (`UNAUTHENTICATED`, `ACCESS_PENDING`, `ACCOUNT_DISABLED`, `PERMISSION_DENIED`), existence and conflict (`NOT_FOUND`, `CONCURRENCY_CONFLICT`, `DUPLICATE_NUMBER`, `DUPLICATE_NAME`), state rules (`MATTER_INACTIVE`, `INVALID_STATUS_TRANSITION`, `COMPLETION_BLOCKED`, `TASK_NOT_EDITABLE`, ...), limits (`PAYLOAD_TOO_LARGE`, `QUERY_TOO_LARGE`, `QUERY_TIMEOUT`), Sensitive matter (`SENSITIVE_CONFIRMATION_REQUIRED`, `SENSITIVE_NEEDS_MANAGER`) and codes owned by a module (for example the absence codes in `Identity/Application/AbsenceService.cs`). `ErrorCodes.cs` holds the shared ones (62 constants); the list in `docs/architecture.md` section 11 may lag the code.

## Database

See [Database Overview](../Database/Overview.md): singular PascalCase tables, `<Table>Id` keys, explicit constraint names with prefixes, `datetime2` UTC times, `bit` flags, `char(5)` business numbers, JSON with `ISJSON` checks, standard audit columns and `RowVersion`, scripts `NN-kebab-description.sql`.

## Frontend

| Topic | Rule |
|---|---|
| Components | Standalone, `OnPush`, signals; selectors `mf-<name>`; features never import features |
| Files | kebab-case; `*-page.ts`, `*.routes.ts`, spec beside the file |
| Tokens | Colours, sizes, radii, shadows from `docs/ux/tokens.css`; icon sizes 12, 16, 18, 20 px (24 px only in state blocks); no literals |
| Control heights | 36 px (32 px in grid cells and filter rows); text buttons 24 px |
| Toasts | `NotificationService` only; PrimeNG `MessageService` is banned by lint |
| Storage | `localStorage` only for per-person preferences, always in try/catch; never matter data |

### Title Case rule (D-20)

**Click it or name it = Title Case. Read it = sentence case.** Short prepositions stay lowercase ("Produced by Us"). Buttons, menu items, tab names, page and dialog titles, column headers, record names and chip labels are Title Case ("Task Queue", "Clear Filters"). Sentences, help text, empty-state text and tooltips are sentence case. A guard spec (`capitalisation-guard.spec.ts`) checks it. Word list: `docs/ux/design-guidelines.md` section 4.4 (CM Number, Last Updated, Created, Progress, Primary PM, Secondary PM, Assignee, Task Queue, Out of Office, Retry).

### Dates and numbers (D-60 to D-62)

- Dates in data: `MM/DD` this year, `MM/DD/YYYY` otherwise. Instants: `MM/DD hh:mm AM/PM` (12-hour, in the person's time zone). The long form with the full month only in tooltips and sentences. Helpers: `shared/ui/numeric-date.ts`, `core/time/time.ts`, `mfDateLong`.
- Numbers: thousands comma (`1,234`), percent `37%`, duration `2 h 48 m`, size `1.2 MB` (base 1024, one decimal), range `1-50 of 143`, counts in tab labels `(372)`. Helpers: `shared/ui/number-format.ts`, pipe `mfInt`.
- Person names: display name, else the account without the domain (`shortAccountName`); never `KE\account` in a grid.
- Button order: Cancel on the left, primary action last, Delete far left. Toast titles name the thing ("Role saved").

## Commit and docs

Commit message formats: [Branching and Workflow](../Getting-Started/Branching-and-Workflow.md). Plain English in docs; short sentences; keep guideline, code and wiki in step.

**Screenshots.** Do not commit screenshots to `dev`, `main` or a feature branch. Put evidence for UI work on the `design-evidence` branch (`evidence/<yyyy-mm-dd>-<issue-or-review>/`, at most 15 compressed images per issue, about 150 KB each) and link it from the issue comment. See [Branching and Workflow](../Getting-Started/Branching-and-Workflow.md).

## Related pages

- [UI Standard](../Frontend/UI-Standard.md)
- [Find Things](../How-To/Find-Things.md)
- [Request Lifecycle](../Architecture/Request-Lifecycle.md)

Last verified against commit c4bfdaf.
