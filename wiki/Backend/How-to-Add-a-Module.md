# How to Add a Module

[[_TOC_]]

**What this page is for.** The steps to create a new backend module so that it builds, is composed into the host and passes the architecture tests. Adding a module is rare; most features belong to an existing module. The pattern is the Notes module (`backend/src/Modules/LptHub.Notes` and `LptHub.Notes.Contracts`).

## Steps

1. **Decide you need one.** A module owns a set of tables and a coherent responsibility. If it only adds endpoints on existing tables, extend the owning module instead. Check `docs/architecture.md` section 5 and [Backend Modules](../Architecture/Backend-Modules.md).
2. **Create the two projects** under `backend/src/Modules/`:
   - `LPT Hub.<Module>.Contracts/LPT Hub.<Module>.Contracts.csproj` with only a reference to `LptHub.SharedKernel`, and a marker class `<Module>ContractsMarker` (`public sealed class NotesContractsMarker;`). The architecture tests look the marker up by name.
   - `LPT Hub.<Module>/LPT Hub.<Module>.csproj` referencing `LptHub.SharedKernel`, its own Contracts, and **only the Contracts** of modules it needs. Add `<InternalsVisibleTo Include="LptHub.UnitTests" />` and the packages it needs (EF Core Relational, SqlClient). Folders: `Domain/`, `Application/`, `Infrastructure/`, `Api/`.
   - `backend/src/Modules/Directory.Build.props` already adds the ASP.NET Core framework reference to non-Contracts projects.
3. **Add a composition class** `<Module>Module.cs` with `public static IServiceCollection Add<Module>Module(this IServiceCollection services)` that calls `services.AddControllers().AddApplicationPart(typeof(<Module>Module).Assembly)` and registers services. The type name `<Module>Module` is required by the architecture tests.
4. **Register it in the host:**
   - Add the call to `backend/src/LptHub.Api/ModuleComposition.cs` (`services.AddNotesModule();`).
   - Add a `ProjectReference` in `backend/src/LptHub.Api/LptHub.Api.csproj`.
   - If the module owns entities: add `typeof(<Module>Module).Assembly` to `backend/src/LptHub.Data/ModuleAssemblies.cs` and a project reference from `LptHub.Data.csproj` (the DbContext finds `IEntityTypeConfiguration` classes there).
5. **Add the projects to `backend/LptHub.sln`.**
6. **Teach the tests about it:**
   - `backend/tests/LptHub.ArchitectureTests/ModuleDependencyRulesTests.cs`: add the module and its allowed Contracts dependencies to `AllowedContracts`.
   - Add project references from `LptHub.ArchitectureTests.csproj` and `LptHub.UnitTests.csproj` (follow the other modules).
   - Add a folder `backend/tests/LptHub.UnitTests/<Module>/`.
7. **Tables:** add a numbered SQL script and the `db/report-access.json` entries ([How to Change the Schema](../Database/How-to-Change-the-Schema.md)).
8. **Endpoints:** each action needs a policy; classify every endpoint in `SensitiveAccessCatalog.cs` ([How to Add an Endpoint](How-to-Add-an-Endpoint.md)).
9. **Permissions:** [How to Add a Permission](How-to-Add-a-Permission.md).
10. **Docs and wiki:** update `docs/architecture.md` section 5.1 (module table) and the diagram in section 5.2, [Backend Modules](../Architecture/Backend-Modules.md) (diagram and table), [Module Guide](Module-Guide.md), [Feature Map](../Features/Feature-Map.md).

## Rules the tests enforce

- The module references only SharedKernel and allowed `.Contracts` projects; no cycles.
- `.Contracts` projects reference only SharedKernel and expose no Domain, Infrastructure or EF types.
- `Domain` has no EF dependency.
- Controllers have policies; no role names in authorization.

## Related pages

- [Backend Modules](../Architecture/Backend-Modules.md)
- [Testing the Backend](Testing-the-Backend.md)

Last verified against commit cf50a0a.
