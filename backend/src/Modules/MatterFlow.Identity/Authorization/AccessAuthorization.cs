using MatterFlow.Identity.Access;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace MatterFlow.Identity.Authorization;

/// <summary>
/// The caller must hold <see cref="Code"/> (System Admin holds every permission). A policy name may list alternatives separated by
/// <see cref="AccessPolicies.AnyOfSeparator"/> (<c>Perm:Client.View|Matter.View</c>): holding any one of them is enough (global search).
/// </summary>
public sealed class PermissionRequirement(string code) : IAuthorizationRequirement
{
    public string Code { get; } = code;

    /// <summary>The permission codes of which one is enough.</summary>
    public IReadOnlyList<string> Alternatives { get; } = code.Split(AccessPolicies.AnyOfSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}

/// <summary>The caller must be a known, active user. Access Pending users pass (this is the <c>/me</c> gate).</summary>
public sealed class ActiveUserRequirement : IAuthorizationRequirement;

/// <summary>The caller must be active and not Access Pending. Used as the fail-closed default for actions without an explicit policy.</summary>
public sealed class NonPendingRequirement : IAuthorizationRequirement;

/// <summary>Policy names and the failure-reason vocabulary shared with the HTTP layer.</summary>
public static class AccessPolicies
{
    public const string PermissionPrefix = "Perm:";

    /// <summary>Separates alternative permission codes inside one <c>Perm:</c> policy name (any one of them grants access).</summary>
    public const char AnyOfSeparator = '|';
    public const string Authenticated = "MatterFlow.Authenticated";
    public const string NonPending = "MatterFlow.NonPending";

    /// <summary>Failure-reason prefix carrying the missing permission code: <c>PERMISSION_DENIED:Task.Create</c>.</summary>
    public const string PermissionDeniedReasonPrefix = ErrorCodes.PermissionDenied + ":";

    public static string ForPermission(string code) => PermissionPrefix + code;
}

/// <summary>
/// Evaluates every access requirement from the caller's effective permissions (never from role names). The resolver, and with it the
/// DbContext, is created lazily so anonymous endpoints never touch the database. Failures carry a reason
/// (<c>ACCESS_PENDING</c>, <c>ACCOUNT_DISABLED</c>, <c>PERMISSION_DENIED:&lt;code&gt;</c>) so the HTTP layer can emit the right stable code.
/// </summary>
public sealed class AccessAuthorizationHandler(IServiceProvider services, CurrentUser currentUser) : IAuthorizationHandler
{
    public async Task HandleAsync(AuthorizationHandlerContext context)
    {
        var requirements = context.PendingRequirements
            .Where(r => r is PermissionRequirement or ActiveUserRequirement or NonPendingRequirement)
            .ToList();
        if (requirements.Count == 0 || context.User.Identity?.IsAuthenticated != true)
            return;

        var snapshot = currentUser.Snapshot ?? await services.GetRequiredService<IUserResolver>().ResolveAsync(context.User);
        if (snapshot is null)
            return; // no usable identity: requirement stays unmet, the pipeline challenges (401)

        currentUser.Set(snapshot);

        foreach (var requirement in requirements)
        {
            if (!snapshot.IsActive)
            {
                context.Fail(new AuthorizationFailureReason(this, ErrorCodes.AccountDisabled));
                continue;
            }

            switch (requirement)
            {
                case ActiveUserRequirement:
                    context.Succeed(requirement);
                    break;
                case NonPendingRequirement when snapshot.IsPending:
                case PermissionRequirement when snapshot.IsPending:
                    context.Fail(new AuthorizationFailureReason(this, ErrorCodes.AccessPending));
                    break;
                case NonPendingRequirement:
                    context.Succeed(requirement);
                    break;
                case PermissionRequirement p when p.Alternatives.Any(snapshot.Has):
                    context.Succeed(requirement);
                    break;
                case PermissionRequirement p:
                    context.Fail(new AuthorizationFailureReason(this, AccessPolicies.PermissionDeniedReasonPrefix + p.Code));
                    break;
            }
        }
    }
}

/// <summary>Resolves <c>Perm:&lt;code&gt;</c> policy names on demand, so no per-permission registration is needed (architecture 6.5).</summary>
public sealed class PermissionPolicyProvider(IOptions<AuthorizationOptions> options) : IAuthorizationPolicyProvider
{
    private readonly DefaultAuthorizationPolicyProvider _fallback = new(options);

    public Task<AuthorizationPolicy> GetDefaultPolicyAsync() => _fallback.GetDefaultPolicyAsync();

    public Task<AuthorizationPolicy?> GetFallbackPolicyAsync() => _fallback.GetFallbackPolicyAsync();

    public Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        if (policyName.StartsWith(AccessPolicies.PermissionPrefix, StringComparison.Ordinal))
        {
            var code = policyName[AccessPolicies.PermissionPrefix.Length..];
            var policy = new AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .AddRequirements(new PermissionRequirement(code))
                .Build();
            return Task.FromResult<AuthorizationPolicy?>(policy);
        }

        return _fallback.GetPolicyAsync(policyName);
    }
}

/// <summary>Protects an endpoint with a permission policy: <c>[RequirePermission(Permissions.Task.Create)]</c>.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class RequirePermissionAttribute(string code) : AuthorizeAttribute(AccessPolicies.ForPermission(code))
{
    public string Code { get; } = code;
}

/// <summary>
/// For the few endpoints any signed-in, active user may call, including Access Pending users (only <c>GET /api/v1/me</c>).
/// Everything else must use <see cref="RequirePermissionAttribute"/>.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class AllowAuthenticatedAttribute() : AuthorizeAttribute(AccessPolicies.Authenticated);
