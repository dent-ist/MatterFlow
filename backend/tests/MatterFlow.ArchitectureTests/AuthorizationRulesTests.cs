using System.Reflection;
using MatterFlow.Identity;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Shouldly;

namespace MatterFlow.ArchitectureTests;

/// <summary>
/// Fail-closed authorization rules (architecture 6.5): every controller action in the product assemblies declares an authorization
/// policy, anonymous access is an explicit allow-list, only permission policies guard business endpoints, and no code checks role names.
/// </summary>
public class AuthorizationRulesTests
{
    /// <summary>Actions that may be anonymous. Health checks are mapped as endpoints (not controllers) and are anonymous by registration.</summary>
    private static readonly HashSet<string> AnonymousAllowList = ["SystemController.Ping"];

    /// <summary>Actions that any active (even Access Pending) user may call.</summary>
    private static readonly HashSet<string> AuthenticatedOnlyAllowList = ["MeController.Get"];

    private static IEnumerable<Assembly> ProductAssemblies()
    {
        yield return typeof(Program).Assembly;
        yield return typeof(IdentityModule).Assembly;
        foreach (var name in new[] { "Audit", "Configuration", "Organization", "Assets", "WorkflowEngine", "WorkManagement", "WorkViews", "Search", "Intake" })
            yield return Assembly.Load($"MatterFlow.{name}");
    }

    private static IEnumerable<(Type Controller, MethodInfo Action)> Actions() =>
        ProductAssemblies()
            .SelectMany(a => a.GetTypes())
            .Where(t => t is { IsClass: true, IsAbstract: false, IsPublic: true } && typeof(ControllerBase).IsAssignableFrom(t))
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(m => m.GetCustomAttributes<HttpMethodAttribute>(inherit: true).Any() && m.GetCustomAttribute<NonActionAttribute>() is null)
                .Select(m => (t, m)));

    private static IEnumerable<AuthorizeAttribute> AuthorizeOf(Type controller, MethodInfo action) =>
        action.GetCustomAttributes<AuthorizeAttribute>(inherit: true).Concat(controller.GetCustomAttributes<AuthorizeAttribute>(inherit: true));

    private static bool IsAnonymous(Type controller, MethodInfo action) =>
        action.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true).Any() || controller.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true).Any();

    private static string Name(Type controller, MethodInfo action) => $"{controller.Name}.{action.Name}";

    [Fact]
    public void Controllers_exist_to_check()
    {
        Actions().Select(a => Name(a.Controller, a.Action)).ShouldContain("MeController.Get");
        Actions().Select(a => Name(a.Controller, a.Action)).ShouldContain("SystemController.Ping");
    }

    [Fact]
    public void Every_controller_action_declares_an_authorization_policy_or_is_allow_listed_anonymous()
    {
        var unprotected = Actions()
            .Where(a => !AuthorizeOf(a.Controller, a.Action).Any() && !IsAnonymous(a.Controller, a.Action))
            .Select(a => Name(a.Controller, a.Action))
            .ToList();

        unprotected.ShouldBeEmpty("Add [RequirePermission(Permissions.X)] (or, for /me only, [AllowAuthenticated]) to: " + string.Join(", ", unprotected));
    }

    [Fact]
    public void Anonymous_actions_are_only_the_allow_listed_ones()
    {
        var anonymous = Actions().Where(a => IsAnonymous(a.Controller, a.Action)).Select(a => Name(a.Controller, a.Action)).ToList();

        anonymous.ShouldBe(AnonymousAllowList, ignoreOrder: true);
    }

    [Fact]
    public void Authenticated_only_actions_are_limited_to_the_allow_list()
    {
        var authenticatedOnly = Actions()
            .Where(a => AuthorizeOf(a.Controller, a.Action).Any(x => x.Policy == AccessPolicies.Authenticated))
            .Select(a => Name(a.Controller, a.Action))
            .ToList();

        authenticatedOnly.ShouldBe(AuthenticatedOnlyAllowList, ignoreOrder: true);
    }

    [Fact]
    public void Business_actions_use_permission_policies_that_exist_in_the_catalog()
    {
        foreach (var (controller, action) in Actions().Where(a => !IsAnonymous(a.Controller, a.Action) && !AuthenticatedOnlyAllowList.Contains(Name(a.Controller, a.Action))))
        {
            var attributes = AuthorizeOf(controller, action).ToList();
            attributes.ShouldNotBeEmpty(Name(controller, action));
            foreach (var attribute in attributes)
            {
                (attribute.Policy ?? string.Empty).ShouldStartWith(AccessPolicies.PermissionPrefix, customMessage: $"{Name(controller, action)} must use [RequirePermission]");
                foreach (var code in attribute.Policy![AccessPolicies.PermissionPrefix.Length..].Split(AccessPolicies.AnyOfSeparator))
                    Permissions.All.ShouldContain(code, $"{Name(controller, action)} references an unknown permission");
            }
        }
    }

    [Fact]
    public void Authorization_never_uses_role_names()
    {
        var offenders = Actions()
            .SelectMany(a => AuthorizeOf(a.Controller, a.Action).Select(x => (Name: Name(a.Controller, a.Action), Attribute: x)))
            .Where(x => !string.IsNullOrEmpty(x.Attribute.Roles) || !string.IsNullOrEmpty(x.Attribute.AuthenticationSchemes))
            .Select(x => x.Name)
            .ToList();

        offenders.ShouldBeEmpty("Authorize by permission, never by role name");
    }
}
