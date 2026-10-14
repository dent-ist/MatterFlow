using System.Threading.RateLimiting;
using MatterFlow.Intake.Application;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace MatterFlow.Intake.Api;

/// <summary>
/// Limits on the CPU-bound email parsing endpoints (security review SEC-02): a small number of parses at a time for the whole server and
/// a per-user request budget, so one authenticated caller cannot saturate the cores however many requests they send.
/// Rejected requests get 429 (the framework problem-details pipeline adds the stable <c>code</c>).
/// </summary>
public static class IntakeRateLimiting
{
    private const string IntakePath = "/api/v1/intake";

    /// <summary>Registers the limiter. The host must also call <c>UseRateLimiter()</c> after authentication.</summary>
    public static IServiceCollection AddIntakeRateLimiting(this IServiceCollection services)
    {
        services.AddRateLimiter(_ => { });
        services.AddOptions<RateLimiterOptions>().Configure<IOptions<IntakeOptions>>((limiter, intake) =>
        {
            var settings = intake.Value;
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            limiter.OnRejected = (context, _) =>
            {
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                    context.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
                return ValueTask.CompletedTask;
            };
            limiter.GlobalLimiter = PartitionedRateLimiter.CreateChained(
                PartitionedRateLimiter.Create<HttpContext, string>(context =>
                    IsIntake(context)
                        ? RateLimitPartition.GetConcurrencyLimiter("intake-server", _ => new ConcurrencyLimiterOptions
                        {
                            PermitLimit = Math.Max(1, settings.MaxConcurrentParses),
                            QueueLimit = Math.Max(0, settings.MaxQueuedParses),
                            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                        })
                        : RateLimitPartition.GetNoLimiter("other")),
                PartitionedRateLimiter.Create<HttpContext, string>(context =>
                    IsIntake(context)
                        ? RateLimitPartition.GetFixedWindowLimiter(
                            "user:" + (context.User.Identity?.Name ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown"),
                            _ => new FixedWindowRateLimiterOptions
                            {
                                PermitLimit = Math.Max(1, settings.RequestsPerMinutePerUser),
                                Window = TimeSpan.FromMinutes(1),
                                QueueLimit = 0,
                            })
                        : RateLimitPartition.GetNoLimiter("other")));
        });
        return services;
    }

    private static bool IsIntake(HttpContext context) =>
        HttpMethods.IsPost(context.Request.Method) && context.Request.Path.StartsWithSegments(IntakePath, StringComparison.OrdinalIgnoreCase);
}
