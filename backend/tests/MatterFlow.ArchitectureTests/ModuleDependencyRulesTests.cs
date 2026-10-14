using System.Xml.Linq;
using NetArchTest.Rules;
using Shouldly;

namespace MatterFlow.ArchitectureTests;

/// <summary>
/// Enforces the module dependency rules of docs/architecture.md section 5.2:
/// a module may reference only SharedKernel and other modules' .Contracts projects, following the
/// layer arrows (no cycles); only WorkViews/Search (query side), Data and Api may reference module internals.
/// The allowed graph is checked against the actual csproj ProjectReferences, so the rule holds even
/// before a project contains any code.
/// </summary>
public class ModuleDependencyRulesTests
{
    private const string SharedKernel = "MatterFlow.SharedKernel";

    /// <summary>Allowed Contracts dependencies per module (the arrows in the section 5.2 diagram).</summary>
    private static readonly Dictionary<string, string[]> AllowedContracts = new()
    {
        ["Identity"] = [],
        ["Audit"] = [],
        ["Configuration"] = ["Identity", "Audit"],
        ["Organization"] = ["Configuration", "Identity", "Audit"],
        ["Assets"] = ["Configuration", "Organization", "Identity", "Audit"],
        ["WorkflowEngine"] = ["Configuration", "Identity", "Audit"],
        ["WorkManagement"] = ["Organization", "Assets", "WorkflowEngine", "Configuration", "Identity", "Audit"],
        ["WorkViews"] = ["WorkManagement", "Organization", "Assets", "WorkflowEngine", "Configuration", "Identity"],
        ["Search"] = ["WorkManagement", "Organization", "Assets", "Configuration"],
        ["Intake"] = [],
    };

    /// <summary>Query-side modules may additionally read other modules' internals (rule 3) and use the DbContext.</summary>
    private static readonly string[] QuerySide = ["WorkViews", "Search"];

    public static TheoryData<string> ModuleNames() => new(AllowedContracts.Keys);

    [Theory]
    [MemberData(nameof(ModuleNames))]
    public void Module_project_references_only_allowed_projects(string module)
    {
        var refs = ProjectReferences($"src/Modules/MatterFlow.{module}/MatterFlow.{module}.csproj");
        var allowed = new HashSet<string> { SharedKernel, $"MatterFlow.{module}.Contracts" };
        foreach (var dep in AllowedContracts[module])
        {
            allowed.Add($"MatterFlow.{dep}.Contracts");
            if (QuerySide.Contains(module))
                allowed.Add($"MatterFlow.{dep}");
        }

        if (QuerySide.Contains(module))
            allowed.Add("MatterFlow.Data");

        refs.ShouldBeSubsetOf(allowed, $"{module} references a project it must not depend on (architecture 5.2)");
    }

    [Theory]
    [MemberData(nameof(ModuleNames))]
    public void Contracts_project_references_only_shared_kernel(string module)
    {
        var path = $"src/Modules/MatterFlow.{module}.Contracts/MatterFlow.{module}.Contracts.csproj";
        if (!File.Exists(Path.Combine(RepoBackendRoot(), path)))
            return; // leaf modules (WorkViews, Search, Intake) have no Contracts project

        ProjectReferences(path).ShouldBeSubsetOf([SharedKernel]);
    }

    [Fact]
    public void Shared_kernel_references_no_other_matterflow_project()
    {
        ProjectReferences("src/MatterFlow.SharedKernel/MatterFlow.SharedKernel.csproj").ShouldBeEmpty();
    }

    [Fact]
    public void Module_dependency_graph_has_no_cycles()
    {
        var visiting = new HashSet<string>();
        var done = new HashSet<string>();

        void Visit(string module)
        {
            if (done.Contains(module))
                return;
            visiting.Add(module).ShouldBeTrue($"Dependency cycle detected at {module}");
            foreach (var dep in AllowedContracts[module])
                Visit(dep);
            visiting.Remove(module);
            done.Add(module);
        }

        foreach (var m in AllowedContracts.Keys)
            Visit(m);
    }

    [Fact]
    public void Only_data_api_and_query_side_modules_reference_module_internals()
    {
        var projects = Directory.GetFiles(Path.Combine(RepoBackendRoot(), "src"), "*.csproj", SearchOption.AllDirectories);
        foreach (var file in projects)
        {
            var name = Path.GetFileNameWithoutExtension(file);
            var module = name.Replace("MatterFlow.", "");
            if (name is "MatterFlow.Api" or "MatterFlow.Data" || QuerySide.Contains(module))
                continue;

            foreach (var r in ReferencesOf(file))
            {
                var isInternal = AllowedContracts.Keys.Any(m => r == $"MatterFlow.{m}" && r != name);
                isInternal.ShouldBeFalse($"{name} references the internals of {r}; use {r}.Contracts");
            }
        }
    }

    [Fact]
    public void Contracts_assemblies_do_not_depend_on_module_internals()
    {
        foreach (var module in AllowedContracts.Keys.Where(m => !QuerySide.Contains(m) && m != "Intake"))
        {
            var contractsAssembly = Type.GetType($"MatterFlow.{module}.Contracts.{module}ContractsMarker, MatterFlow.{module}.Contracts");
            contractsAssembly.ShouldNotBeNull();

            var result = Types.InAssembly(contractsAssembly.Assembly)
                .That().ResideInNamespace($"MatterFlow.{module}.Contracts")
                .ShouldNot().HaveDependencyOnAny($"MatterFlow.{module}.Domain", $"MatterFlow.{module}.Infrastructure", "Microsoft.EntityFrameworkCore")
                .GetResult();

            result.IsSuccessful.ShouldBeTrue($"{module}.Contracts must not expose internals or EF types");
        }
    }

    [Fact]
    public void Domain_types_do_not_depend_on_entity_framework()
    {
        foreach (var module in AllowedContracts.Keys)
        {
            var type = Type.GetType($"MatterFlow.{module}.{module}Module, MatterFlow.{module}");
            type.ShouldNotBeNull();

            var result = Types.InAssembly(type.Assembly)
                .That().ResideInNamespaceStartingWith($"MatterFlow.{module}.Domain")
                .ShouldNot().HaveDependencyOn("Microsoft.EntityFrameworkCore")
                .GetResult();

            result.IsSuccessful.ShouldBeTrue($"{module}.Domain must be free of EF types (architecture 5.3)");
        }
    }

    private static HashSet<string> ProjectReferences(string relativePath) =>
        ReferencesOf(Path.Combine(RepoBackendRoot(), relativePath));

    private static HashSet<string> ReferencesOf(string csprojPath) =>
        XDocument.Load(csprojPath)
            .Descendants("ProjectReference")
            .Select(e => Path.GetFileNameWithoutExtension(((string)e.Attribute("Include")!).Replace('\\', '/')))
            .ToHashSet();

    private static string RepoBackendRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "MatterFlow.sln")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("backend/MatterFlow.sln not found above test output");
    }
}
