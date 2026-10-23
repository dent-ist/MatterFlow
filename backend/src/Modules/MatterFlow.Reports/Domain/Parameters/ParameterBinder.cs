using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace MatterFlow.Reports.Domain.Parameters;

/// <summary>
/// Coerces the values of a run from JSON to the declared CLR/SQL types on the server (spec 5.1, 5.3, 5.4). An invalid value is a
/// <see cref="ParameterError"/> with the parameter name and never reaches SQL; values are only ever bound as typed parameters, never
/// written into the SQL text. Built-in values are supplied here and cannot be overridden by the request.
/// </summary>
public static class ParameterBinder
{
    public const int MaxElements = ReportParameterDefinition.MaxSelectedCeiling;
    private const int LogTextLimit = 200;
    private const int LogListLimit = 20;

    /// <param name="definitions">The version's parameter definitions (choice lists already resolved into <see cref="ReportParameterDefinition.Options"/>).</param>
    /// <param name="supplied">The request's values by parameter name (case-insensitive).</param>
    /// <param name="usedPlaceholders">Placeholder names that occur in the SQL (upper case); only these are bound. Null binds every definition.</param>
    public static BindResult Bind(
        IReadOnlyList<ReportParameterDefinition> definitions,
        IReadOnlyDictionary<string, JsonElement> supplied,
        BuiltInContext context,
        IReadOnlySet<string>? usedPlaceholders)
    {
        var errors = new List<ParameterError>();
        var bound = new List<BoundParameter>();
        var byName = definitions.ToDictionary(d => d.Name, StringComparer.Ordinal);

        var values = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var (key, value) in supplied)
        {
            var name = key.Trim().ToUpperInvariant();
            if (BuiltInParameters.IsBuiltIn(name))
                errors.Add(new(name, ParameterErrorCodes.BuiltInNotAllowed, $"{name} is supplied by the server and cannot be set."));
            else if (!byName.ContainsKey(name))
                errors.Add(new(key.Length > 64 ? key[..64] : key, ParameterErrorCodes.UnknownParameter, "This report has no such parameter."));
            else
                values[name] = value;
        }

        foreach (var definition in definitions)
        {
            if (usedPlaceholders is not null && !definition.PlaceholderNames.Any(usedPlaceholders.Contains))
            {
                // Unused definitions are still validated when a value was supplied, but nothing is bound for them.
                if (values.TryGetValue(definition.Name, out var unusedValue))
                    _ = BindOne(definition, unusedValue, hasValue: true, context, errors);
                continue;
            }

            var hasValue = values.TryGetValue(definition.Name, out var raw);
            if (!hasValue || IsEmpty(raw))
            {
                var fallback = ParameterDefaults.Resolve(definition, context);
                if (fallback is { } d && !IsEmpty(d))
                {
                    raw = d;
                    hasValue = true;
                }
                else
                {
                    hasValue = false;
                }
            }

            foreach (var p in BindOne(definition, raw, hasValue, context, errors))
            {
                if (usedPlaceholders is null || usedPlaceholders.Contains(p.Name))
                    bound.Add(p);
            }
        }

        // Every placeholder in the SQL needs a definition or a built-in.
        if (usedPlaceholders is not null)
        {
            var covered = definitions.SelectMany(d => d.PlaceholderNames).ToHashSet(StringComparer.Ordinal);
            foreach (var name in usedPlaceholders.Order(StringComparer.Ordinal))
            {
                if (BuiltInParameters.IsBuiltIn(name))
                {
                    bound.Add(BuiltIn(name, context));
                }
                else if (!covered.Contains(name))
                {
                    errors.Add(new(name, ParameterErrorCodes.Undefined, $"The query uses :{name} but the report has no parameter definition for it."));
                }
            }
        }

        return new(bound, errors);
    }

    private static bool IsEmpty(JsonElement? e) =>
        e is null || e.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
        || (e.Value.ValueKind == JsonValueKind.String && e.Value.GetString()!.Length == 0);

    private static IEnumerable<BoundParameter> BindOne(ReportParameterDefinition d, JsonElement? raw, bool hasValue, BuiltInContext context, List<ParameterError> errors)
    {
        var before = errors.Count;
        var result = d.Type switch
        {
            ReportParameterType.Number => BindNumber(d, raw, hasValue, errors),
            ReportParameterType.Date => BindDate(d, d.Name, raw, hasValue, context, errors),
            ReportParameterType.Text => BindText(d, raw, hasValue, errors),
            ReportParameterType.Single => BindSingle(d, raw, hasValue, errors),
            ReportParameterType.Multi => BindList(d, raw, hasValue, errors),
            ReportParameterType.DateRange => BindRange(d, raw, hasValue, context, errors),
            ReportParameterType.YesNo => BindYesNo(d, raw, hasValue, errors),
            ReportParameterType.Lookup => d.LookupMulti ? BindList(d, raw, hasValue, errors) : BindLookup(d, raw, hasValue, errors),
            _ => [],
        };
        return errors.Count > before ? [] : result;
    }

    // ---- scalars ----

    private static BoundParameter Null(string name, SqlDbType type, int size = 0) => new(name, type, size, 0, 0, null, ListKind.None, name + "=null");

    private static bool Missing(ReportParameterDefinition d, bool hasValue, List<ParameterError> errors)
    {
        if (hasValue)
            return false;
        if (d.IsRequired)
            errors.Add(new(d.Name, ParameterErrorCodes.Required, $"{(string.IsNullOrWhiteSpace(d.Label) ? d.Name : d.Label)} is required."));
        return true;
    }

    private static BoundParameter[] BindNumber(ReportParameterDefinition d, JsonElement? raw, bool hasValue, List<ParameterError> errors)
    {
        if (Missing(d, hasValue, errors))
            return [Null(d.Name, d.IntegerOnly ? SqlDbType.BigInt : SqlDbType.Decimal)];

        if (!TryDecimal(raw!.Value, out var value))
        {
            errors.Add(new(d.Name, ParameterErrorCodes.InvalidType, "Enter a number."));
            return [];
        }

        if (d.IntegerOnly && (value != decimal.Truncate(value) || value < long.MinValue || value > long.MaxValue))
        {
            errors.Add(new(d.Name, ParameterErrorCodes.InvalidType, "Enter a whole number."));
            return [];
        }

        if (!d.IntegerOnly && (Math.Abs(value) >= 1e28m || decimal.Round(value, 10) != value))
        {
            errors.Add(new(d.Name, ParameterErrorCodes.OutOfRange, "The number is too large or has more than 10 decimals."));
            return [];
        }

        if (d.Min is { } min && value < min)
        {
            errors.Add(new(d.Name, ParameterErrorCodes.OutOfRange, $"The value must be at least {min.ToString(CultureInfo.InvariantCulture)}."));
            return [];
        }

        if (d.Max is { } max && value > max)
        {
            errors.Add(new(d.Name, ParameterErrorCodes.OutOfRange, $"The value must be at most {max.ToString(CultureInfo.InvariantCulture)}."));
            return [];
        }

        var text = value.ToString(CultureInfo.InvariantCulture);
        return d.IntegerOnly
            ? [new(d.Name, SqlDbType.BigInt, 0, 0, 0, (long)value, ListKind.None, $"{d.Name}={text}")]
            : [new(d.Name, SqlDbType.Decimal, 0, 38, 10, value, ListKind.None, $"{d.Name}={text}")];
    }

    private static bool TryDecimal(JsonElement e, out decimal value)
    {
        value = 0;
        switch (e.ValueKind)
        {
            case JsonValueKind.Number:
                return e.TryGetDecimal(out value);
            case JsonValueKind.String:
                return decimal.TryParse(e.GetString(), NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value);
            default:
                return false;
        }
    }

    private static BoundParameter[] BindDate(ReportParameterDefinition d, string placeholder, JsonElement? raw, bool hasValue, BuiltInContext context, List<ParameterError> errors)
    {
        if (Missing(d, hasValue, errors))
            return [Null(placeholder, SqlDbType.Date)];

        if (!TryDate(raw!.Value, context.Today, out var date))
        {
            errors.Add(new(d.Name, ParameterErrorCodes.InvalidDate, "Enter a date as yyyy-MM-dd."));
            return [];
        }

        return [DateParameter(placeholder, date)];
    }

    private static BoundParameter DateParameter(string name, DateOnly date) =>
        new(name, SqlDbType.Date, 0, 0, 0, date.ToDateTime(TimeOnly.MinValue), ListKind.None, $"{name}={date:yyyy-MM-dd}");

    private static bool TryDate(JsonElement e, DateOnly today, out DateOnly date)
    {
        date = default;
        if (e.ValueKind != JsonValueKind.String)
            return false;
        var s = e.GetString()!;
        return DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date) || ParameterDefaults.TryRelativeDate(s, today, out date);
    }

    private static BoundParameter[] BindText(ReportParameterDefinition d, JsonElement? raw, bool hasValue, List<ParameterError> errors)
    {
        if (Missing(d, hasValue, errors))
            return [Null(d.Name, SqlDbType.NVarChar, ReportParameterDefinition.DefaultMaxTextLength)];

        if (raw!.Value.ValueKind != JsonValueKind.String)
        {
            errors.Add(new(d.Name, ParameterErrorCodes.InvalidType, "Enter text."));
            return [];
        }

        var text = raw.Value.GetString()!;
        var max = Math.Clamp(d.MaxLength ?? ReportParameterDefinition.DefaultMaxTextLength, 1, ReportParameterDefinition.DefaultMaxTextLength);
        if (text.Length > max)
        {
            errors.Add(new(d.Name, ParameterErrorCodes.TooLong, $"Use at most {max} characters."));
            return [];
        }

        if (text.Contains('\0'))
        {
            errors.Add(new(d.Name, ParameterErrorCodes.InvalidType, "The text contains a character that is not allowed."));
            return [];
        }

        return [new(d.Name, SqlDbType.NVarChar, ReportParameterDefinition.DefaultMaxTextLength, 0, 0, text, ListKind.None, $"{d.Name}={Truncate(text)}")];
    }

    private static BoundParameter[] BindSingle(ReportParameterDefinition d, JsonElement? raw, bool hasValue, List<ParameterError> errors)
    {
        var intType = d.ValueType == ChoiceValueType.Int;
        if (Missing(d, hasValue, errors))
            return [intType ? Null(d.Name, SqlDbType.Int) : Null(d.Name, SqlDbType.NVarChar, ReportParameterDefinition.MaxChoiceTextLength)];

        if (!TryChoice(d, raw!.Value, out var option, out var message))
        {
            errors.Add(new(d.Name, ParameterErrorCodes.NotInOptions, message));
            return [];
        }

        return intType
            ? [new(d.Name, SqlDbType.Int, 0, 0, 0, int.Parse(option, CultureInfo.InvariantCulture), ListKind.None, $"{d.Name}={option}")]
            : [new(d.Name, SqlDbType.NVarChar, ReportParameterDefinition.MaxChoiceTextLength, 0, 0, option, ListKind.None, $"{d.Name}={Truncate(option)}")];
    }

    /// <summary>The value must be one of the current options; the option's own text is what gets bound.</summary>
    private static bool TryChoice(ReportParameterDefinition d, JsonElement e, out string canonical, out string message)
    {
        canonical = "";
        message = "Choose one of the listed values.";
        string? candidate = e.ValueKind switch
        {
            JsonValueKind.String => e.GetString(),
            JsonValueKind.Number when d.ValueType == ChoiceValueType.Int && e.TryGetInt64(out var n) => n.ToString(CultureInfo.InvariantCulture),
            _ => null,
        };
        if (candidate is null)
            return false;

        if (d.ValueType == ChoiceValueType.Int)
        {
            if (!long.TryParse(candidate, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var wanted) || wanted is < int.MinValue or > int.MaxValue)
                return false;
            foreach (var o in d.Options)
            {
                if (long.TryParse(o.Value, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var have) && have == wanted)
                {
                    canonical = o.Value;
                    return true;
                }
            }

            return false;
        }

        if (candidate.Length > ReportParameterDefinition.MaxChoiceTextLength)
        {
            message = "The value is too long.";
            return false;
        }

        foreach (var o in d.Options)
        {
            if (string.Equals(o.Value, candidate, StringComparison.Ordinal))
            {
                canonical = o.Value;
                return true;
            }
        }

        return false;
    }

    private static BoundParameter[] BindYesNo(ReportParameterDefinition d, JsonElement? raw, bool hasValue, List<ParameterError> errors)
    {
        if (Missing(d, hasValue, errors))
            return [Null(d.Name, SqlDbType.Bit)];

        bool? value = raw!.Value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when raw.Value.GetString() is "true" or "false" => raw.Value.GetString() == "true",
            _ => null,
        };
        if (value is null)
        {
            errors.Add(new(d.Name, ParameterErrorCodes.InvalidType, "Choose yes or no."));
            return [];
        }

        return [new(d.Name, SqlDbType.Bit, 0, 0, 0, value.Value, ListKind.None, $"{d.Name}={(value.Value ? "yes" : "no")}")];
    }

    private static BoundParameter[] BindLookup(ReportParameterDefinition d, JsonElement? raw, bool hasValue, List<ParameterError> errors)
    {
        if (Missing(d, hasValue, errors))
            return [Null(d.Name, SqlDbType.Int)];

        if (!TryId(raw!.Value, out var id))
        {
            errors.Add(new(d.Name, ParameterErrorCodes.InvalidType, "Choose an item from the list."));
            return [];
        }

        return [new(d.Name, SqlDbType.Int, 0, 0, 0, id, ListKind.None, $"{d.Name}={id}")];
    }

    private static bool TryId(JsonElement e, out int id)
    {
        id = 0;
        switch (e.ValueKind)
        {
            case JsonValueKind.Number:
                return e.TryGetInt32(out id) && id > 0;
            case JsonValueKind.String:
                return int.TryParse(e.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out id) && id > 0;
            default:
                return false;
        }
    }

    // ---- date range ----

    private static BoundParameter[] BindRange(ReportParameterDefinition d, JsonElement? raw, bool hasValue, BuiltInContext context, List<ParameterError> errors)
    {
        var fromName = d.Name + "_FROM";
        var toName = d.Name + "_TO";
        if (!hasValue)
        {
            if (d.IsRequired)
                errors.Add(new(d.Name, ParameterErrorCodes.Required, $"{(string.IsNullOrWhiteSpace(d.Label) ? d.Name : d.Label)} is required."));
            return [Null(fromName, SqlDbType.Date), Null(toName, SqlDbType.Date)];
        }

        if (raw!.Value.ValueKind != JsonValueKind.Object)
        {
            errors.Add(new(d.Name, ParameterErrorCodes.InvalidType, "Enter a date range with a from and a to date."));
            return [];
        }

        DateOnly? from = null;
        DateOnly? to = null;
        foreach (var (property, assign) in new (string, Action<DateOnly?>)[] { ("from", v => from = v), ("to", v => to = v) })
        {
            if (!raw.Value.TryGetProperty(property, out var v) || IsEmpty(v))
                continue;
            if (!TryDate(v, context.Today, out var date))
            {
                errors.Add(new(d.Name, ParameterErrorCodes.InvalidDate, $"The {property} date must be written as yyyy-MM-dd."));
                return [];
            }

            assign(date);
        }

        if (d.IsRequired && (from is null || to is null))
        {
            errors.Add(new(d.Name, ParameterErrorCodes.Required, "Both dates of the range are required."));
            return [];
        }

        if (from is { } f && to is { } t && t < f)
        {
            errors.Add(new(d.Name, ParameterErrorCodes.RangeOrder, "The 'to' date must not be before the 'from' date."));
            return [];
        }

        return
        [
            from is { } a ? DateParameter(fromName, a) : Null(fromName, SqlDbType.Date),
            to is { } b ? DateParameter(toName, b) : Null(toName, SqlDbType.Date),
        ];
    }

    // ---- lists (multi choice, multi lookup): one JSON array parameter ----

    private static BoundParameter[] BindList(ReportParameterDefinition d, JsonElement? raw, bool hasValue, List<ParameterError> errors)
    {
        var kind = d.ElementType == ChoiceValueType.Int ? ListKind.Int : ListKind.Text;
        if (!hasValue)
        {
            if (d.IsRequired)
                errors.Add(new(d.Name, ParameterErrorCodes.Required, $"{(string.IsNullOrWhiteSpace(d.Label) ? d.Name : d.Label)} is required."));
            return [ListParameter(d.Name, [], kind)];
        }

        if (raw!.Value.ValueKind != JsonValueKind.Array)
        {
            errors.Add(new(d.Name, ParameterErrorCodes.InvalidType, "Choose one or more values."));
            return [];
        }

        var limit = Math.Clamp(d.MaxSelected ?? ReportParameterDefinition.DefaultMaxSelected, 1, ReportParameterDefinition.MaxSelectedCeiling);
        var length = raw.Value.GetArrayLength();
        if (length > limit)
        {
            errors.Add(new(d.Name, ParameterErrorCodes.TooMany, $"Choose at most {limit} values."));
            return [];
        }

        if (length == 0 && d.IsRequired)
        {
            errors.Add(new(d.Name, ParameterErrorCodes.Required, "Choose at least one value."));
            return [];
        }

        var items = new List<string>(length);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var element in raw.Value.EnumerateArray())
        {
            string value;
            if (d.Type == ReportParameterType.Lookup)
            {
                if (!TryId(element, out var id))
                {
                    errors.Add(new(d.Name, ParameterErrorCodes.InvalidType, "Choose items from the list."));
                    return [];
                }

                value = id.ToString(CultureInfo.InvariantCulture);
            }
            else if (!TryChoice(d, element, out value, out var message))
            {
                errors.Add(new(d.Name, ParameterErrorCodes.NotInOptions, message));
                return [];
            }

            if (seen.Add(value))
                items.Add(value);
        }

        return [ListParameter(d.Name, items, kind)];
    }

    /// <summary>The JSON array the engine binds as one <c>nvarchar(max)</c>: numbers for ids, strings for text. Built by the serializer, never by concatenation of user text.</summary>
    internal static BoundParameter ListParameter(string name, IReadOnlyList<string> items, ListKind kind)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartArray();
            foreach (var item in items)
            {
                if (kind == ListKind.Int)
                    writer.WriteNumberValue(long.Parse(item, CultureInfo.InvariantCulture));
                else
                    writer.WriteStringValue(item);
            }

            writer.WriteEndArray();
        }

        var json = Encoding.UTF8.GetString(stream.ToArray());
        var shown = items.Count <= LogListLimit ? string.Join(",", items.Select(Truncate)) : string.Join(",", items.Take(LogListLimit).Select(Truncate)) + $",...({items.Count})";
        return new(name, SqlDbType.NVarChar, -1, 0, 0, json, kind, $"{name}=[{shown}]");
    }

    // ---- built-ins ----

    private static BoundParameter BuiltIn(string name, BuiltInContext c) => name switch
    {
        BuiltInParameters.CurrentUserId => new(name, SqlDbType.Int, 0, 0, 0, c.UserId, ListKind.None, $"{name}={c.UserId}"),
        BuiltInParameters.CurrentUserName => new(name, SqlDbType.NVarChar, 200, 0, 0, c.UserName.Length > 200 ? c.UserName[..200] : c.UserName, ListKind.None, $"{name}=(user)"),
        BuiltInParameters.Today => DateParameter(name, c.Today),
        BuiltInParameters.NowUtc => new(name, SqlDbType.DateTime2, 0, 0, 3, DateTime.SpecifyKind(c.NowUtc, DateTimeKind.Unspecified), ListKind.None, $"{name}=(now)"),
        BuiltInParameters.CurrentPodIds => ListParameter(name, c.PodIds.Select(i => i.ToString(CultureInfo.InvariantCulture)).ToList(), ListKind.Int),
        BuiltInParameters.CurrentPrimaryPodId => c.PrimaryPodId is { } pod
            ? new(name, SqlDbType.Int, 0, 0, 0, pod, ListKind.None, $"{name}={pod}")
            : Null(name, SqlDbType.Int),
        BuiltInParameters.FirmTimeZoneOffsetMinutes => new(name, SqlDbType.Int, 0, 0, 0, c.FirmTimeZoneOffsetMinutes, ListKind.None, $"{name}={c.FirmTimeZoneOffsetMinutes}"),
        _ => throw new ArgumentOutOfRangeException(nameof(name), name, "Not a provided built-in value."),
    };

    private static string Truncate(string s) => s.Length <= LogTextLimit ? s : s[..LogTextLimit] + "...";
}
