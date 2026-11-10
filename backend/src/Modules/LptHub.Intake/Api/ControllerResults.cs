using System.Diagnostics;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Intake.Api;

/// <summary>
/// Turns <see cref="Result"/> values into RFC 9457 <c>application/problem+json</c> responses with the stable MatterFlow extensions
/// (<c>code</c>, <c>traceId</c>, <c>errors</c>, <c>meta</c>; architecture section 11). Modules cannot reference the host's
/// <c>Problems</c> helper (dependency rules), so this mirrors its output for module controllers.
/// </summary>
internal static class ControllerResults
{
    private const string ContentType = "application/problem+json";

    public static ObjectResult Problem(this ControllerBase controller, Error error)
    {
        var status = StatusFor(error.Type);
        var problem = new ProblemDetails
        {
            Type = "urn:matterflow:error:" + error.Code.ToLowerInvariant().Replace('_', '-'),
            Title = Humanize(error.Code),
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

    public static IActionResult ToActionResult<T>(this ControllerBase controller, Result<T> result, Func<T, IActionResult>? onSuccess = null) =>
        result.IsFailure
            ? controller.Problem(result.Error!)
            : onSuccess is null ? controller.Ok(result.Value) : onSuccess(result.Value);

    private static int StatusFor(ErrorType type) => type switch
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

    private static string Humanize(string code)
    {
        var lower = code.ToLowerInvariant().Replace('_', ' ');
        return lower.Length == 0 ? lower : char.ToUpperInvariant(lower[0]) + lower[1..];
    }
}
