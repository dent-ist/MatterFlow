using System.Text.Json;

namespace MatterFlow.Configuration.Domain.Forms.Rules;

/// <summary>One option of a SELECT, RADIO or MULTISELECT field.</summary>
/// <param name="Key">Stable option key.</param>
/// <param name="AvailableWhen">Raw rule JSON; absent (null) means always available.</param>
public sealed record FormOptionDefinition(string Key, JsonElement? AvailableWhen = null);

/// <summary>Per-field validation properties. Properties that do not apply to the control are ignored.</summary>
/// <param name="Min">Inclusive lower bound: a JSON number (NUMBER) or <c>yyyy-MM-dd</c> string (DATE).</param>
/// <param name="Max">Inclusive upper bound, same shape as <paramref name="Min"/>.</param>
/// <param name="MaxLength">Maximum UTF-16 length for the text family; a value below 1 is invalid (INVALID_VALIDATION).</param>
/// <param name="Pattern">Regular expression in the portable subset (contracts/form-rules.md section 3.1; unanchored search) for the text family.</param>
/// <param name="PatternMessage">Display text (1..200 characters) for the PATTERN error; never changes the code.</param>
public sealed record FormFieldValidation(
    JsonElement? Min = null,
    JsonElement? Max = null,
    int? MaxLength = null,
    string? Pattern = null,
    string? PatternMessage = null);

/// <summary>A form field as the rule engine sees it (fragment of a <c>FormField</c>). List order is display order.</summary>
public sealed record FormFieldDefinition
{
    /// <summary>Creates a field definition.</summary>
    public FormFieldDefinition(string key, FormControl control)
    {
        Key = key;
        Control = control;
    }

    /// <summary>Stable field key, <c>^[a-z][a-z0-9_]{0,63}$</c>.</summary>
    public string Key { get; }

    /// <summary>Control type.</summary>
    public FormControl Control { get; }

    /// <summary>Static required flag.</summary>
    public bool Required { get; init; }

    /// <summary>Key of the SECTION_HEADING field this field belongs to.</summary>
    public string? Section { get; init; }

    /// <summary>Validation properties, if any.</summary>
    public FormFieldValidation? Validation { get; init; }

    /// <summary>Raw rule JSON (<c>ShowWhenJson</c>); absent means always shown.</summary>
    public JsonElement? ShowWhen { get; init; }

    /// <summary>Raw rule JSON (<c>RequiredWhenJson</c>); absent means only the static flag applies.</summary>
    public JsonElement? RequiredWhen { get; init; }

    /// <summary>Declared options in display order (option-bearing controls).</summary>
    public IReadOnlyList<FormOptionDefinition> Options { get; init; } = [];

    /// <summary>Whether the value is mirrored into the typed filter index (architecture 7.6).</summary>
    public bool IsFilterable { get; init; }
}
