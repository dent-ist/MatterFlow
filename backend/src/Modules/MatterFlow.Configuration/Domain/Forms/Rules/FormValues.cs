using System.Collections;
using System.Text;
using System.Text.Json;

namespace MatterFlow.Configuration.Domain.Forms.Rules;

/// <summary>
/// In-memory value model for the JSON value columns (<c>FormValuesJson</c>, <c>ValuesJson</c>, <c>CustomFieldsJson</c>):
/// an immutable bag of JSON values keyed by the stable field key, preserving insertion order. Values are
/// <see cref="JsonElement"/>s so the exact submitted JSON (for example array order, <c>1.0</c>) is retained.
/// </summary>
public sealed class FormValues : IReadOnlyDictionary<string, JsonElement>
{
    private readonly OrderedDictionary<string, JsonElement> _items;

    private FormValues(OrderedDictionary<string, JsonElement> items)
    {
        _items = items;
    }

    /// <summary>No values.</summary>
    public static FormValues Empty { get; } = new(new OrderedDictionary<string, JsonElement>(StringComparer.Ordinal));

    /// <inheritdoc />
    public int Count => _items.Count;

    /// <inheritdoc />
    public IEnumerable<string> Keys => _items.Keys;

    /// <inheritdoc />
    public IEnumerable<JsonElement> Values => _items.Values;

    /// <inheritdoc />
    public JsonElement this[string key] => _items[key];

    /// <summary>Parses a JSON object such as <c>{"requires_ocr":true,"outputs":["pdf"]}</c>. Empty or whitespace input is no values.</summary>
    /// <exception cref="FormatException">The text is not a JSON object.</exception>
    public static FormValues FromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return Empty;
        }

        try
        {
            using var doc = JsonDocument.Parse(json);
            return FromElement(doc.RootElement);
        }
        catch (JsonException ex)
        {
            throw new FormatException("Form values must be a JSON object.", ex);
        }
    }

    /// <summary>Builds values from a JSON object element (the values are cloned, so the source document may be disposed).</summary>
    /// <exception cref="FormatException">The element is not a JSON object.</exception>
    public static FormValues FromElement(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new FormatException("Form values must be a JSON object.");
        }

        var items = new OrderedDictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            items[property.Name] = property.Value.Clone();
        }

        return new FormValues(items);
    }

    /// <summary>Builds values from key/value pairs; later duplicates win.</summary>
    public static FormValues From(IEnumerable<KeyValuePair<string, JsonElement>> pairs)
    {
        var items = new OrderedDictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var (key, value) in pairs)
        {
            items[key] = value.Clone();
        }

        return new FormValues(items);
    }

    /// <summary>Returns a copy with <paramref name="key"/> set to <paramref name="value"/>.</summary>
    public FormValues With(string key, JsonElement value)
    {
        var copy = new OrderedDictionary<string, JsonElement>(_items, StringComparer.Ordinal)
        {
            [key] = value.Clone(),
        };
        return new FormValues(copy);
    }

    /// <summary>Returns a copy without <paramref name="key"/>.</summary>
    public FormValues Without(string key)
    {
        var copy = new OrderedDictionary<string, JsonElement>(_items, StringComparer.Ordinal);
        copy.Remove(key);
        return new FormValues(copy);
    }

    /// <summary>Serializes to the compact JSON object stored in the value column.</summary>
    public string ToJson()
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (var (key, value) in _items)
            {
                writer.WritePropertyName(key);
                value.WriteTo(writer);
            }

            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    /// <inheritdoc />
    public override string ToString() => ToJson();

    /// <inheritdoc />
    public bool ContainsKey(string key) => _items.ContainsKey(key);

    /// <inheritdoc />
    public bool TryGetValue(string key, out JsonElement value) => _items.TryGetValue(key, out value);

    /// <inheritdoc />
    public IEnumerator<KeyValuePair<string, JsonElement>> GetEnumerator() => _items.GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}
