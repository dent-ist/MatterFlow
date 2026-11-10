using System.Reflection;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.LandingPages;
using MatterFlow.Identity.Seeding;
using Shouldly;

namespace MatterFlow.UnitTests.Identity;

/// <summary>Landing pages (epic #1330, issue #1332): the catalogue, the "who can open a page" rule, the role list order and the fallback chain.</summary>
public class LandingPageTests
{
    private static readonly LandingPageCatalog Catalog = LandingPageCatalog.Default;

    private static Func<string, bool> Holds(params string[] codes)
    {
        var set = codes.ToHashSet(StringComparer.Ordinal);
        return set.Contains;
    }

    private static string[] Keys(IEnumerable<LandingPageDefinition> pages) => [.. pages.Select(p => p.Key)];

    [Fact]
    public void The_catalogue_has_exactly_the_agreed_keys_in_navigation_order()
    {
        Keys(Catalog.Pages).ShouldBe(["dashboard", "my-matters", "my-work", "clients", "matters", "projects", "assets", "pod-work", "task-queue", "reports", "administration"]);
        Catalog.Pages.Select(p => p.Path).Distinct().Count().ShouldBe(Catalog.Pages.Count);
    }

    [Fact]
    public void Every_permission_of_every_rule_is_in_the_permission_catalog()
    {
        foreach (var code in Catalog.RulePermissions)
            Permissions.All.ShouldContain(code);
    }

    [Fact]
    public void The_dashboard_needs_Dashboard_View_and_a_tab_permission()
    {
        var dashboard = Catalog.Find("dashboard")!;
        Catalog.CanOpen(dashboard, Holds("Dashboard.View")).ShouldBeFalse("Dashboard.View alone is a dead end");
        Catalog.CanOpen(dashboard, Holds("Dashboard.ViewSummary")).ShouldBeFalse("a tab without Dashboard.View");
        Catalog.CanOpen(dashboard, Holds("Dashboard.View", "Dashboard.ViewUnassigned")).ShouldBeTrue();
        Catalog.CanOpen(dashboard, Holds("Dashboard.View", "Dashboard.ViewCoverage")).ShouldBeFalse("Coverage is not a tab");
    }

    [Fact]
    public void My_Matters_and_Pod_Work_need_all_of_their_permissions()
    {
        Catalog.CanOpen(Catalog.Find("my-matters")!, Holds("Matter.BeManager", "Matter.View")).ShouldBeFalse();
        Catalog.CanOpen(Catalog.Find("my-matters")!, Holds("Matter.BeManager", "Matter.View", "Task.View")).ShouldBeTrue();
        Catalog.CanOpen(Catalog.Find("pod-work")!, Holds("Pod.View")).ShouldBeFalse();
        Catalog.CanOpen(Catalog.Find("pod-work")!, Holds("Pod.View", "Task.View")).ShouldBeTrue();
    }

    [Fact]
    public void Administration_opens_with_any_one_administration_permission()
    {
        var admin = Catalog.Find("administration")!;
        Catalog.CanOpen(admin, Holds()).ShouldBeFalse();
        Catalog.CanOpen(admin, Holds("Task.View")).ShouldBeFalse();
        foreach (var code in admin.AnyOf)
            Catalog.CanOpen(admin, Holds(code)).ShouldBeTrue(code);
    }

    [Fact]
    public void A_person_who_holds_everything_can_open_every_page_and_one_who_holds_nothing_none()
    {
        Keys(Catalog.OpenableBy(_ => true)).Length.ShouldBe(Catalog.Pages.Count);
        Catalog.OpenableBy(_ => false).ShouldBeEmpty();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Dashboard")]
    [InlineData("/dashboard")]
    [InlineData("no-such-page")]
    public void An_unknown_key_is_not_a_page(string? key) => Catalog.Find(key).ShouldBeNull();

    [Fact]
    public void The_role_list_is_alphabetical_ignoring_case_and_the_first_role_decides()
    {
        var roles = new RoleLanding[] { new("Project Manager", "my-matters"), new("director", "dashboard"), new("Data Scientist", null), new("Pod Lead", null) };
        LandingPageResolver.RoleListOrder(roles).Select(r => r.Name).ShouldBe(["Data Scientist", "director", "Pod Lead", "Project Manager"]);
        LandingPageResolver.FirstRole(roles)!.Name.ShouldBe("Data Scientist");
        LandingPageResolver.FirstRole([]).ShouldBeNull();
    }

    [Fact]
    public void The_role_list_order_is_total_and_the_same_for_every_input_order()
    {
        RoleLanding[] roles = [new("b", null), new("B", null), new("a", null), new("A", null)];
        var expected = LandingPageResolver.RoleListOrder(roles).Select(r => r.Name).ToArray();
        expected.ShouldBe(["A", "a", "B", "b"]);
        LandingPageResolver.RoleListOrder(roles.Reverse()).Select(r => r.Name).ShouldBe(expected);
    }

    private static readonly Func<string, bool> Manager = Holds("Matter.BeManager", "Matter.View", "Task.View", "Dashboard.View", "Dashboard.ViewSummary");

    [Fact]
    public void The_choice_wins_when_the_person_can_open_it()
    {
        var r = LandingPageResolver.Resolve(Catalog, "dashboard", "my-matters", Manager);
        r.Page!.Key.ShouldBe("dashboard");
        r.Source.ShouldBe("CHOICE");
    }

    [Fact]
    public void A_choice_that_is_no_longer_openable_falls_back_to_the_role_default()
    {
        var r = LandingPageResolver.Resolve(Catalog, "reports", "my-matters", Manager);
        r.Page!.Key.ShouldBe("my-matters");
        r.Source.ShouldBe("ROLE_DEFAULT");
    }

    [Fact]
    public void Without_a_choice_the_role_default_is_used()
    {
        var r = LandingPageResolver.Resolve(Catalog, null, "dashboard", Manager);
        r.Page!.Key.ShouldBe("dashboard");
        r.Source.ShouldBe("ROLE_DEFAULT");
    }

    [Fact]
    public void Neither_choice_nor_default_openable_resolves_to_nothing_so_the_frontend_rule_applies()
    {
        LandingPageResolver.Resolve(Catalog, "reports", "administration", Manager).ShouldBe(new LandingResolution(null, null));
        LandingPageResolver.Resolve(Catalog, null, null, Manager).Page.ShouldBeNull();
        LandingPageResolver.Resolve(Catalog, null, "dashboard", Holds()).Page.ShouldBeNull();
    }

    [Fact]
    public void Unknown_keys_are_skipped_without_failing()
    {
        var r = LandingPageResolver.Resolve(Catalog, "renamed-page", "my-matters", Manager);
        r.Page!.Key.ShouldBe("my-matters");
        r.Source.ShouldBe("ROLE_DEFAULT");
        LandingPageResolver.Resolve(Catalog, "renamed-page", "also-gone", Manager).Page.ShouldBeNull();
    }

    [Theory]
    [InlineData("""{"page":"dashboard"}""", "dashboard")]
    [InlineData("""{"page":5}""", null)]
    [InlineData("""{"other":"x"}""", null)]
    [InlineData("[]", null)]
    [InlineData("not json", null)]
    public void A_stored_choice_that_is_not_the_expected_shape_counts_as_not_set(string json, string? expected) =>
        LandingPageService.ParseChoice(json).ShouldBe(expected);

    [Fact]
    public void The_personal_endpoints_accept_every_permission_so_only_Access_Pending_is_turned_away()
    {
        var attribute = typeof(RequireAnyPermissionAttribute).GetConstructors().Single().Invoke([]);
        var policy = ((Microsoft.AspNetCore.Authorization.AuthorizeAttribute)attribute).Policy!;
        policy.ShouldStartWith(AccessPolicies.PermissionPrefix);
        var alternatives = policy[AccessPolicies.PermissionPrefix.Length..].Split(AccessPolicies.AnyOfSeparator);
        alternatives.ShouldBe(Permissions.All, ignoreOrder: true);
        Catalog.RulePermissions.ShouldBeSubsetOf(alternatives);
    }

    [Fact]
    public void Starter_roles_default_as_agreed_and_every_default_is_openable_with_the_roles_own_grants()
    {
        StarterRoles.All.Single(r => r.Name == "Director").LandingPage.ShouldBe(LandingPageKeys.Dashboard);
        StarterRoles.All.Single(r => r.Name == "Project Manager").LandingPage.ShouldBe(LandingPageKeys.MyMatters);
        StarterRoles.All.Where(r => r.Name is "Pod Lead" or "Data Technician" or "Data Scientist").ShouldAllBe(r => r.LandingPage == null);
        foreach (var role in StarterRoles.All.Where(r => r.LandingPage is not null))
            Catalog.CanOpen(Catalog.Find(role.LandingPage)!, role.Permissions.ToHashSet().Contains).ShouldBeTrue(role.Name);
    }

    [Fact]
    public void Role_endpoints_use_the_role_permissions()
    {
        var controller = typeof(MatterFlow.Identity.Api.LandingPagesController);
        controller.GetMethod("SetRole")!.GetCustomAttribute<RequirePermissionAttribute>()!.Code.ShouldBe(Permissions.Role.Manage);
    }
}
