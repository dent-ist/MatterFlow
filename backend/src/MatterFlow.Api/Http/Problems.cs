using System.Diagnostics;
using System.Text;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace MatterFlow.Api.Http;

/// <summary>Builds RFC 9457 <c>application/problem+json</c> responses with the stable MatterFlow extensions (architecture section 11).</summary>
public static class Problems
{
    public const string ContentType = "application/problem+json";

    public static int StatusFor(ErrorType type) => type switch
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

    /// <summary>Default stable code for a bare HTTP status (used for framework-generated responses such as 404/401/415).</summary>
    public static string CodeForStatus(int status) => status switch
    {
        StatusCodes.Status400BadRequest => ErrorCodes.ValidationFailed,
        StatusCodes.Status401Unauthorized => ErrorCodes.Unauthenticated,
        StatusCodes.Status403Forbidden => ErrorCodes.PermissionDenied,
        StatusCodes.Status404NotFound => ErrorCodes.NotFound,
        StatusCodes.Status409Conflict => ErrorCodes.ConcurrencyConflict,
        StatusCodes.Status413PayloadTooLarge => ErrorCodes.PayloadTooLarge,
        StatusCodes.Status415UnsupportedMediaType => ErrorCodes.UnsupportedMediaType,
        StatusCodes.Status405MethodNotAllowed => ErrorCodes.MethodNotAllowed,
        StatusCodes.Status429TooManyRequests => ErrorCodes.TooManyRequests,
        _ => ErrorCodes.InternalError,
    };

    public static ProblemDetails Create(
        HttpContext http,
        int status,
        string code,
        string title,
        string? detail = null,
        IReadOnlyDictionary<string, IReadOnlyList<FieldError>>? errors = null,
        IReadOnlyDictionary<string, object?>? meta = null)
    {
        var problem = new ProblemDetails
        {
            Type = TypeUri(code),
            Title = title,
            Status = status,
            Detail = detail,
        };
        Decorate(problem, http, code);
        if (errors is { Count: > 0 })
            problem.Extensions["errors"] = errors;
        if (meta is { Count: > 0 })
            problem.Extensions["meta"] = meta;
        return problem;
    }

    public static ProblemDetails FromError(HttpContext http, Error error) =>
        Create(http, StatusFor(error.Type), error.Code, Humanize(error.Code), error.Message, error.FieldErrors, error.Meta);

    public static ProblemDetails FromModelState(HttpContext http, ModelStateDictionary modelState)
    {
        var errors = new Dictionary<string, IReadOnlyList<FieldError>>();
        foreach (var (key, entry) in modelState)
        {
            if (entry.Errors.Count == 0)
                continue;
            errors[CamelCasePath(key)] = entry.Errors
                .Select(e => new FieldError("INVALID", string.IsNullOrEmpty(e.ErrorMessage) ? "The value is invalid." : e.ErrorMessage))
                .ToArray();
        }

        return Create(http, StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed, "Validation failed", "One or more validation errors occurred.", errors);
    }

    /// <summary>Adds <c>type</c>-independent extensions (code, traceId) to a problem; used for framework-generated problems too.</summary>
    public static void Decorate(ProblemDetails problem, HttpContext http, string code)
    {
        problem.Extensions["code"] = code;
        problem.Extensions["traceId"] = Activity.Current?.Id ?? http.TraceIdentifier;
    }

    public static string TypeUri(string code) => "urn:matterflow:error:" + code.ToLowerInvariant().Replace('_', '-');

    public static string Humanize(string code)
    {
        var lower = code.ToLowerInvariant().Replace('_', ' ');
        return lower.Length == 0 ? lower : char.ToUpperInvariant(lower[0]) + lower[1..];
    }

    private static string CamelCasePath(string key)
    {
        if (string.IsNullOrEmpty(key) || key == "$")
            return string.Empty;
        key = key.StartsWith("$.", StringComparison.Ordinal) ? key[2..] : key;
        var sb = new StringBuilder(key.Length);
        var segmentStart = true;
        foreach (var c in key)
        {
            sb.Append(segmentStart ? char.ToLowerInvariant(c) : c);
            segmentStart = c is '.' or '[';
        }

        return sb.ToString();
    }
}

/// <summary>Controller helpers to turn <see cref="Result"/> values into responses.</summary>
public static class ResultExtensions
{
    public static ObjectResult Problem(this ControllerBase controller, Error error)
    {
        var problem = Problems.FromError(controller.HttpContext, error);
        return new ObjectResult(problem) { StatusCode = problem.Status, ContentTypes = { Problems.ContentType } };
    }

    public static IActionResult ToActionResult<T>(this ControllerBase controller, Result<T> result, Func<T, IActionResult>? onSuccess = null) =>
        result.IsFailure
            ? controller.Problem(result.Error!)
            : onSuccess is null ? controller.Ok(result.Value) : onSuccess(result.Value);

    public static IActionResult ToActionResult(this ControllerBase controller, Result result, Func<IActionResult>? onSuccess = null) =>
        result.IsFailure
            ? controller.Problem(result.Error!)
            : onSuccess is null ? controller.NoContent() : onSuccess();
}
