using System.Globalization;
using System.Text.Json;

namespace MatterFlow.Reports.Domain.Parameters;

/// <summary>
/// Turns an admin's default (a literal or a keyword) into the JSON value the form shows and the binder uses when a run does not supply one.
/// Relative dates are evaluated in the firm time zone (<see cref="BuiltInContext.Today"/>).
/// </summary>
public static class ParameterDefaults
{
    /// <summary>Resolves the default of <paramref name="definition"/>; null when it has none.</summary>
    public static JsonElement? Resolve(ReportParameterDefinition definition, BuiltInContext context)
    {
        if (definition.Default is not { } d || d.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;

        switch (definition.Type)
        {
            case ReportParameterType.Date:
                return d.ValueKind == JsonValueKind.String && TryRelativeDate(d.GetString()!, context.Today, out var date) ? Json(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)) : d;

            case ReportParameterType.DateRange:
                return ResolveRange(d, context);

            case ReportParameterType.Multi or ReportParameterType.Lookup when definition.IsList && d.ValueKind == JsonValueKind.String && d.GetString() == "myPods":
                return JsonSerializer.SerializeToElement(context.PodIds);

            case ReportParameterType.Lookup when d.ValueKind == JsonValueKind.String && d.GetString() == "myPod":
                return context.PrimaryPodId is { } pod ? JsonSerializer.SerializeToElement(pod) : null;

            case ReportParameterType.Lookup when d.ValueKind == JsonValueKind.String && d.GetString() == "me":
                return JsonSerializer.SerializeToElement(context.UserId);

            default:
                return d;
        }
    }

    /// <summary>today, startOfMonth, endOfMonth, startOfYear, endOfYear, startOfLastMonth, endOfLastMonth, today-N, today+N.</summary>
    public static bool TryRelativeDate(string keyword, DateOnly today, out DateOnly date)
    {
        date = default;
        var k = keyword.Trim();
        switch (k)
        {
            case "today":
                date = today;
                return true;
            case "startOfMonth":
                date = new DateOnly(today.Year, today.Month, 1);
                return true;
            case "endOfMonth":
                date = new DateOnly(today.Year, today.Month, 1).AddMonths(1).AddDays(-1);
                return true;
            case "startOfYear":
                date = new DateOnly(today.Year, 1, 1);
                return true;
            case "endOfYear":
                date = new DateOnly(today.Year, 12, 31);
                return true;
            case "startOfLastMonth":
                date = new DateOnly(today.Year, today.Month, 1).AddMonths(-1);
                return true;
            case "endOfLastMonth":
                date = new DateOnly(today.Year, today.Month, 1).AddDays(-1);
                return true;
        }

        if (k.StartsWith("today", StringComparison.Ordinal) && k.Length > 6 && k[5] is '-' or '+'
            && int.TryParse(k.AsSpan(6), NumberStyles.None, CultureInfo.InvariantCulture, out var days) && days <= 36500)
        {
            date = today.AddDays(k[5] == '-' ? -days : days);
            return true;
        }

        return false;
    }

    private static JsonElement? ResolveRange(JsonElement d, BuiltInContext context)
    {
        string? from = null;
        string? to = null;
        if (d.ValueKind == JsonValueKind.String)
        {
            var today = context.Today;
            (from, to) = d.GetString() switch
            {
                "thisMonth" => (Format(new DateOnly(today.Year, today.Month, 1)), Format(new DateOnly(today.Year, today.Month, 1).AddMonths(1).AddDays(-1))),
                "lastMonth" => (Format(new DateOnly(today.Year, today.Month, 1).AddMonths(-1)), Format(new DateOnly(today.Year, today.Month, 1).AddDays(-1))),
                "last30Days" => (Format(today.AddDays(-30)), Format(today)),
                "thisYear" => (Format(new DateOnly(today.Year, 1, 1)), Format(new DateOnly(today.Year, 12, 31))),
                _ => (null, null),
            };
            return from is null ? d : JsonSerializer.SerializeToElement(new { from, to });
        }

        if (d.ValueKind == JsonValueKind.Object)
        {
            from = Relative(d, "from", context.Today);
            to = Relative(d, "to", context.Today);
            return JsonSerializer.SerializeToElement(new { from, to });
        }

        return d;
    }

    private static string? Relative(JsonElement obj, string property, DateOnly today)
    {
        if (!obj.TryGetProperty(property, out var v) || v.ValueKind != JsonValueKind.String)
            return null;
        var s = v.GetString()!;
        return TryRelativeDate(s, today, out var date) ? Format(date) : s;
    }

    private static string Format(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static JsonElement Json(string value) => JsonSerializer.SerializeToElement(value);
}
