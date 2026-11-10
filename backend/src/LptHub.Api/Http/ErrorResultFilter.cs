using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace MatterFlow.Api.Http;

/// <summary>
/// Module controllers cannot reference the host's <see cref="Problems"/> helpers (dependency rules), so they return
/// <c>new ObjectResult(error)</c> for a failed <see cref="Result"/>. This filter turns such a result into the standard
/// <c>application/problem+json</c> response with the stable code (architecture section 11).
/// </summary>
public sealed class ErrorResultFilter : IAlwaysRunResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is ObjectResult { Value: Error error })
        {
            var problem = Problems.FromError(context.HttpContext, error);
            context.Result = new ObjectResult(problem) { StatusCode = problem.Status, ContentTypes = { Problems.ContentType } };
        }
    }

    public void OnResultExecuted(ResultExecutedContext context)
    {
    }
}
