using System.Text.Json;

namespace MatterFlow.Configuration.Domain.Forms.Rules;

/// <summary>
/// One typed row for the derived <c>CustomFieldIndex</c> table (architecture 7.6). Exactly one of the value
/// properties is set. A MULTISELECT field yields one entry per selected key.
/// </summary>
/// <param name="FieldKey">Stable field key.</param>
/// <param name="ValueText">TEXT, TEXTAREA, URL, SELECT, RADIO and MULTISELECT option key.</param>
/// <param name="ValueNumber">NUMBER, ASSET_REF and USER_REF.</param>
/// <param name="ValueDate">DATE.</param>
/// <param name="ValueDateTime">DATETIME (UTC).</param>
/// <param name="ValueBool">CHECKBOX (<c>false</c> is a real value and is indexed).</param>
public sealed record FormIndexEntry(
    string FieldKey,
    string? ValueText = null,
    decimal? ValueNumber = null,
    DateOnly? ValueDate = null,
    DateTime? ValueDateTime = null,
    bool? ValueBool = null);

/// <summary>Typed extraction of the filterable index values from normalized form values.</summary>
public static class FormIndexExtractor
{
    /// <summary>
    /// Extracts index entries for every <see cref="FormFieldDefinition.IsFilterable"/> input field that has a value in
    /// <paramref name="normalizedValues"/>, in display order (options in selected order). Values should come from
    /// <see cref="FormEvaluationResult.Normalized"/>; a value whose JSON type does not fit its control is skipped.
    /// With <paramref name="alwaysIndexNumberAndSelect"/> every NUMBER and SELECT input field is indexed whether or not it is filterable
    /// (the rule for asset forms, so size aggregates and group-by never fall back to scanning the stored JSON; epic #851, issue #867).
    /// </summary>
    public static IReadOnlyList<FormIndexEntry> Extract(FormSchema schema, FormValues normalizedValues, bool alwaysIndexNumberAndSelect = false)
    {
        ArgumentNullException.ThrowIfNull(schema);
        ArgumentNullException.ThrowIfNull(normalizedValues);

        var entries = new List<FormIndexEntry>();
        foreach (var field in schema.Fields)
        {
            var def = field.Definition;
            var indexed = def.IsFilterable || (alwaysIndexNumberAndSelect && def.Control is FormControl.Number or FormControl.Select);
            if (!indexed || !def.Control.IsInput() || !normalizedValues.TryGetValue(def.Key, out var value))
            {
                continue;
            }

            if (FormValueRules.IsEmpty(value) || !FormValueRules.IsValidType(def.Control, value))
            {
                continue;
            }

            switch (def.Control)
            {
                case FormControl.MultiSelect:
                    entries.AddRange(value.EnumerateArray().Select(e => new FormIndexEntry(def.Key, ValueText: e.GetString())));
                    break;
                case FormControl.Number or FormControl.AssetRef or FormControl.UserRef:
                    entries.Add(new FormIndexEntry(def.Key, ValueNumber: ToDecimal(value)));
                    break;
                case FormControl.Date:
                    FormValueRules.TryParseDate(value.GetString()!, out var date);
                    entries.Add(new FormIndexEntry(def.Key, ValueDate: date));
                    break;
                case FormControl.DateTime:
                    FormValueRules.TryParseDateTime(value.GetString()!, out var utc);
                    entries.Add(new FormIndexEntry(def.Key, ValueDateTime: utc));
                    break;
                case FormControl.Checkbox:
                    entries.Add(new FormIndexEntry(def.Key, ValueBool: value.GetBoolean()));
                    break;
                default:
                    entries.Add(new FormIndexEntry(def.Key, ValueText: value.GetString()));
                    break;
            }
        }

        return entries;
    }

    private static decimal? ToDecimal(JsonElement number)
    {
        if (number.TryGetDecimal(out var exact))
        {
            return exact;
        }

        // Outside decimal's precision/range: fall back to the nearest double, or no index value if out of range.
        var d = number.GetDouble();
        return Math.Abs(d) <= (double)decimal.MaxValue ? (decimal)d : null;
    }
}
