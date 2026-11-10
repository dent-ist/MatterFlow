using MatterFlow.SharedKernel.Results;

namespace MatterFlow.SharedKernel.ValueObjects;

/// <summary>
/// Client/Matter number (addendum B). Input is 1 to 5 ASCII digits (surrounding whitespace trimmed);
/// the value is normalized to a zero-padded 5-character string (<c>343</c> becomes <c>00343</c>).
/// All-zero numbers are rejected. Equality is on the normalized value.
/// </summary>
public readonly record struct BusinessNumber
{
    public const int Length = 5;

    private BusinessNumber(string value) => Value = value;

    /// <summary>The normalized 5-character string; empty for <c>default</c>.</summary>
    public string Value { get; } = string.Empty;

    public static Result<BusinessNumber> Parse(string? input)
    {
        var s = input?.Trim();
        if (string.IsNullOrEmpty(s))
            return Invalid("A number is required.");
        if (s.Length > Length)
            return Invalid($"A number may have at most {Length} digits.");
        foreach (var c in s)
        {
            if (c is < '0' or > '9')
                return Invalid("A number may contain only the digits 0-9.");
        }

        if (s.All(c => c == '0'))
            return Invalid("A number cannot be all zeros.");

        return new BusinessNumber(s.PadLeft(Length, '0'));
    }

    public static bool TryParse(string? input, out BusinessNumber number)
    {
        var r = Parse(input);
        number = r.IsSuccess ? r.Value : default;
        return r.IsSuccess;
    }

    /// <summary>Builds from an already-normalized stored value; throws if it is not valid.</summary>
    public static BusinessNumber FromStored(string value)
    {
        var r = Parse(value);
        return r.IsSuccess && r.Value.Value == value
            ? r.Value
            : throw new ArgumentException($"'{value}' is not a normalized business number.", nameof(value));
    }

    public override string ToString() => Value;

    public static implicit operator string(BusinessNumber number) => number.Value;

    private static Error Invalid(string message) =>
        new(ErrorType.Validation, ErrorCodes.InvalidNumberFormat, message);
}
