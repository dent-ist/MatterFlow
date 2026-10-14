using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Api.Http;

/// <summary>The single exception-handling point: maps known exceptions to ProblemDetails; everything else is a 500 with a traceId only.</summary>
public sealed class GlobalExceptionHandler(IProblemDetailsService problemDetails, ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var problem = exception switch
        {
            ErrorException e => Problems.FromError(httpContext, e.Error),
            DbUpdateConcurrencyException => Problems.Create(
                httpContext,
                StatusCodes.Status409Conflict,
                ErrorCodes.ConcurrencyConflict,
                "Concurrency conflict",
                "The record was changed by someone else. Reload and try again."),
            _ => null,
        };

        if (problem is null)
        {
            logger.LogError(exception, "Unhandled exception");
            problem = Problems.Create(
                httpContext,
                StatusCodes.Status500InternalServerError,
                ErrorCodes.InternalError,
                "An unexpected error occurred");
        }

        httpContext.Response.StatusCode = problem.Status ?? StatusCodes.Status500InternalServerError;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext { HttpContext = httpContext, ProblemDetails = problem, Exception = exception });
    }
}
