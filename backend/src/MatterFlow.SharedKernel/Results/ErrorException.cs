namespace MatterFlow.SharedKernel.Results;

/// <summary>
/// Carries a failed <see cref="Result"/> out of a module controller (modules cannot reference the Api host's ProblemDetails helpers).
/// The host's single exception handler maps it to an RFC 9457 problem with the error's stable code (architecture section 11).
/// </summary>
public sealed class ErrorException(Error error) : Exception(error.Message)
{
    public Error Error { get; } = error;
}

public static class ResultThrowExtensions
{
    /// <summary>Returns the value, or throws <see cref="ErrorException"/> for the host to turn into a problem response.</summary>
    public static T OrThrow<T>(this Result<T> result) => result.IsSuccess ? result.Value : throw new ErrorException(result.Error!);

    /// <summary>Does nothing on success, or throws <see cref="ErrorException"/> for the host to turn into a problem response.</summary>
    public static void OrThrow(this Result result)
    {
        if (result.IsFailure)
            throw new ErrorException(result.Error!);
    }
}
