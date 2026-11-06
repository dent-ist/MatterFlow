# How to Add an Endpoint

[[_TOC_]]

**What this page is for.** The steps and file locations for adding an HTTP endpoint to an existing module, from the controller to the tests and the generated client. The example pattern is `OnHoldReasonsController` and `OnHoldReasonService` in `backend/src/Modules/MatterFlow.Configuration`.

## Steps

1. **Find the owning module.** Use the [Module Guide](Module-Guide.md) or the [Feature Map](../Features/Feature-Map.md). If the endpoint needs data of another module, use that module's `.Contracts` interface; do not reference its internals.
2. **Write the DTOs** in the module's `Application/` folder as records with data annotations (`[Required]`, `[StringLength]`). Rules:
   - Response and request types are explicit records, never entities.
   - An update request carries a required, non-nullable `RowVersion` (base64 string); the architecture test `RowVersionRulesTests` fails otherwise.
   - JSON is camelCase, enums are strings, dates `yyyy-MM-dd`, instants UTC with `Z`.
3. **Write or extend the service** (`Application/`). It returns `Result<T>` (`SharedKernel/Results`) with a stable error from `Error.NotFound`, `Error.Validation(field, code, message)` and so on. Business rules, validation and the audit write belong here, not in the controller. The service uses the module's `DbContext` through `Set<Entity>()`.
   - Load through the visible source when the data belongs to a matter ([Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md)).
   - For updates use the row version: parse it, compare, and set it as the original value (see `LookupSupport.ParseRowVersion`, `VersionMatches`, `ExpectVersion`). A mismatch returns 409 `CONCURRENCY_CONFLICT`.
   - Register the service in the module's `Add<Module>Module` (`services.AddScoped<MyService>()`).
4. **Add the controller action** in the module's `Api/` folder:
   ```csharp
   [HttpPut("{id:int}", Name = "UpdateOnHoldReason")]
   [Authorize(Policy = ConfigurationPolicies.OnHoldReasonManage)]
   [ProducesResponseType<OnHoldReasonView>(StatusCodes.Status200OK, "application/json")]
   public async Task<ActionResult<OnHoldReasonView>> Update(int id, [FromBody] UpdateOnHoldReasonRequest request, CancellationToken ct) =>
       (await reasons.UpdateAsync(id, request, ct)).OrThrow();
   ```
   - Route base `api/v1/<plural-kebab-resource>`; non-CRUD actions are sub-resource POSTs (`POST /tasks/{id}/status`).
   - **Every action needs a policy**: `[Authorize(Policy = "Perm:" + Permissions.X.Y)]` (or a constant built that way), alternatives with `|`. Use `[AllowAuthenticated]` or `[AllowAnonymous]` only for the allow-listed cases ([Authentication and Authorization](../Architecture/Authentication-and-Authorization.md)). The architecture test fails otherwise, and also fails for a permission code that is not in the catalog.
   - Give the HTTP attribute a stable `Name = "..."`: it becomes the generated TypeScript method name.
   - `.OrThrow()` turns a failed `Result` into the problem details response (via `ErrorResultFilter`).
   - Controllers hold no business logic.
5. **Sensitive matter rule.** If the endpoint touches matter, task, project, asset, note or production data, follow [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md): classify it in `SensitiveAccessCatalog.cs`, and review any new direct read in `VisibilitySourceRulesTests.cs`.
6. **Rate limits and timeouts.** Heavy read endpoints (queues, search, dashboard, audit) get the 15 second read timeout through `ReadQueryTimeoutFilter` (applies to the existing controllers it names); per-user rate limits are in `ApiRateLimiting.cs`.
7. **Regenerate the contract.** `dotnet build -warnaserror` rewrites `contracts/openapi/v1.json`; then `cd frontend && npm run api:generate`. Commit both ([API Contracts](../Architecture/API-Contracts.md)).
8. **Tests.** Add an integration test (Docker) that calls the endpoint through `DatabaseApiFactory`; add a unit test for pure rules. See [Testing the Backend](Testing-the-Backend.md).
9. **Frontend** (if a screen uses it): [How to Add a Page](../Frontend/How-to-Add-a-Page.md) and [API Client and Generated Code](../Frontend/API-Client-and-Generated-Code.md).
10. **Wiki.** Update the [Feature Map](../Features/Feature-Map.md) and the [Module Guide](Module-Guide.md) if the endpoint group is new.

## Checklist

- [ ] Policy on every action; permission exists in `contracts/permissions.json`
- [ ] Update requests carry `rowVersion`; 409 handled
- [ ] Errors use stable codes (add new codes to `SharedKernel/Results/ErrorCodes.cs` and `docs/architecture.md` section 11)
- [ ] Audit event written where something meaningful changes ([How to Add an Audit Event](How-to-Add-an-Audit-Event.md))
- [ ] Sensitive matter rule applied and endpoint classified
- [ ] OpenAPI document and generated client regenerated and committed
- [ ] Tests added; `dotnet format --verify-no-changes` passes

## Related pages

- [Request Lifecycle](../Architecture/Request-Lifecycle.md)
- [How to Add a Permission](How-to-Add-a-Permission.md)
- [Add a Feature End to End](../How-To/Add-a-Feature-End-to-End.md)

Last verified against commit cf50a0a.
