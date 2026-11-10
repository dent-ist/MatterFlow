using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Data.SqlClient;
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
            // A deadlock victim (SQL error 1205) rolled back cleanly and the same call succeeds when repeated: tell the client to retry (E2E-F3).
            _ when IsDeadlock(exception) => Problems.Create(
                httpContext,
                StatusCodes.Status409Conflict,
                ErrorCodes.ConcurrencyConflict,
                "Concurrency conflict",
                "Another change was in progress at the same moment. Try again."),
            // A read that exceeded the command timeout (SQL error -2): the query was cancelled and the connection is free again.
            _ when IsCommandTimeout(exception) => Problems.Create(
                httpContext,
                StatusCodes.Status503ServiceUnavailable,
                ErrorCodes.QueryTimeout,
                "The request took too long",
                "The query ran past the time limit and was cancelled. Narrow the filters and try again."),
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

    /// <summary>True when the exception, or one wrapped inside it, is a SQL command timeout (provider error number -2).</summary>
    public static bool IsCommandTimeout(Exception exception)
    {
        for (var ex = exception; ex is not null; ex = ex.InnerException)
        {
            if (ex is SqlException { Number: -2 })
                return true;
        }

        return false;
    }

    /// <summary>True when the exception, or one wrapped inside it, is SQL Server error 1205 (chosen as the deadlock victim).</summary>
    public static bool IsDeadlock(Exception exception)
    {
        for (var ex = exception; ex is not null; ex = ex.InnerException)
        {
            if (ex is SqlException { Number: 1205 })
                return true;
        }

        return false;
    }
}
