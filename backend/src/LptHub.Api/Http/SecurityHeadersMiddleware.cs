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
/// <item><c>Cache-Control: no-store</c> on <c>/api</c>: lists of users, audit events and forms must not sit in a browser or proxy cache
/// (except a response that itself says <c>private, no-cache</c>, the revalidated notification poll, and the public branding responses under
/// <c>/api/v1/branding</c>, which say <c>public</c> with a <c>max-age</c> so the icon and name are cacheable; epic #850).</item>
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

    /// <summary>The only API paths whose responses may set their own public cache header (the application name and icon, readable without signing in).</summary>
    public const string PublicBrandingPath = "/api/v1/branding";

    public Task InvokeAsync(HttpContext context)
    {
        var isBranding = context.Request.Path.StartsWithSegments(PublicBrandingPath, StringComparison.OrdinalIgnoreCase);
        var isApi = context.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase);
        var isSwagger = context.Request.Path.StartsWithSegments("/swagger", StringComparison.OrdinalIgnoreCase);
        context.Response.OnStarting(() =>
        {
            var headers = context.Response.Headers;
            // An SVG icon brings its own sandboxing policy; it is kept only on the branding path and only when it really sandboxes.
            var ownPolicy = headers.ContentSecurityPolicy.ToString();
            headers["Content-Security-Policy"] = isBranding && ownPolicy.Contains("sandbox", StringComparison.Ordinal)
                ? ownPolicy
                : isApi ? ApiContentSecurityPolicy : isSwagger ? SwaggerContentSecurityPolicy : AppContentSecurityPolicy;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Permissions-Policy"] = PermissionsPolicy;
            headers["Cross-Origin-Opener-Policy"] = "same-origin";
            if (isApi)
            {
                // One exception: an endpoint may ask for "private, no-cache" (store, but revalidate every time) so that an ETag works; the notification
                // poll does, because it is called every 30 seconds and almost always unchanged. Shared caches may still never keep it.
                var own = headers.CacheControl.ToString();
                var revalidated = own.Contains("private", StringComparison.OrdinalIgnoreCase) && own.Contains("no-cache", StringComparison.OrdinalIgnoreCase);
                // The narrow exception for the public branding paths: a successful (or 304) response that itself says "public, max-age=...".
                var publicBranding = isBranding
                    && context.Response.StatusCode is StatusCodes.Status200OK or StatusCodes.Status304NotModified
                    && own.Contains("public", StringComparison.OrdinalIgnoreCase)
                    && own.Contains("max-age=", StringComparison.OrdinalIgnoreCase);
                if (!revalidated && !publicBranding)
                    headers["Cache-Control"] = "no-store";
                if (!publicBranding)
                    headers["Pragma"] = "no-cache";
                else
                    headers.Remove("Pragma");
            }

            return Task.CompletedTask;
        });
        return next(context);
    }
}
