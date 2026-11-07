# Testing the Backend

[[_TOC_]]

**What this page is for.** The four backend test projects, what each is for, when to write which kind of test, how to run them and how the special suites (persona walk, architecture rules) work. Test strategy documents: `docs/qa/test-plan.md`, `docs/qa/permission-matrix-tests.md`, `docs/architecture.md` section 15.

## The four projects (`backend/tests/`)

| Project | Needs Docker | Speed | What it proves |
|---|---|---|---|
| `MatterFlow.UnitTests` | No | Fast | Pure rules and services with mocks: lifecycle state machine, due dates, availability evaluator, holiday rules, capacity and coverage maths, form rule engine and validator, rich HTML sanitiser, email parsers, search ranking, permission catalog equality, web.config. Folders mirror the modules (`Identity/`, `WorkManagement/`, `SharedKernel/`, ...) |
| `MatterFlow.ArchitectureTests` | No | Fast | Module dependency graph, controller policies, audit scope, rowVersion on updates, visibility source allow-lists, source hygiene (uses NetArchTest and reads csproj files) |
| `MatterFlow.SchemaTests` | Yes | Medium | The schema runner (order, checksum, rollback, concurrency, `GO` splitting) and each script's tables, constraints, triggers and permissions on a real SQL Server (one `*SchemaTests.cs` per area) |
| `MatterFlow.IntegrationTests` | Yes | Slow (about 5 minutes in CI) | The real API against a real migrated SQL Server with Dev authentication, through HTTP: endpoints, permissions, concurrency, audit, visibility |

Frameworks: xUnit, Shouldly, NSubstitute, Testcontainers.MsSql, `Microsoft.AspNetCore.Mvc.Testing`, NetArchTest.Rules, coverlet.

## Commands (run in `backend/`)

```
dotnet test tests/MatterFlow.UnitTests              # fast, no Docker
dotnet test tests/MatterFlow.ArchitectureTests      # fast, no Docker
dotnet test                                         # everything (starts SQL Server containers)
dotnet test tests/MatterFlow.IntegrationTests --filter "FullyQualifiedName~Sensitive"
```

CI runs unit and architecture tests in the `backend` job and schema and integration tests in the `backend-integration` job (see [Continuous Integration](../Getting-Started/Continuous-Integration.md)). `nightly.yml` runs all four weekly.

## Which kind of test do I write?

| Change | Write |
|---|---|
| A pure rule, parser, formatter, state machine | A unit test in `UnitTests/<Module>/` |
| A new endpoint or permission | An integration test: call it as a user with and without the permission (see `Tasks/TaskPermissionMatrixTests.cs`) |
| A new script, table, trigger or constraint | A schema test (model: `ProductionsNotesSchemaTests.cs`) |
| A new module reference, controller or matter-owned entity | Nothing new: the architecture tests catch mistakes; update `AllowedContracts` for a new module |
| A new endpoint touching matter data | Classify it in `SensitiveAccessCatalog` (the catalog test fails otherwise) |

## Integration test building blocks (`IntegrationTests/Fixtures`)

- `SqlServerFixture` starts one SQL Server container (random port) per collection; `CreateMigratedDatabaseAsync` makes a database with every script applied (the production path); each test class gets its own database.
- `DatabaseApiFactory` hosts the real API on that database with the Dev provider; choose the caller with the `X-Dev-User` header. Options: environment, starter configuration seeding, dashboard cache seconds, read timeout, a fake clock, extra configuration values, a command-counting interceptor.
- `NoDatabaseApiFactory` hosts the API without a database (smoke tests, headers, SPA hosting).
- Harnesses per area: `Tasks/TaskHarness.cs`, `Fixtures/PmScopeFixture.cs`, `Fixtures/SensitiveUniverse.cs` (the world of the persona walk).
- Test-only controllers (`TestProtectedController`, `VisibilityProbeController`) provide protected endpoints for infrastructure tests.

## Special suites

- **Persona walk (Sensitive matters)** in `IntegrationTests/Security`: `SensitiveAccessCatalog` classifies every endpoint; `PersonaWalk` calls every catalogued GET as six personas and compares hidden and missing ids byte for byte; mutation tests prove immediate revocation and that the walk is not vacuous. Details: [Sensitive Matter Visibility](../Architecture/Sensitive-Matter-Visibility.md).
- **Architecture rules** in `ArchitectureTests`: see [Backend Modules](../Architecture/Backend-Modules.md).
- **Report access catalogue**: a unit test fails for a table not classified in `db/report-access.json` and when the GRANT and DENY lines differ from the file; a schema test checks the effective permissions of `mf_report_reader`. `SqlServerFixture.CreateServerLoginAsync` creates the report login the way the provisioning does, including the user in `master` with `DENY EXECUTE` on the `xp_` procedures `PUBLIC` may run (issue #1292); pass `denyServerProcedures: false` to test a login without it (`ReportLoginProbeTests` expects the warning, `ReportLoginRightsTests` proves the procedures are callable without the deny and refused with it).
- **Permission catalog**: `UnitTests/Identity/PermissionCatalogTests` keeps JSON, C# constants and the Angular list equal.
- **Contract vectors**: `contracts/form-rules.vectors.json` is run unchanged by the .NET and TypeScript suites.

## Tips

- Integration and schema tests need Docker; in the cloud container start the daemon first ([Cloud Container Notes](../Getting-Started/Cloud-Container-Notes.md)). They are heavy on disk and CPU; run only the filter you need.
- A failing architecture test message names the rule and the project or file to fix.
- Do not make a test pass by editing an allow-list without a review reason; the lists carry a reason per entry.

## Related pages

- [Testing the Frontend](../Frontend/Testing-the-Frontend.md)
- [Commands](../Getting-Started/Commands.md)
- [How to Add an Endpoint](How-to-Add-an-Endpoint.md)

Last verified against commit cf50a0a.
