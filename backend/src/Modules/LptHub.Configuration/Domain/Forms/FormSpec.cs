using System.Text.Json;
using MatterFlow.Configuration.Domain.Forms.Rules;

namespace MatterFlow.Configuration.Domain.Forms;

/// <summary>An option as authored in the designer.</summary>
/// <param name="Key">Stable option key.</param>
/// <param name="Label">Display text.</param>
/// <param name="AvailableWhen">Rule JSON; null means always available.</param>
public sealed record FormOptionSpec(string Key, string Label, JsonElement? AvailableWhen = null);

/// <summary>A field as authored in the designer (everything the persisted <see cref="FormField"/> holds, with JSON members parsed). List order is display order.</summary>
public sealed record FormFieldSpec
{
    /// <summary>Stable field key.</summary>
    public required string Key { get; init; }

    /// <summary>Display label.</summary>
    public string Label { get; init; } = string.Empty;

    /// <summary>Control wire name, for example <c>MULTISELECT</c>.</summary>
    public required string Control { get; init; }

    /// <summary>Help text.</summary>
    public string? HelpText { get; init; }

    /// <summary>Key of the SECTION_HEADING this field sits under.</summary>
    public string? Section { get; init; }

    /// <summary>Static required flag.</summary>
    public bool Required { get; init; }

    /// <summary>Default value (a JSON value matching the control); null means none.</summary>
    public JsonElement? Default { get; init; }

    /// <summary>Validation object (<c>min</c>, <c>max</c>, <c>maxLength</c>, <c>pattern</c>, <c>patternMessage</c>).</summary>
    public JsonElement? Validation { get; init; }

    /// <summary>Show rule.</summary>
    public JsonElement? ShowWhen { get; init; }

    /// <summary>Conditional-required rule.</summary>
    public JsonElement? RequiredWhen { get; init; }

    /// <summary>Whether the value is mirrored to the typed filter index.</summary>
    public bool IsFilterable { get; init; }

    /// <summary>Options in display order.</summary>
    public IReadOnlyList<FormOptionSpec> Options { get; init; } = [];
}

/// <summary>Conversions between authored specs, persisted entities and the rule engine's definitions.</summary>
public static class FormSpecs
{
    /// <summary>Builds the rule engine's field definitions from specs by way of the contract's fragment shape (so parsing is identical to the vectors').</summary>
    public static IReadOnlyList<FormFieldDefinition> ToDefinitions(IReadOnlyList<FormFieldSpec> specs)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteStartArray("fields");
            foreach (var f in specs)
            {
                writer.WriteStartObject();
                writer.WriteString("key", f.Key);
                writer.WriteString("control", f.Control);
                writer.WriteBoolean("required", f.Required);
                writer.WriteBoolean("isFilterable", f.IsFilterable);
                if (f.Section is not null)
                {
                    writer.WriteString("section", f.Section);
                }

                WriteOptional(writer, "validation", f.Validation);
                WriteOptional(writer, "showWhen", f.ShowWhen);
                WriteOptional(writer, "requiredWhen", f.RequiredWhen);
                writer.WriteStartArray("options");
                foreach (var o in f.Options)
                {
                    writer.WriteStartObject();
                    writer.WriteString("key", o.Key);
                    WriteOptional(writer, "availableWhen", o.AvailableWhen);
                    writer.WriteEndObject();
                }

                writer.WriteEndArray();
                writer.WriteEndObject();
            }

            writer.WriteEndArray();
            writer.WriteEndObject();
        }

        return FormSchemaJson.ParseFields(System.Text.Encoding.UTF8.GetString(stream.ToArray()));
    }

    /// <summary>Reads persisted fields (with their options loaded) as specs, in display order.</summary>
    public static IReadOnlyList<FormFieldSpec> FromEntities(IEnumerable<FormField> fields) =>
        [.. fields.OrderBy(f => f.SortOrder).Select(f => new FormFieldSpec
        {
            Key = f.FieldKey,
            Label = f.Label,
            Control = f.ControlType.ToWireName(),
            HelpText = f.HelpText,
            Section = f.SectionKey,
            Required = f.IsRequired,
            Default = Parse(f.DefaultValueJson),
            Validation = Parse(f.ValidationJson),
            ShowWhen = Parse(f.ShowWhenJson),
            RequiredWhen = Parse(f.RequiredWhenJson),
            IsFilterable = f.IsFilterable,
            Options = [.. f.Options.OrderBy(o => o.SortOrder).Select(o => new FormOptionSpec(o.OptionKey, o.Label, Parse(o.AvailableWhenJson)))],
        })];

    /// <summary>Creates fresh (unsaved) field entities for <paramref name="version"/> from specs; sort order is the list position.</summary>
    public static List<FormField> ToEntities(IReadOnlyList<FormFieldSpec> specs) =>
        [.. specs.Select((s, i) => new FormField
        {
            FieldKey = s.Key,
            Label = s.Label,
            ControlType = FormControlExtensions.TryParseWireName(s.Control, out var control) ? control : FormControl.Unknown,
            HelpText = string.IsNullOrWhiteSpace(s.HelpText) ? null : s.HelpText,
            SortOrder = i + 1,
            SectionKey = s.Section,
            IsRequired = s.Required,
            DefaultValueJson = Raw(s.Default),
            ValidationJson = Raw(s.Validation),
            ShowWhenJson = Raw(s.ShowWhen),
            RequiredWhenJson = Raw(s.RequiredWhen),
            IsFilterable = s.IsFilterable,
            Options = [.. s.Options.Select((o, j) => new FormFieldOption
            {
                OptionKey = o.Key,
                Label = o.Label,
                SortOrder = j + 1,
                AvailableWhenJson = Raw(o.AvailableWhen),
            })],
        })];

    private static void WriteOptional(Utf8JsonWriter writer, string name, JsonElement? value)
    {
        if (value is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) } element)
        {
            writer.WritePropertyName(name);
            element.WriteTo(writer);
        }
    }

    private static string? Raw(JsonElement? value) =>
        value is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) } element ? element.GetRawText() : null;

    private static JsonElement? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
