using System.Diagnostics;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Identity.Api;

/// <summary>
/// Turns a failed <see cref="Result"/> into the standard <c>application/problem+json</c> body (same shape as the API project's
/// <c>Problems</c> helper, which modules cannot reference): <c>code</c>, <c>traceId</c>, optional <c>errors</c> and <c>meta</c>.
/// </summary>
internal static class IdentityProblems
{
    private const string ContentType = "application/problem+json";

    public static ObjectResult Problem(this ControllerBase controller, Error error)
    {
        var status = error.Type switch
        {
            ErrorType.Validation => StatusCodes.Status400BadRequest,
            ErrorType.Unauthenticated => StatusCodes.Status401Unauthorized,
            ErrorType.Forbidden => StatusCodes.Status403Forbidden,
            ErrorType.NotFound => StatusCodes.Status404NotFound,
            ErrorType.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status500InternalServerError,
        };
        var lower = error.Code.ToLowerInvariant().Replace('_', ' ');
        var problem = new ProblemDetails
        {
            Type = "urn:matterflow:error:" + error.Code.ToLowerInvariant().Replace('_', '-'),
            Title = char.ToUpperInvariant(lower[0]) + lower[1..],
            Status = status,
            Detail = error.Message,
        };
        problem.Extensions["code"] = error.Code;
        problem.Extensions["traceId"] = Activity.Current?.Id ?? controller.HttpContext.TraceIdentifier;
        if (error.FieldErrors is { Count: > 0 })
            problem.Extensions["errors"] = error.FieldErrors;
        if (error.Meta is { Count: > 0 })
            problem.Extensions["meta"] = error.Meta;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { ContentType } };
    }

    public static IActionResult ToActionResult<T>(this ControllerBase controller, Result<T> result) =>
        result.IsFailure ? controller.Problem(result.Error!) : controller.Ok(result.Value);

    public static IActionResult ToActionResult(this ControllerBase controller, Result result) =>
        result.IsFailure ? controller.Problem(result.Error!) : controller.NoContent();
}
