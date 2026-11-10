using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Api.Http;

/// <summary>
/// CSRF protection for Windows-authenticated calls (architecture 6.6): browsers attach credentials automatically, so every state-changing
/// request under <c>/api</c> must carry <c>X-MatterFlow-Client: web</c> and, when it has a body, a JSON or multipart content type; a cross-site
/// <c>Sec-Fetch-Site</c> is rejected. Runs before authentication and authorization, so a forged request never reaches permission logic.
/// </summary>
public sealed class RequestForgeryGuard(RequestDelegate next)
{
    public const string HeaderName = "X-MatterFlow-Client";
    public const string HeaderValue = "web";

    public async Task InvokeAsync(HttpContext context)
    {
        var request = context.Request;
        if (!request.Path.StartsWithSegments("/api") || IsSafe(request.Method))
        {
            await next(context);
            return;
        }

        var site = request.Headers["Sec-Fetch-Site"].FirstOrDefault();
        if (site is not null && !site.Equals("same-origin", StringComparison.OrdinalIgnoreCase) && !site.Equals("none", StringComparison.OrdinalIgnoreCase))
        {
            await WriteAsync(context, StatusCodes.Status403Forbidden, ErrorCodes.PermissionDenied, "Cross-site request rejected", "State-changing requests must originate from the application itself.");
            return;
        }

        if (!string.Equals(request.Headers[HeaderName].FirstOrDefault(), HeaderValue, StringComparison.Ordinal))
        {
            await WriteAsync(context, StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed, "Client header required", $"State-changing requests must send '{HeaderName}: {HeaderValue}'.");
            return;
        }

        var hasBody = request.ContentLength > 0 || request.Headers.ContainsKey("Transfer-Encoding");
        if (hasBody && !IsAllowedContentType(request.ContentType))
        {
            await WriteAsync(context, StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed, "Unsupported content type", "State-changing requests must use application/json (or multipart/form-data where documented).");
            return;
        }

        await next(context);
    }

    private static bool IsSafe(string method) =>
        HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method) || HttpMethods.IsTrace(method);

    private static bool IsAllowedContentType(string? contentType) =>
        contentType is not null
        && (contentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase)
            || contentType.StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase));

    private static async Task WriteAsync(HttpContext context, int status, string code, string title, string detail)
    {
        var problem = Problems.Create(context, status, code, title, detail);
        context.Response.StatusCode = status;
        await Results.Json(problem, contentType: Problems.ContentType, statusCode: status).ExecuteAsync(context);
    }
}
