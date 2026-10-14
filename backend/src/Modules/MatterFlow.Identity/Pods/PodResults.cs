using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Identity.Pods;

/// <summary>Turns a <see cref="Result"/> into an action result; a failure becomes an <see cref="ObjectResult"/> carrying the <see cref="Error"/>, which the host renders as problem+json.</summary>
internal static class PodResults
{
    public static IActionResult Failure(Error error) => new ObjectResult(error);

    public static IActionResult From<T>(Result<T> result, Func<T, IActionResult>? onSuccess = null) =>
        result.IsFailure
            ? Failure(result.Error!)
            : onSuccess is null ? new OkObjectResult(result.Value) : onSuccess(result.Value);

    public static IActionResult From(Result result) =>
        result.IsFailure ? Failure(result.Error!) : new NoContentResult();
}
