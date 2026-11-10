using System.Diagnostics;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Configuration.Api;

/// <summary>
/// Turns a failed <see cref="Result"/> into the standard RFC 9457 response (architecture section 11). Same shape as the host's
/// <c>Problems</c> helper, which modules cannot reference: <c>type</c>, <c>title</c>, <c>status</c>, <c>detail</c>, <c>code</c>, <c>traceId</c>, <c>errors</c>, <c>meta</c>.
/// </summary>
internal static class ProblemResults
{
    public static ObjectResult Problem(this ControllerBase controller, Error error)
    {
        var status = error.Type switch
        {
            ErrorType.Validation => StatusCodes.Status400BadRequest,
            ErrorType.Unauthenticated => StatusCodes.Status401Unauthorized,
            ErrorType.Forbidden => StatusCodes.Status403Forbidden,
            ErrorType.NotFound => StatusCodes.Status404NotFound,
            ErrorType.Conflict => StatusCodes.Status409Conflict,
            ErrorType.PayloadTooLarge => StatusCodes.Status413PayloadTooLarge,
            ErrorType.UnsupportedMediaType => StatusCodes.Status415UnsupportedMediaType,
            _ => StatusCodes.Status500InternalServerError,
        };
        var lower = error.Code.ToLowerInvariant().Replace('_', ' ');
        var problem = new ProblemDetails
        {
            Type = "urn:matterflow:error:" + error.Code.ToLowerInvariant().Replace('_', '-'),
            Title = lower.Length == 0 ? lower : char.ToUpperInvariant(lower[0]) + lower[1..],
            Status = status,
            Detail = error.Message,
        };
        problem.Extensions["code"] = error.Code;
        problem.Extensions["traceId"] = Activity.Current?.Id ?? controller.HttpContext.TraceIdentifier;
        if (error.FieldErrors is { Count: > 0 })
        {
            problem.Extensions["errors"] = error.FieldErrors;
        }

        if (error.Meta is { Count: > 0 })
        {
            problem.Extensions["meta"] = error.Meta;
        }

        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }

    public static IActionResult ToActionResult<T>(this ControllerBase controller, Result<T> result, Func<T, IActionResult>? onSuccess = null) =>
        result.IsFailure ? controller.Problem(result.Error!) : onSuccess is null ? controller.Ok(result.Value) : onSuccess(result.Value);

    public static IActionResult ToActionResult(this ControllerBase controller, Result result) =>
        result.IsFailure ? controller.Problem(result.Error!) : controller.NoContent();
}
