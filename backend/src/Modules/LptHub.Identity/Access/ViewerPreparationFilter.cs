using MatterFlow.SharedKernel.Visibility;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Identity.Access;

/// <summary>
/// Runs after authorization and before an action marked <see cref="PreparesViewerAttribute"/>: loads what <see cref="MatterVisibility"/> needs to write the sensitive-matter rule as short id lists (the sensitive
/// matters the caller manages), one indexed read of a few rows per request and none while the go-live switch is off or for a see-all caller (issue #810).
/// </summary>
public sealed class ViewerPreparationFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        // The filter is global, so it must not depend on the database: the visibility service is resolved only for an action that asks for it (the ping and the health checks run without a database).
        if (context.ActionDescriptor.EndpointMetadata.OfType<PreparesViewerAttribute>().FirstOrDefault() is { } mark)
            await context.HttpContext.RequestServices.GetRequiredService<MatterVisibility>().PrepareAsync(mark.Stamp, context.HttpContext.RequestAborted);

        await next();
    }
}
