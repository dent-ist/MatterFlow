using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace MatterFlow.Api.Http;

/// <summary>Per-user request budgets per minute for the JSON API (security review 2, SEC2-03). A value of 0 or less turns that budget off.</summary>
public sealed class ApiRateLimitOptions
{
    public const string SectionName = "RateLimits";

    /// <summary>All <c>/api</c> calls of one user. Generous: a page load makes a handful of calls.</summary>
    public int ApiPerMinute { get; set; } = 1200;

    /// <summary>Adding, editing or deleting task comments (each one runs the HTML sanitizer).</summary>
    public int CommentWritesPerMinute { get; set; } = 30;

    /// <summary>Creating or changing Tasks, steps, links (every non-GET call under <c>/api/v1/tasks</c>).</summary>
    public int TaskWritesPerMinute { get; set; } = 120;

    /// <summary>Global search typeahead (one request per pause in typing).</summary>
    public int SearchPerMinute { get; set; } = 180;

    /// <summary>Advanced search (a hit query plus a count query).</summary>
    public int AdvancedSearchPerMinute { get; set; } = 60;

    /// <summary>Audit search, facets and the audit event list (scans of the ever-growing audit table).</summary>
    public int AuditPerMinute { get; set; } = 60;

    /// <summary>The dashboard (about 15 queries per call).</summary>
    public int DashboardPerMinute { get; set; } = 60;

    /// <summary>Longest accepted query string of an API call (characters).</summary>
    public int MaxQueryStringLength { get; set; } = 4096;

    /// <summary>Most query parameter values (repeated keys count each time) of an API call.</summary>
    public int MaxQueryValues { get; set; } = 100;
}

/// <summary>
/// Registers the per-user budgets next to the intake limiter (which owns the global limiter slot): the budgets are chained behind it in a
/// post-configure step. Rejected calls get 429 with <c>Retry-After</c> and the framework problem-details body with the stable code
/// <c>TOO_MANY_REQUESTS</c>. The partition is the signed-in user, so one user cannot slow the others.
/// </summary>
public static class ApiRateLimiting
{
    public static IServiceCollection AddApiRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<ApiRateLimitOptions>(configuration.GetSection(ApiRateLimitOptions.SectionName));
        services.AddOptions<RateLimiterOptions>().PostConfigure<IOptions<ApiRateLimitOptions>>((limiter, options) =>
        {
            var budgets = Create(options.Value);
            limiter.GlobalLimiter = limiter.GlobalLimiter is null ? budgets : PartitionedRateLimiter.CreateChained(limiter.GlobalLimiter, budgets);
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            var previous = limiter.OnRejected;
            limiter.OnRejected = async (context, token) =>
            {
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                    context.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
                if (previous is not null)
                    await previous(context, token);
            };
        });
        return services;
    }

    internal static PartitionedRateLimiter<HttpContext> Create(ApiRateLimitOptions o) =>
        PartitionedRateLimiter.CreateChained(
            Budget("api", o.ApiPerMinute, c => IsApi(c)),
            Budget("comment-write", o.CommentWritesPerMinute, c => IsWrite(c) && Under(c, "/api/v1/tasks") && c.Request.Path.Value!.Contains("/comments", StringComparison.OrdinalIgnoreCase)),
            Budget("task-write", o.TaskWritesPerMinute, c => IsWrite(c) && Under(c, "/api/v1/tasks")),
            Budget("search", o.SearchPerMinute, c => IsRead(c) && Is(c, "/api/v1/search")),
            Budget("search-advanced", o.AdvancedSearchPerMinute, c => IsRead(c) && Is(c, "/api/v1/search/advanced")),
            Budget("audit", o.AuditPerMinute, c => IsRead(c) && Under(c, "/api/v1/audit")),
            Budget("dashboard", o.DashboardPerMinute, c => IsRead(c) && Is(c, "/api/v1/dashboard")));

    private static PartitionedRateLimiter<HttpContext> Budget(string name, int perMinute, Func<HttpContext, bool> applies) =>
        PartitionedRateLimiter.Create<HttpContext, string>(context =>
            perMinute > 0 && applies(context)
                ? RateLimitPartition.GetFixedWindowLimiter(
                    name + ":" + (context.User.Identity?.Name ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown"),
                    _ => new FixedWindowRateLimiterOptions { PermitLimit = perMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })
                : RateLimitPartition.GetNoLimiter(name + ":none"));

    private static bool IsApi(HttpContext c) => Under(c, "/api");

    private static bool IsRead(HttpContext c) => HttpMethods.IsGet(c.Request.Method);

    private static bool IsWrite(HttpContext c) => !HttpMethods.IsGet(c.Request.Method) && !HttpMethods.IsHead(c.Request.Method) && !HttpMethods.IsOptions(c.Request.Method);

    private static bool Is(HttpContext c, string path) =>
        string.Equals(c.Request.Path.Value?.TrimEnd('/'), path, StringComparison.OrdinalIgnoreCase);

    private static bool Under(HttpContext c, string path) => c.Request.Path.StartsWithSegments(path, StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// Caps the size of the query string of API calls (SEC2-03): a long list of repeated parameters (<c>status=1&amp;status=2...</c>) costs
/// parsing time and, for filters that become <c>IN</c> lists, query plan size. Over the cap the call is rejected with 400 <c>QUERY_TOO_LARGE</c>.
/// </summary>
public sealed class QueryLimitMiddleware(RequestDelegate next, IOptions<ApiRateLimitOptions> options)
{
    public const string Code = "QUERY_TOO_LARGE";

    public async Task InvokeAsync(HttpContext context)
    {
        var limits = options.Value;
        var query = context.Request.QueryString;
        if (context.Request.Path.StartsWithSegments("/api") && query.HasValue && (query.Value!.Length > limits.MaxQueryStringLength || context.Request.Query.Sum(q => q.Value.Count) > limits.MaxQueryValues))
        {
            var problem = Problems.Create(context, StatusCodes.Status400BadRequest, Code, "Query too large", "The request has too many or too long query parameters.");
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await Results.Json(problem, contentType: Problems.ContentType, statusCode: StatusCodes.Status400BadRequest).ExecuteAsync(context);
            return;
        }

        await next(context);
    }
}
