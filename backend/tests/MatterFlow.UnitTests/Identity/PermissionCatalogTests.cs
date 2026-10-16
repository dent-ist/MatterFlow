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
        codes.Count.ShouldBe(50);
    }

    [Fact]
    public void The_Dashboard_group_has_View_and_one_view_permission_per_tab_and_the_old_department_right_is_gone()
    {
        var dashboard = Catalog().Where(c => c.Group == "Dashboard").ToList();

        dashboard.Select(c => c.Code).ShouldBe(
            ["Dashboard.View", "Dashboard.ViewSummary", "Dashboard.ViewUnassigned", "Dashboard.ViewBreakdowns", "Dashboard.ViewTrends", "Dashboard.ViewSwimlane", "Dashboard.ViewUsers", "Dashboard.ViewCoverage"]);
        dashboard.ShouldAllBe(c => c.Description.Length > 20);
        Catalog().Select(c => c.Code).ShouldNotContain("Dashboard.ViewDepartment");

        // The group sits before Oversight (the roles page lists groups in catalog order).
        var groups = Catalog().Select(c => c.Group).Distinct().ToList();
        groups.IndexOf("Dashboard").ShouldBeLessThan(groups.IndexOf("Oversight"));
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

        // Completion counts per person (addendum Q) are for Director and Pod Lead only.
        P("Director").ShouldContain(Permissions.Dashboard.ViewCoverage);
        P("Pod Lead").ShouldContain(Permissions.Dashboard.ViewCoverage);
        P("Project Manager").ShouldNotContain(Permissions.Dashboard.ViewCoverage);
        P("Data Technician").ShouldNotContain(Permissions.Dashboard.ViewCoverage);
        P("Data Scientist").ShouldNotContain(Permissions.Dashboard.ViewCoverage);
        P("Director").ShouldContain(Permissions.Audit.View);
        P("Director").ShouldContain(Permissions.User.View);
        P("Project Manager").ShouldNotContain(Permissions.Audit.View);
        P("Project Manager").ShouldContain(Permissions.Matter.SetActive);
        P("Project Manager").ShouldNotContain(Permissions.Pod.Manage);
        P("Pod Lead").ShouldContain(Permissions.Pod.ManageMembers);
        P("Pod Lead").ShouldNotContain(Permissions.Client.EditNumber);
        P("Data Technician").ShouldContain(Permissions.Project.Archive);
        P("Data Technician").ShouldNotContain(Permissions.Client.Create);

        // Dashboard: Directors see every tab, Pod Leads Summary + Swimlane + Users, Project Managers Summary + Swimlane, technicians the unassigned queue only (ViewUnassigned, not the department counts of ViewSummary).
        string[] tabs = [Permissions.Dashboard.ViewSummary, Permissions.Dashboard.ViewUnassigned, Permissions.Dashboard.ViewBreakdowns, Permissions.Dashboard.ViewTrends, Permissions.Dashboard.ViewSwimlane, Permissions.Dashboard.ViewUsers];
        foreach (var role in StarterRoles.All)
            role.Permissions.Intersect(tabs).Any().ShouldBe(role.Permissions.Contains(Permissions.Dashboard.View), $"{role.Name}: a tab permission only has effect with Dashboard.View");
        tabs.Except([Permissions.Dashboard.ViewUnassigned]).Append(Permissions.Dashboard.View).ShouldBeSubsetOf(P("Director"));
        P("Director").ShouldNotContain(Permissions.Dashboard.ViewUnassigned, "the unassigned queue is part of Summary for everyone who holds ViewSummary");
        P("Pod Lead").Intersect(tabs).ShouldBe([Permissions.Dashboard.ViewSummary, Permissions.Dashboard.ViewSwimlane, Permissions.Dashboard.ViewUsers], ignoreOrder: true);
        P("Project Manager").Intersect(tabs).ShouldBe([Permissions.Dashboard.ViewSummary, Permissions.Dashboard.ViewSwimlane], ignoreOrder: true);
        P("Data Technician").Intersect(tabs).ShouldBe([Permissions.Dashboard.ViewUnassigned]);
        P("Data Scientist").Intersect(tabs).ShouldBe([Permissions.Dashboard.ViewUnassigned]);
        foreach (var role in new[] { "Data Technician", "Data Scientist" })
            P(role).ShouldNotContain(Permissions.Dashboard.ViewSummary, role + ": technicians see the queue, not the department counts");
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
