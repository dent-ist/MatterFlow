using System.Text;

namespace MatterFlow.Configuration.Domain.Forms.Rules;

/// <summary>Per-field validation error codes (contracts/form-rules.md section 3).</summary>
public enum FormErrorCode
{
    Required,
    InvalidType,
    OutOfRange,
    TooLong,
    Pattern,
    OptionNotAllowed,
    UnknownField,
}

/// <summary>Definition-validity (publish-time) error codes (contracts/form-rules.md section 4).</summary>
public enum FormDefinitionErrorCode
{
    DuplicateFieldKey,
    DuplicateOptionKey,
    SchemaViolation,
    RuleTooDeep,
    UnknownFieldReference,
    InvalidReferenceTarget,
    SelfReference,
    CircularDependency,
    OperatorTypeMismatch,
    LiteralTypeMismatch,
    UnknownOptionReference,
    InvalidSection,
    InvalidFieldKey,
    UnknownControl,
    InvalidOptionKey,
    NoOptions,
    InvalidValidation,
    InvalidPattern,
}

/// <summary>Wire names (<c>UPPER_SNAKE_CASE</c>) of the error codes.</summary>
public static class FormCodeNames
{
    /// <summary>Wire name of a field error code, for example <c>OPTION_NOT_ALLOWED</c>.</summary>
    public static string ToWireName(this FormErrorCode code) => Snake(code.ToString());

    /// <summary>Wire name of a definition error code, for example <c>CIRCULAR_DEPENDENCY</c>.</summary>
    public static string ToWireName(this FormDefinitionErrorCode code) => Snake(code.ToString());

    private static string Snake(string pascal)
    {
        var sb = new StringBuilder(pascal.Length + 4);
        for (var i = 0; i < pascal.Length; i++)
        {
            if (i > 0 && char.IsUpper(pascal[i]))
            {
                sb.Append('_');
            }

            sb.Append(char.ToUpperInvariant(pascal[i]));
        }

        return sb.ToString();
    }
}

/// <summary>A validation error of one submitted field.</summary>
/// <param name="FieldKey">The field (or unknown submitted key) the error belongs to.</param>
/// <param name="Code">The error code.</param>
/// <param name="Message">Human-readable English detail; not part of the contract.</param>
public sealed record FormFieldError(string FieldKey, FormErrorCode Code, string Message);

/// <summary>A definition-validity error found at publish time.</summary>
/// <param name="Code">The error code.</param>
/// <param name="FieldKey">The field the problem was found on, when attributable.</param>
/// <param name="Message">Human-readable English detail; not part of the contract.</param>
public sealed record FormDefinitionError(FormDefinitionErrorCode Code, string? FieldKey, string Message);

/// <summary>Whether REQUIRED is enforced.</summary>
public enum FormEvaluationMode
{
    /// <summary>Full validation (default).</summary>
    Submit,

    /// <summary>Identical to <see cref="Submit"/> except REQUIRED is not emitted.</summary>
    Draft,
}
