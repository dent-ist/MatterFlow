using System.Text.Json;

namespace MatterFlow.Configuration.Domain.Forms;

/// <summary>How a field differs between two form versions.</summary>
public enum FormFieldChangeKind
{
    /// <summary>Only in the newer version.</summary>
    Added,

    /// <summary>Only in the older version.</summary>
    Removed,

    /// <summary>In both, with differences.</summary>
    Changed,
}

/// <summary>One field's difference.</summary>
/// <param name="FieldKey">The field key.</param>
/// <param name="Kind">Added, removed or changed.</param>
/// <param name="Details">For a changed field, the names of the attributes that differ (for example <c>label</c>, <c>options</c>, <c>showWhen</c>, <c>order</c>).</param>
public sealed record FormFieldChange(string FieldKey, FormFieldChangeKind Kind, IReadOnlyList<string> Details);

/// <summary>Computes the summary of differences between two versions' fields (older to newer).</summary>
public static class FormDiff
{
    /// <summary>Compares the field lists.</summary>
    public static IReadOnlyList<FormFieldChange> Compare(IReadOnlyList<FormFieldSpec> older, IReadOnlyList<FormFieldSpec> newer)
    {
        var changes = new List<FormFieldChange>();
        var oldByKey = older.Select((f, i) => (f, i)).ToDictionary(x => x.f.Key, StringComparer.Ordinal);
        var newKeys = new HashSet<string>(newer.Select(f => f.Key), StringComparer.Ordinal);

        for (var i = 0; i < newer.Count; i++)
        {
            var f = newer[i];
            if (!oldByKey.TryGetValue(f.Key, out var previous))
            {
                changes.Add(new FormFieldChange(f.Key, FormFieldChangeKind.Added, []));
                continue;
            }

            var details = Differences(previous.f, f);
            if (previous.i != i)
            {
                details.Add("order");
            }

            if (details.Count > 0)
            {
                changes.Add(new FormFieldChange(f.Key, FormFieldChangeKind.Changed, details));
            }
        }

        changes.AddRange(older.Where(f => !newKeys.Contains(f.Key)).Select(f => new FormFieldChange(f.Key, FormFieldChangeKind.Removed, [])));
        return changes;
    }

    private static List<string> Differences(FormFieldSpec a, FormFieldSpec b)
    {
        var d = new List<string>();
        Add(d, "label", a.Label != b.Label);
        Add(d, "control", a.Control != b.Control);
        Add(d, "helpText", (a.HelpText ?? string.Empty) != (b.HelpText ?? string.Empty));
        Add(d, "section", a.Section != b.Section);
        Add(d, "required", a.Required != b.Required);
        Add(d, "default", Canonical(a.Default) != Canonical(b.Default));
        Add(d, "validation", Canonical(a.Validation) != Canonical(b.Validation));
        Add(d, "showWhen", Canonical(a.ShowWhen) != Canonical(b.ShowWhen));
        Add(d, "requiredWhen", Canonical(a.RequiredWhen) != Canonical(b.RequiredWhen));
        Add(d, "filterable", a.IsFilterable != b.IsFilterable);
        Add(d, "options", !OptionsEqual(a.Options, b.Options));
        return d;
    }

    private static void Add(List<string> details, string name, bool differs)
    {
        if (differs)
        {
            details.Add(name);
        }
    }

    private static bool OptionsEqual(IReadOnlyList<FormOptionSpec> a, IReadOnlyList<FormOptionSpec> b) =>
        a.Count == b.Count && a.Zip(b).All(p => p.First.Key == p.Second.Key && p.First.Label == p.Second.Label && Canonical(p.First.AvailableWhen) == Canonical(p.Second.AvailableWhen));

    /// <summary>Whitespace- and key-order-insensitive text of a JSON value; empty for absent or null.</summary>
    public static string Canonical(JsonElement? value)
    {
        if (value is not { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) } element)
        {
            return string.Empty;
        }

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            WriteCanonical(writer, element);
        }

        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var p in element.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(p.Name);
                    WriteCanonical(writer, p.Value);
                }

                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in element.EnumerateArray())
                {
                    WriteCanonical(writer, item);
                }

                writer.WriteEndArray();
                break;
            default:
                element.WriteTo(writer);
                break;
        }
    }
}
