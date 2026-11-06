# Request Lifecycle

[[_TOC_]]

**What this page is for.** What happens to one HTTP request, in order: middleware, authentication, authorization policy, filters, controller, application service, database and the response. Also the error format and the `rowVersion` concurrency rule. The order below is read from `backend/src/MatterFlow.Api/Program.cs`.

## Pipeline order

| # | Step | Where | What it does |
|---|---|---|---|
| 1 | HSTS (not in Development) | `Program.cs` | Browsers use HTTPS for a year |
| 2 | `SecurityHeadersMiddleware` | `Http/SecurityHeadersMiddleware.cs` | Security headers on every response, also errors |
| 3 | `RequestBodyLimitMiddleware` | `Http/` | Caps JSON bodies at 2 MB (uploads raise their own limit) |
| 4 | `QueryLimitMiddleware` | `Http/ApiRateLimiting.cs` | Rejects a too long query string with 400 `QUERY_TOO_LARGE` |
| 5 | Exception handler and status code pages | `GlobalExceptionHandler` | Maps exceptions to problem details |
| 6 | Static files (when the SPA is served) | `Hosting/SpaHosting.cs` | Serves the Angular build from `wwwroot` |
| 7 | `RequestForgeryGuard` | `Http/RequestForgeryGuard.cs` | Every state-changing request (not GET, HEAD, OPTIONS, TRACE) under `/api` must carry `X-MatterFlow-Client: web` (the Angular `csrfInterceptor` adds it); bodies must be JSON or multipart; a cross-site `Sec-Fetch-Site` is refused with 403 |
| 8 | Authentication | Identity module | Windows (Negotiate) in production, `Dev` handler in Development and Test |
| 9 | Authorization | `AccessAuthorizationHandler` | Evaluates the `Perm:` policy of the endpoint (see below) |
| 10 | Rate limiter | `Http/ApiRateLimiting.cs` | Per-user budgets per minute (all calls, comments, task writes, search, audit, dashboard) |
| 11 | MVC filters | Identity and Api | `ViewerPreparationFilter`, `ReadQueryTimeoutFilter` (15 s read timeout on the heavy reads), `ErrorResultFilter` |
| 12 | Controller action | module `Api/` folder | Maps the DTO to a command, calls the application service |
| 13 | Application service | module `Application/` | Validates (FluentValidation), applies business rules and the visibility rule, uses the DbContext |
| 14 | `MatterFlowDbContext.SaveChanges` | `MatterFlow.Data` | Interceptors stamp audit columns and write `AuditEvent` rows in the same transaction |
| 15 | Response | `Result` or DTO | Success JSON, or `application/problem+json` |

Health checks (`/health/live`, `/health/ready`), the OpenAPI document and Swagger (Development) are mapped before the controllers and are anonymous.

## Sequence

::: mermaid
sequenceDiagram
  participant B as Browser (Angular)
  participant M as Middleware
  participant A as Auth and policy
  participant C as Controller
  participant S as Application service
  participant D as DbContext and interceptors
  participant Q as SQL Server

  B->>M: PUT /api/v1/tasks/42 with rowVersion
  M->>M: security headers, body limit, forgery guard
  M->>A: authenticate (Windows or Dev)
  A->>A: resolve user snapshot, check Perm policy
  alt not allowed
    A-->>B: 401 or 403 problem+json
  else allowed
    A->>C: invoke action
    C->>S: command (DTO mapped)
    S->>S: validate, load through visibility rule
    S->>D: change entity (original rowVersion set)
    D->>Q: UPDATE where RowVersion matches, INSERT AuditEvent
    alt rowVersion changed by someone else
      Q-->>D: 0 rows updated
      D-->>B: 409 CONCURRENCY_CONFLICT
    else ok
      Q-->>D: committed
      D-->>S: saved
      S-->>C: Result with new rowVersion
      C-->>B: 200 JSON
    end
  end
:::

## Authentication and the policy

- Each controller action carries `[Authorize(Policy = "Perm:<code>")]` (written with the `Permissions` constants, for example `"Perm:" + Permissions.Task.Create`), or `[AllowAuthenticated]` for the few endpoints open to any signed-in user (`GET /api/v1/me`), or `[AllowAnonymous]` for the allow-listed ones. An action with no policy gets the fail-closed default (`FailClosedConvention`: active, non-pending user).
- A policy name may list alternatives: `Perm:Client.View|Matter.View` means any one of them is enough.
- `PermissionPolicyProvider` builds the policy from the name on demand. `AccessAuthorizationHandler` loads the user snapshot (cached per process for `Authorization:CacheSeconds`, default 60 s) and fails with a reason: `ACCESS_PENDING`, `ACCOUNT_DISABLED` or `PERMISSION_DENIED:<code>`. `AuthorizationResultHandler` turns that into the 401 or 403 problem.
- Details: [Authentication and Authorization](Authentication-and-Authorization.md).

## Error format

Errors are RFC 9457 `application/problem+json`:

```json
{ "type": "urn:matterflow:error:invalid-status-transition", "title": "Invalid status transition",
  "status": 409, "code": "INVALID_STATUS_TRANSITION", "detail": "...", "traceId": "00-...",
  "errors": { "fieldKey": [ { "code": "REQUIRED", "message": "..." } ] }, "meta": { } }
```

- Application services return a `Result` / `Error` (`SharedKernel/Results`). Module controllers return `new ObjectResult(error)` and `ErrorResultFilter` turns it into problem details (modules cannot reference the host's `Problems` helper).
- `GlobalExceptionHandler` maps: `ErrorException` to its error; `DbUpdateConcurrencyException` and SQL deadlocks to 409 `CONCURRENCY_CONFLICT`; a read command timeout to 503 `QUERY_TIMEOUT`; anything else to 500 `INTERNAL_ERROR` with a `traceId` and no internals.
- Framework problems (404, 401, 415) get the same `code`, `type` and `traceId` through `AddProblemDetails`.
- Model binding errors become 400 `VALIDATION_FAILED` with an `errors` map (`Problems.FromModelState`).
- The stable error codes are constants in `SharedKernel/Results/ErrorCodes.cs` and are listed in `docs/architecture.md` section 11. The frontend maps problem details to a typed error in `core/http`.

## Concurrency with rowVersion

- Tables that users edit have a SQL `rowversion` column named `RowVersion`, mapped as a concurrency token by `ModelConventions`.
- DTOs expose it as a base64 string. Every update request must send the `rowVersion` it was based on (the architecture test requires a non-nullable `rowVersion` on update requests). The service sets it as the original value; if the row changed, EF raises `DbUpdateConcurrencyException` and the client gets 409 `CONCURRENCY_CONFLICT`; the UI offers to reload.
- Workflow and lifecycle commands also lock the Task row (`UPDLOCK, ROWLOCK`) inside the transaction so two completions evaluate one after the other. `READ_COMMITTED_SNAPSHOT` is on (script 01) so readers do not block writers.
- Every write returns the updated resource with its new `rowVersion`.

## Transactions and audit

`AuditSaveChangesInterceptor` writes field-level `FIELD_CHANGED` events for entities marked `[Audited]` and the explicit events queued through `IAuditWriter`, in the same transaction as the change. A failing audit write fails the business operation. See [Notifications Audit and Settings](Notifications-Audit-and-Settings.md).

## Related pages

- [Backend Modules](Backend-Modules.md)
- [How to Add an Endpoint](../Backend/How-to-Add-an-Endpoint.md)
- [Conventions](../Reference/Conventions.md)

Last verified against commit ba461d2.
