namespace MatterFlow.Api.Http;

/// <summary>
/// Adds the browser security headers to every response (security review SEC-08), including error responses, because it runs first.
/// <list type="bullet">
/// <item><c>Content-Security-Policy</c>: the Angular app is served from the same origin as the API, so everything is <c>'self'</c>; styles
/// additionally allow inline because Angular component styles and PrimeNG inject <c>&lt;style&gt;</c> elements. No <c>unsafe-eval</c>, no inline
/// script. API responses (JSON) get the strictest policy, <c>default-src 'none'</c>.</item>
/// <item><c>X-Content-Type-Options: nosniff</c>, <c>X-Frame-Options: DENY</c> (plus <c>frame-ancestors 'none'</c>),
/// <c>Referrer-Policy: no-referrer</c>, a <c>Permissions-Policy</c> that switches the powerful features off, and
/// <c>Cross-Origin-Opener-Policy: same-origin</c>.</item>
/// <item><c>Cache-Control: no-store</c> on <c>/api</c>: lists of users, audit events and forms must not sit in a browser or proxy cache.</item>
/// </list>
/// HSTS is added by the host (<c>UseHsts</c>) outside Development.
/// </summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    /// <summary>Policy for the single-page application and its static files.</summary>
    public const string AppContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
        + "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

    /// <summary>Policy for API responses: nothing may be loaded or framed.</summary>
    public const string ApiContentSecurityPolicy = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

    /// <summary>Swagger UI (served only in Development) needs an inline bootstrap script; never applied to the app or the API.</summary>
    public const string SwaggerContentSecurityPolicy =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
        + "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

    public const string PermissionsPolicy =
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()";

    public Task InvokeAsync(HttpContext context)
    {
        var isApi = context.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase);
        var isSwagger = context.Request.Path.StartsWithSegments("/swagger", StringComparison.OrdinalIgnoreCase);
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            headers["Content-Security-Policy"] = isApi ? ApiContentSecurityPolicy : isSwagger ? SwaggerContentSecurityPolicy : AppContentSecurityPolicy;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Permissions-Policy"] = PermissionsPolicy;
            headers["Cross-Origin-Opener-Policy"] = "same-origin";
            if (isApi)
            {
                headers["Cache-Control"] = "no-store";
                headers["Pragma"] = "no-cache";
            }

            return Task.CompletedTask;
        });
        return next(context);
    }
}
