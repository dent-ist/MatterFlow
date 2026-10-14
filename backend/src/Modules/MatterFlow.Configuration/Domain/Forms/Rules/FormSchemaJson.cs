using System.Text.Json;

namespace MatterFlow.Configuration.Domain.Forms.Rules;

/// <summary>Reads the JSON form-fragment shape used by contracts/form-rules.vectors.json (<c>{"fields":[...]}</c>).</summary>
public static class FormSchemaJson
{
    /// <summary>Parses a form fragment into field definitions.</summary>
    /// <exception cref="FormatException">The JSON is not a well-formed fragment (unknown control, wrong member types).</exception>
    public static IReadOnlyList<FormFieldDefinition> ParseFields(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return ParseFields(doc.RootElement);
        }
        catch (JsonException ex)
        {
            throw new FormatException("Form fragment is not valid JSON.", ex);
        }
    }

    /// <summary>Parses a form fragment element into field definitions (rule JSON is cloned, so the source may be disposed).</summary>
    /// <exception cref="FormatException">The element is not a well-formed fragment.</exception>
    public static IReadOnlyList<FormFieldDefinition> ParseFields(JsonElement fragment)
    {
        if (fragment.ValueKind != JsonValueKind.Object || !fragment.TryGetProperty("fields", out var fields) ||
            fields.ValueKind != JsonValueKind.Array)
        {
            throw new FormatException("Form fragment must be an object with a 'fields' array.");
        }

        return [.. fields.EnumerateArray().Select(ParseField)];
    }

    private static FormFieldDefinition ParseField(JsonElement element)
    {
        var key = RequiredString(element, "key");
        var controlName = RequiredString(element, "control");
        if (!FormControlExtensions.TryParseWireName(controlName, out var control))
        {
            throw new FormatException($"Unknown control '{controlName}'.");
        }

        return new FormFieldDefinition(key, control)
        {
            Required = element.TryGetProperty("required", out var required) && required.ValueKind == JsonValueKind.True,
            Section = OptionalString(element, "section"),
            Validation = element.TryGetProperty("validation", out var validation) ? ParseValidation(validation) : null,
            ShowWhen = OptionalClone(element, "showWhen"),
            RequiredWhen = OptionalClone(element, "requiredWhen"),
            Options = element.TryGetProperty("options", out var options) && options.ValueKind == JsonValueKind.Array
                ? [.. options.EnumerateArray().Select(o => new FormOptionDefinition(RequiredString(o, "key"), OptionalClone(o, "availableWhen")))]
                : [],
            IsFilterable = element.TryGetProperty("isFilterable", out var filterable) && filterable.ValueKind == JsonValueKind.True,
        };
    }

    private static FormFieldValidation ParseValidation(JsonElement element) => new(
        OptionalClone(element, "min"),
        OptionalClone(element, "max"),
        element.TryGetProperty("maxLength", out var max) && max.TryGetInt32(out var length) ? length : null,
        OptionalString(element, "pattern"));

    private static string RequiredString(JsonElement element, string name) =>
        OptionalString(element, name) ?? throw new FormatException($"Missing string member '{name}'.");

    private static string? OptionalString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static JsonElement? OptionalClone(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) ? value.Clone() : null;
}
