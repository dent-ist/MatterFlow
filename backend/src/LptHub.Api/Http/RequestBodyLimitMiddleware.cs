using Microsoft.AspNetCore.Http.Features;

namespace MatterFlow.Api.Http;

/// <summary>
/// Caps request bodies at 2 MB for the JSON API (security review SEC-19): without it the server reads up to 30 MB of JSON before any
/// validation. Works on every host (Kestrel and IIS in-process) because it uses the per-request feature. The email intake endpoints
/// raise their own limit later in the pipeline for uploads (see <c>IntakeRequestLimitsAttribute</c>).
/// </summary>
public sealed class RequestBodyLimitMiddleware(RequestDelegate next)
{
    public const long DefaultMaxBytes = 2 * 1024 * 1024;

    public Task InvokeAsync(HttpContext context)
    {
        if (context.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } feature)
            feature.MaxRequestBodySize = DefaultMaxBytes;

        return next(context);
    }
}
