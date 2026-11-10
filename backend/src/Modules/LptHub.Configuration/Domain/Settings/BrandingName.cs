using System.Globalization;
using System.Text;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Configuration.Domain.Settings;

/// <summary>
/// Rules for the application name (design section 6, decision AM.3): trimmed, runs of spaces collapsed, 1 to 40 characters, no markup
/// (<c>&lt;</c> and <c>&gt;</c> are refused), no control, format or bidirectional characters. <c>&amp;</c> is allowed. The name is only ever
/// rendered as text; these rules are a second line of defence. Pure function, no I/O.
/// </summary>
public static class BrandingName
{
    public const string Default = "MatterFlow";

    public const int MaxLength = 40;

    public const string Field = "appName";

    /// <summary>Returns the stored form of <paramref name="input"/> or a validation failure with a stable <c>BRANDING_NAME_*</c> code.</summary>
    public static Result<string> Normalize(string? input)
    {
        if (input is null)
            return Fail(ErrorCodes.BrandingNameRequired, "Enter an application name.");

        // Runes, so an unpaired surrogate (which shows up as U+FFFD) is refused like any other invalid character.
        foreach (var rune in input.EnumerateRunes())
        {
            if (rune.Value is '<' or '>' || IsForbidden(rune))
                return Fail(ErrorCodes.BrandingNameInvalidChars, "The name cannot contain < or >, control characters or invisible direction marks.");
        }

        // Collapse runs of whitespace (spaces, no-break spaces, ...) to one space, then trim.
        var parts = input.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var name = string.Join(' ', parts);
        if (name.Length == 0)
            return Fail(ErrorCodes.BrandingNameRequired, "Enter an application name.");
        if (name.Length > MaxLength)
            return Fail(ErrorCodes.BrandingNameTooLong, $"Use at most {MaxLength} characters.");

        return name;
    }

    private static bool IsForbidden(Rune rune)
    {
        if (rune == Rune.ReplacementChar)
            return true;

        var category = Rune.GetUnicodeCategory(rune);
        if (category is UnicodeCategory.SpaceSeparator or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
            return false; // spaces are collapsed above

        return category is UnicodeCategory.Control or UnicodeCategory.Format or UnicodeCategory.PrivateUse or UnicodeCategory.OtherNotAssigned
            or UnicodeCategory.Surrogate;
    }

    private static Error Fail(string code, string message) => Error.Validation(Field, code, message, code);
}
