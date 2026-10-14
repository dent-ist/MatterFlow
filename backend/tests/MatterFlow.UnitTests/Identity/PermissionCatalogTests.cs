using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Seeding;
using Shouldly;

namespace MatterFlow.UnitTests.Identity;

public class PermissionCatalogTests
{
    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "contracts", "permissions.json")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("contracts/permissions.json not found above test output");
    }

    private static IReadOnlyList<PermissionDefinition> Catalog() => PermissionCatalog.Load();

    private static IEnumerable<string> ConstantValues(Type type) =>
        type.GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy)
            .Where(f => f is { IsLiteral: true, FieldType.Name: "String" })
            .Select(f => (string)f.GetRawConstantValue()!)
            .Concat(type.GetNestedTypes().SelectMany(ConstantValues));

    [Fact]
    public void Embedded_catalog_is_the_contracts_file()
    {
        using var file = File.OpenRead(Path.Combine(RepoRoot(), "contracts", "permissions.json"));

        PermissionCatalog.Parse(file).ShouldBe(Catalog());
    }

    [Fact]
    public void Catalog_codes_are_unique_well_formed_and_fit_the_column()
    {
        var codes = Catalog().Select(c => c.Code).ToList();

        codes.Distinct().Count().ShouldBe(codes.Count);
        codes.ShouldAllBe(c => Regex.IsMatch(c, @"^[A-Z][A-Za-z]+\.[A-Z][A-Za-z]+$") && c.Length <= 64);
        foreach (var c in Catalog())
        {
            c.Group.Length.ShouldBeInRange(1, 40);
            c.Description.Length.ShouldBeInRange(1, 300);
        }
    }

    [Fact]
    public void Csharp_constants_match_the_json_catalog_exactly()
    {
        ConstantValues(typeof(Permissions)).Order().ShouldBe(Catalog().Select(c => c.Code).Order());
        Permissions.All.Order().ShouldBe(Catalog().Select(c => c.Code).Order());
    }

    [Fact]
    public void Angular_permission_union_matches_the_json_catalog()
    {
        var ts = File.ReadAllText(Path.Combine(RepoRoot(), "frontend", "src", "app", "core", "auth", "permissions.ts"));
        var angular = Regex.Matches(ts, @"^\s*'([A-Za-z]+\.[A-Za-z]+)',\s*$", RegexOptions.Multiline).Select(m => m.Groups[1].Value);

        angular.Order().ShouldBe(Catalog().Select(c => c.Code).Order());
    }

    [Fact]
    public void Catalog_matches_the_architecture_adjustments_of_finding_fnd_03()
    {
        var codes = Catalog().Select(c => c.Code).ToHashSet();

        codes.ShouldNotContain("Task.Reassign");
        codes.ShouldNotContain("Task.Attach");
        codes.ShouldNotContain("Workflow.StepEdit");
        codes.ShouldContain("Task.Cancel");
        codes.ShouldContain("Matter.SetActive");
        codes.ShouldContain("User.Manage");
        codes.ShouldContain("Role.Manage");
        codes.Count.ShouldBe(43);
    }

    [Fact]
    public void Starter_roles_only_reference_catalog_codes_and_have_no_duplicates()
    {
        var codes = Catalog().Select(c => c.Code).ToHashSet();

        foreach (var role in StarterRoles.All)
        {
            role.Permissions.ShouldAllBe(p => codes.Contains(p), role.Name);
            role.Permissions.Distinct().Count().ShouldBe(role.Permissions.Count, role.Name);
        }
    }

    [Fact]
    public void Starter_role_matrix_follows_architecture_6_3()
    {
        IReadOnlyList<string> P(string role) => StarterRoles.All.Single(r => r.Name == role).Permissions;

        StarterRoles.All.Select(r => r.Name).ShouldBe(["Director", "Project Manager", "Pod Lead", "Data Technician", "Data Scientist"]);

        // Configuration and user management are System Admin only by default.
        foreach (var role in StarterRoles.All)
        {
            role.Permissions.ShouldNotContain(Permissions.Role.Manage);
            role.Permissions.ShouldNotContain(Permissions.TaskType.Manage);
            role.Permissions.ShouldNotContain(Permissions.Workflow.Manage);
            role.Permissions.ShouldNotContain(Permissions.AssetType.Manage);
            role.Permissions.ShouldNotContain(Permissions.CustomField.Manage);
            role.Permissions.ShouldNotContain(Permissions.Priority.Manage);
            role.Permissions.ShouldNotContain(Permissions.StatusLabel.Manage);
            role.Permissions.ShouldNotContain(Permissions.User.Manage);
            role.Permissions.ShouldContain(Permissions.Task.Complete);
            role.Permissions.ShouldContain(Permissions.Workflow.StepReopen);
            role.Permissions.ShouldContain(Permissions.Pod.View);
        }

        P("Director").ShouldContain(Permissions.Audit.View);
        P("Director").ShouldContain(Permissions.User.View);
        P("Project Manager").ShouldNotContain(Permissions.Audit.View);
        P("Project Manager").ShouldContain(Permissions.Matter.SetActive);
        P("Project Manager").ShouldNotContain(Permissions.Pod.Manage);
        P("Pod Lead").ShouldContain(Permissions.Pod.ManageMembers);
        P("Pod Lead").ShouldNotContain(Permissions.Client.EditNumber);
        P("Data Technician").ShouldContain(Permissions.Project.Archive);
        P("Data Technician").ShouldNotContain(Permissions.Client.Create);
        P("Data Technician").ShouldNotContain(Permissions.Dashboard.ViewDepartment);
        P("Data Scientist").ShouldNotContain(Permissions.Project.Create);
        P("Data Scientist").ShouldContain(Permissions.Asset.Link);
    }

    [Fact]
    public void Catalog_is_valid_json_with_a_permissions_array()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "contracts", "permissions.json")));

        doc.RootElement.GetProperty("permissions").ValueKind.ShouldBe(JsonValueKind.Array);
    }
}
