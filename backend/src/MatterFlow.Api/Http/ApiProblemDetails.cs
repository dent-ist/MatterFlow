using System.ComponentModel.DataAnnotations;

namespace MatterFlow.Api.Http;

/// <summary>
/// Documented shape of every error response (<c>application/problem+json</c>). Used only for OpenAPI/client generation;
/// the runtime body is produced by <see cref="Problems"/>.
/// </summary>
public sealed class ApiProblemDetails
{
    /// <summary>URI reference identifying the error type, e.g. <c>urn:matterflow:error:validation-failed</c>.</summary>
    public string? Type { get; init; }

    public string? Title { get; init; }

    public int? Status { get; init; }

    public string? Detail { get; init; }

    public string? Instance { get; init; }

    /// <summary>Stable machine-readable error code.</summary>
    [Required]
    public string Code { get; init; } = string.Empty;

    /// <summary>Correlates the response with server logs.</summary>
    public string? TraceId { get; init; }

    /// <summary>Field errors keyed by DTO property path or <c>form:&lt;fieldKey&gt;</c>.</summary>
    public Dictionary<string, List<ApiFieldError>>? Errors { get; init; }

    /// <summary>Extra machine-readable context (for example <c>currentRowVersion</c>, <c>unresolvedStepIds</c>).</summary>
    public Dictionary<string, object?>? Meta { get; init; }
}

public sealed class ApiFieldError
{
    [Required]
    public string Code { get; init; } = string.Empty;

    [Required]
    public string Message { get; init; } = string.Empty;
}
