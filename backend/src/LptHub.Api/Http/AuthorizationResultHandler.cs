using MatterFlow.Identity.Authorization;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace MatterFlow.Api.Http;

/// <summary>
/// Maps authorization failures to the stable error model (architecture 6.5): 403 with <c>ACCESS_PENDING</c>, <c>ACCOUNT_DISABLED</c> or
/// <c>PERMISSION_DENIED</c> (naming the missing code in <c>meta.permission</c>). Challenges (401) keep the framework behavior so the
/// authentication scheme can issue its header; the status-code pages then add the ProblemDetails body.
/// </summary>
public sealed class AuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public async Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
    {
        if (!authorizeResult.Forbidden)
        {
            await _default.HandleAsync(next, context, policy, authorizeResult);
            return;
        }

        var reasons = authorizeResult.AuthorizationFailure?.FailureReasons.Select(r => r.Message).ToList() ?? [];
        var code = ErrorCodes.PermissionDenied;
        string? permission = null;
        if (reasons.Contains(ErrorCodes.AccountDisabled))
        {
            code = ErrorCodes.AccountDisabled;
        }
        else if (reasons.Contains(ErrorCodes.AccessPending))
        {
            code = ErrorCodes.AccessPending;
        }
        else
        {
            permission = reasons
                .FirstOrDefault(r => r.StartsWith(AccessPolicies.PermissionDeniedReasonPrefix, StringComparison.Ordinal))
                ?[AccessPolicies.PermissionDeniedReasonPrefix.Length..];
        }

        var (title, detail) = code switch
        {
            ErrorCodes.AccountDisabled => ("Account disabled", "Your account has been disabled. Contact an administrator."),
            ErrorCodes.AccessPending => ("Access pending", "Your account has no access yet. An administrator must assign you a role."),
            _ => ("Permission denied", permission is null ? "You do not have permission to perform this action." : $"The permission '{permission}' is required."),
        };

        var meta = permission is null ? null : new Dictionary<string, object?> { ["permission"] = permission };
        var problem = Problems.Create(context, StatusCodes.Status403Forbidden, code, title, detail, meta: meta);
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await Results.Json(problem, contentType: Problems.ContentType, statusCode: StatusCodes.Status403Forbidden)
            .ExecuteAsync(context);
    }
}
