using System.Globalization;
using System.Text.Json;

namespace MatterFlow.Audit.Domain;

/// <summary>One changed field: a property name or a JSON sub-key (<c>form:ocr_language</c>) with formatted old/new values.</summary>
public sealed record FieldChange(string FieldKey, string? OldValue, string? NewValue);

/// <summary>Pure diffing used by the SaveChanges interceptor: turns a property's old/new values into zero or more field changes.</summary>
public static class AuditDiff
{
    public const int MaxFieldKeyLength = 100;

    /// <summary>
    /// Diffs one property. With <paramref name="jsonPrefix"/> set and both sides being JSON objects (or null/empty), the diff is
    /// per top-level key; otherwise (or on unparsable JSON) it is a single change of the whole property.
    /// </summary>
    public static IReadOnlyList<FieldChange> Diff(string property, object? oldValue, object? newValue, string? jsonPrefix = null)
    {
        var oldText = Format(oldValue);
        var newText = Format(newValue);

        if (jsonPrefix is not null && TryParseObject(oldText, out var oldObj) && TryParseObject(newText, out var newObj))
            return DiffObjects(jsonPrefix, oldObj, newObj);

        return string.Equals(oldText, newText, StringComparison.Ordinal)
            ? []
            : [new FieldChange(Clip(property), oldText, newText)];
    }

    /// <summary>Culture-invariant text for a property value; null stays null.</summary>
    public static string? Format(object? value) => value switch
    {
        null => null,
        string s => s,
        bool b => b ? "true" : "false",
        DateTime dt => dt.ToString("O", CultureInfo.InvariantCulture),
        DateTimeOffset dto => dto.ToString("O", CultureInfo.InvariantCulture),
        byte[] bytes => Convert.ToBase64String(bytes),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString(),
    };

    private static List<FieldChange> DiffObjects(string prefix, Dictionary<string, JsonElement> oldObj, Dictionary<string, JsonElement> newObj)
    {
        var changes = new List<FieldChange>();
        foreach (var key in oldObj.Keys.Concat(newObj.Keys.Where(k => !oldObj.ContainsKey(k))))
        {
            var hasOld = oldObj.TryGetValue(key, out var o);
            var hasNew = newObj.TryGetValue(key, out var n);
            if (hasOld && hasNew && o.GetRawText() == n.GetRawText())
                continue;

            changes.Add(new FieldChange(Clip($"{prefix}:{key}"), hasOld ? Display(o) : null, hasNew ? Display(n) : null));
        }

        return changes;
    }

    private static string? Display(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Null => null,
        _ => e.GetRawText(),
    };

    private static bool TryParseObject(string? json, out Dictionary<string, JsonElement> result)
    {
        result = [];
        if (string.IsNullOrWhiteSpace(json))
            return true; // null/empty is an empty object

        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return false;

            foreach (var p in doc.RootElement.EnumerateObject())
                result[p.Name] = p.Value.Clone();
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string Clip(string key) => key.Length <= MaxFieldKeyLength ? key : key[..MaxFieldKeyLength];
}
