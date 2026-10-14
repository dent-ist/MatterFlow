using MatterFlow.SharedKernel.Paging;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace MatterFlow.Api.Http;

/// <summary>
/// Sets a shorter SQL command timeout (<see cref="ReadQueryOptions.ReadCommandTimeoutSeconds"/>, 15 s) on the request's database context for the
/// read endpoints that scan the big tables: the three Task queues, search, the audit browser and the dashboard. Writes and every other read keep
/// the provider default. A query over the limit surfaces as 503 <c>QUERY_TIMEOUT</c> (<see cref="GlobalExceptionHandler"/>).
/// </summary>
public sealed class ReadQueryTimeoutFilter(IOptions<ReadQueryOptions> options) : IAsyncActionFilter
{
    private static readonly string[] Prefixes =
    [
        "/api/v1/task-queue", "/api/v1/my-work", "/api/v1/pod-work", "/api/v1/search", "/api/v1/audit", "/api/v1/dashboard",
    ];

    public static bool Applies(string method, PathString path) =>
        HttpMethods.IsGet(method) && Prefixes.Any(p => path.StartsWithSegments(p, StringComparison.OrdinalIgnoreCase));

    public Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var seconds = options.Value.ReadCommandTimeoutSeconds;
        var request = context.HttpContext.Request;
        if (seconds > 0 && Applies(request.Method, request.Path))
            context.HttpContext.RequestServices.GetRequiredService<DbContext>().Database.SetCommandTimeout(seconds);

        return next();
    }
}
