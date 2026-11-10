using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Reports.Domain.Parameters;

/// <summary>Maps binder errors to the product's 422 validation shape: one entry per parameter name with stable codes.</summary>
public static class ParameterErrors
{
    public const string Code = "REPORT_PARAMETERS_INVALID";

    public static Error ToError(IEnumerable<ParameterError> errors)
    {
        var byName = errors
            .GroupBy(e => e.Name, StringComparer.Ordinal)
            .ToDictionary(g => "parameters." + g.Key, g => (IReadOnlyList<FieldError>)g.Select(e => new FieldError(e.Code, e.Message)).ToList());
        return Error.Validation("Some parameter values are not valid.", byName, Code);
    }
}
