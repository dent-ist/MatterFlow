using System.Security.Claims;
using MatterFlow.Identity.Access;
using MatterFlow.Identity.Authentication;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using NSubstitute;
using Shouldly;

namespace MatterFlow.UnitTests.Identity;

internal sealed class FakeClock(DateTime start) : IClock
{
    public DateTime UtcNow { get; set; } = start;
}

internal static class Snapshots
{
    public static AccessSnapshot User(int id = 1, bool active = true, bool admin = false, params string[] permissions) =>
        new(id, "User " + id, null, @"KE\user" + id, DateTime.UtcNow, active, admin, [], permissions.ToHashSet());
}

public class UserAccessCacheTests
{
    private readonly FakeClock _clock = new(new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));

    private UserAccessCache Cache(int seconds = 60) => new(_clock, Options.Create(new AccessCacheOptions { CacheSeconds = seconds }));

    [Fact]
    public void Returns_the_cached_snapshot_until_it_expires()
    {
        var cache = Cache();
        cache.Set("k", Snapshots.User(), cache.Generation);

        cache.TryGet("k", out var hit).ShouldBeTrue();
        hit.UserId.ShouldBe(1);

        _clock.UtcNow = _clock.UtcNow.AddSeconds(59);
        cache.TryGet("k", out _).ShouldBeTrue();

        _clock.UtcNow = _clock.UtcNow.AddSeconds(2);
        cache.TryGet("k", out _).ShouldBeFalse();
    }

    [Fact]
    public void Invalidating_a_user_drops_only_that_users_entries()
    {
        var cache = Cache();
        cache.Set("a", Snapshots.User(1), cache.Generation);
        cache.Set("b", Snapshots.User(2), cache.Generation);

        cache.InvalidateUser(1);

        cache.TryGet("a", out _).ShouldBeFalse();
        cache.TryGet("b", out _).ShouldBeTrue();
    }

    [Fact]
    public void Invalidating_all_clears_everything()
    {
        var cache = Cache();
        cache.Set("a", Snapshots.User(1), cache.Generation);
        cache.Set("b", Snapshots.User(2), cache.Generation);

        cache.InvalidateAll();

        cache.TryGet("a", out _).ShouldBeFalse();
        cache.TryGet("b", out _).ShouldBeFalse();
    }

    [Fact]
    public void A_load_that_raced_with_an_invalidation_is_not_cached()
    {
        var cache = Cache();
        var generationAtLoadStart = cache.Generation;

        cache.InvalidateUser(1); // a role changed while the stale snapshot was being loaded
        cache.Set("a", Snapshots.User(1), generationAtLoadStart);

        cache.TryGet("a", out _).ShouldBeFalse();
    }

    [Fact]
    public void Cache_is_exposed_as_the_invalidator_contract()
    {
        IUserAccessInvalidator invalidator = Cache();
        Should.NotThrow(() => invalidator.InvalidateUser(5));
    }
}

public class AccessAuthorizationHandlerTests
{
    private static ClaimsPrincipal Authenticated() => new(new ClaimsIdentity([new Claim(ClaimTypes.Name, @"KE\x")], "test"));

    private static async Task<(AuthorizationHandlerContext Context, CurrentUser User)> RunAsync(
        IAuthorizationRequirement requirement,
        AccessSnapshot? snapshot,
        ClaimsPrincipal? principal = null)
    {
        var resolver = Substitute.For<IUserResolver>();
        resolver.ResolveAsync(Arg.Any<ClaimsPrincipal>(), Arg.Any<CancellationToken>()).Returns(snapshot);
        var services = new ServiceCollection().AddSingleton(resolver).BuildServiceProvider();
        var user = new CurrentUser();
        var context = new AuthorizationHandlerContext([requirement], principal ?? Authenticated(), null);

        await new AccessAuthorizationHandler(services, user).HandleAsync(context);
        return (context, user);
    }

    private static string?[] Reasons(AuthorizationHandlerContext context) => context.FailureReasons.Select(r => r.Message).ToArray();

    [Fact]
    public async Task Permission_held_in_the_effective_set_succeeds()
    {
        var (context, user) = await RunAsync(new PermissionRequirement(Permissions.Task.View), Snapshots.User(1, true, false, Permissions.Task.View));

        context.HasSucceeded.ShouldBeTrue();
        user.UserId.ShouldBe(1);
    }

    [Fact]
    public async Task Missing_permission_fails_naming_the_code()
    {
        var (context, _) = await RunAsync(new PermissionRequirement(Permissions.TaskType.Manage), Snapshots.User(1, true, false, Permissions.Task.View));

        context.HasSucceeded.ShouldBeFalse();
        Reasons(context).ShouldBe(["PERMISSION_DENIED:" + Permissions.TaskType.Manage]);
    }

    [Fact]
    public async Task System_admin_holds_every_permission_without_explicit_grants()
    {
        var (context, user) = await RunAsync(new PermissionRequirement(Permissions.Role.Manage), Snapshots.User(1, true, true, Permissions.Task.View));

        context.HasSucceeded.ShouldBeTrue();
        user.IsSystemAdmin.ShouldBeTrue();
    }

    [Fact]
    public async Task Role_names_play_no_part_only_permissions_do()
    {
        var snapshot = Snapshots.User(1, true, false, Permissions.Task.View) with { Roles = ["System Admin", "Director"] };

        var (context, _) = await RunAsync(new PermissionRequirement(Permissions.Role.Manage), snapshot);

        context.HasSucceeded.ShouldBeFalse();
    }

    [Theory]
    [InlineData(typeof(PermissionRequirement))]
    [InlineData(typeof(NonPendingRequirement))]
    public async Task Pending_user_fails_with_access_pending(Type requirementType)
    {
        IAuthorizationRequirement requirement = requirementType == typeof(PermissionRequirement)
            ? new PermissionRequirement(Permissions.Task.View)
            : new NonPendingRequirement();

        var (context, _) = await RunAsync(requirement, Snapshots.User());

        context.HasSucceeded.ShouldBeFalse();
        Reasons(context).ShouldBe(["ACCESS_PENDING"]);
    }

    [Fact]
    public async Task Pending_user_passes_the_active_user_requirement()
    {
        var (context, _) = await RunAsync(new ActiveUserRequirement(), Snapshots.User());

        context.HasSucceeded.ShouldBeTrue();
    }

    [Theory]
    [InlineData(typeof(ActiveUserRequirement))]
    [InlineData(typeof(NonPendingRequirement))]
    [InlineData(typeof(PermissionRequirement))]
    public async Task Disabled_user_fails_every_requirement_with_account_disabled(Type requirementType)
    {
        IAuthorizationRequirement requirement = requirementType == typeof(PermissionRequirement)
            ? new PermissionRequirement(Permissions.Task.View)
            : (IAuthorizationRequirement)Activator.CreateInstance(requirementType)!;

        var (context, _) = await RunAsync(requirement, Snapshots.User(1, false, true, Permissions.Task.View));

        context.HasSucceeded.ShouldBeFalse();
        Reasons(context).ShouldBe(["ACCOUNT_DISABLED"]);
    }

    [Fact]
    public async Task Unresolvable_identity_leaves_the_requirement_unmet()
    {
        var (context, user) = await RunAsync(new PermissionRequirement(Permissions.Task.View), null);

        context.HasSucceeded.ShouldBeFalse();
        context.HasFailed.ShouldBeFalse();
        user.IsAuthenticated.ShouldBeFalse();
    }

    [Fact]
    public async Task Anonymous_principal_is_not_resolved()
    {
        var resolver = Substitute.For<IUserResolver>();
        var services = new ServiceCollection().AddSingleton(resolver).BuildServiceProvider();
        var context = new AuthorizationHandlerContext([new PermissionRequirement(Permissions.Task.View)], new ClaimsPrincipal(new ClaimsIdentity()), null);

        await new AccessAuthorizationHandler(services, new CurrentUser()).HandleAsync(context);

        context.HasSucceeded.ShouldBeFalse();
        await resolver.DidNotReceiveWithAnyArgs().ResolveAsync(default!, default);
    }

    [Fact]
    public async Task Permission_checker_reports_missing_codes_as_forbidden_results()
    {
        var (_, user) = await RunAsync(new ActiveUserRequirement(), Snapshots.User(1, true, false, Permissions.Task.View));

        user.Require(Permissions.Task.View).IsSuccess.ShouldBeTrue();
        var denied = user.Require(Permissions.Task.Assign);
        denied.IsFailure.ShouldBeTrue();
        denied.Error!.Type.ShouldBe(ErrorType.Forbidden);
        denied.Error.Code.ShouldBe("PERMISSION_DENIED");
        denied.Error.Meta!["permission"].ShouldBe(Permissions.Task.Assign);
    }
}

public class PermissionPolicyProviderTests
{
    private static PermissionPolicyProvider Provider() => new(Options.Create(new AuthorizationOptions()));

    [Fact]
    public async Task Resolves_permission_policies_on_demand_from_the_name()
    {
        var policy = await Provider().GetPolicyAsync("Perm:Task.Create");

        policy.ShouldNotBeNull();
        policy.Requirements.OfType<PermissionRequirement>().Single().Code.ShouldBe("Task.Create");
        policy.Requirements.OfType<Microsoft.AspNetCore.Authorization.Infrastructure.DenyAnonymousAuthorizationRequirement>().ShouldNotBeEmpty();
    }

    [Fact]
    public async Task Unknown_non_permission_policies_fall_through_to_the_registered_ones()
    {
        (await Provider().GetPolicyAsync("Something.Else")).ShouldBeNull();
    }

    [Fact]
    public void Require_permission_attribute_builds_the_policy_name_from_the_code()
    {
        new RequirePermissionAttribute(Permissions.Task.Create).Policy.ShouldBe("Perm:Task.Create");
    }
}

public class AuthenticationSelectionTests
{
    private static IConfiguration Config(string? provider) =>
        new ConfigurationBuilder().AddInMemoryCollection(provider is null ? [] : new Dictionary<string, string?> { ["Auth:Provider"] = provider }).Build();

    private static IHostEnvironment Env(string name)
    {
        var env = Substitute.For<IHostEnvironment>();
        env.EnvironmentName.Returns(name);
        return env;
    }

    [Theory]
    [InlineData("Development", null, AuthProvider.Dev)]
    [InlineData("Production", null, AuthProvider.Windows)]
    [InlineData("Staging", null, AuthProvider.Windows)]
    [InlineData("Staging", "dev", AuthProvider.Dev)]
    [InlineData("Production", "Windows", AuthProvider.Windows)]
    [InlineData("Development", "Windows", AuthProvider.Windows)]
    public void Provider_defaults_and_overrides(string environment, string? configured, AuthProvider expected)
    {
        AuthProviderSelection.Resolve(Config(configured), Env(environment)).ShouldBe(expected);
    }

    [Fact]
    public void Dev_provider_is_refused_in_production()
    {
        Should.Throw<InvalidOperationException>(() => AuthProviderSelection.Resolve(Config("Dev"), Env("Production")));
    }

    [Fact]
    public void Unknown_provider_is_refused()
    {
        Should.Throw<InvalidOperationException>(() => AuthProviderSelection.Resolve(Config("Entra2"), Env("Development")));
    }
}

public class ExternalIdentityAccessorTests
{
    [Fact]
    public void Windows_identity_uses_the_sid_claim_as_subject_and_keeps_the_account_name()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, @"KE\kekim"), new Claim(ClaimTypes.PrimarySid, "S-1-5-21-1-2-3-1001")],
            "Negotiate"));

        var identity = ExternalIdentityAccessor.From(principal)!;

        identity.Provider.ShouldBe("Windows");
        identity.Subject.ShouldBe("S-1-5-21-1-2-3-1001");
        identity.Username.ShouldBe(@"KE\kekim");
        identity.TenantId.ShouldBe(string.Empty);
    }

    [Fact]
    public void Windows_identity_without_sid_falls_back_to_the_upper_cased_name()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, @"ke\kekim")], "Kerberos"));

        ExternalIdentityAccessor.From(principal)!.Subject.ShouldBe(@"KE\KEKIM");
    }

    [Fact]
    public void Dev_identity_is_recognized_by_its_provider_claim()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.Name, @"KE\Alice"),
                new Claim(ExternalIdentityAccessor.ProviderClaim, "Dev"),
                new Claim(ExternalIdentityAccessor.SubjectClaim, @"ke\alice"),
            ],
            "Dev"));

        var identity = ExternalIdentityAccessor.From(principal)!;

        identity.Provider.ShouldBe("Dev");
        identity.Subject.ShouldBe(@"ke\alice");
        identity.Username.ShouldBe(@"KE\Alice");
    }

    [Fact]
    public void Anonymous_principal_has_no_external_identity()
    {
        ExternalIdentityAccessor.From(new ClaimsPrincipal(new ClaimsIdentity())).ShouldBeNull();
    }
}
