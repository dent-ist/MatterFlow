namespace MatterFlow.SharedKernel.Results;

/// <summary>A single field-level validation message. <see cref="Code"/> is a stable machine string.</summary>
public sealed record FieldError(string Code, string Message);

/// <summary>A failure description: stable <see cref="Code"/>, human message, optional per-field errors and extra metadata.</summary>
public sealed record Error
{
    public Error(
        ErrorType type,
        string code,
        string message,
        IReadOnlyDictionary<string, IReadOnlyList<FieldError>>? fieldErrors = null,
        IReadOnlyDictionary<string, object?>? meta = null)
    {
        Type = type;
        Code = code;
        Message = message;
        FieldErrors = fieldErrors;
        Meta = meta;
    }

    public ErrorType Type { get; }

    public string Code { get; }

    public string Message { get; }

    /// <summary>Errors keyed by DTO property path or <c>form:&lt;fieldKey&gt;</c>.</summary>
    public IReadOnlyDictionary<string, IReadOnlyList<FieldError>>? FieldErrors { get; }

    public IReadOnlyDictionary<string, object?>? Meta { get; }

    public static Error Validation(string message, IReadOnlyDictionary<string, IReadOnlyList<FieldError>>? fieldErrors = null, string code = ErrorCodes.ValidationFailed) =>
        new(ErrorType.Validation, code, message, fieldErrors);

    public static Error Validation(string field, string fieldCode, string message, string code = ErrorCodes.ValidationFailed) =>
        new(
            ErrorType.Validation,
            code,
            message,
            new Dictionary<string, IReadOnlyList<FieldError>> { [field] = [new FieldError(fieldCode, message)] });

    public static Error NotFound(string message) => new(ErrorType.NotFound, ErrorCodes.NotFound, message);

    public static Error Conflict(string code, string message, IReadOnlyDictionary<string, object?>? meta = null) =>
        new(ErrorType.Conflict, code, message, meta: meta);

    public static Error Forbidden(string message, string code = ErrorCodes.PermissionDenied) =>
        new(ErrorType.Forbidden, code, message);

    public static Error Unauthenticated(string message) => new(ErrorType.Unauthenticated, ErrorCodes.Unauthenticated, message);
}
