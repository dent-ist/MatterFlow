namespace MatterFlow.SharedKernel.Results;

/// <summary>Category of a failure; the API layer maps it to an HTTP status (architecture section 11).</summary>
public enum ErrorType
{
    Validation,
    Unauthenticated,
    Forbidden,
    NotFound,
    Conflict,
    PayloadTooLarge,
    UnsupportedMediaType,
}
