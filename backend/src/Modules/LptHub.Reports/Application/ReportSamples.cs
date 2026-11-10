using System.Text.Json;
using MatterFlow.Reports.Domain.Parameters;

namespace MatterFlow.Reports.Application;

/// <summary>Sample values for a preview (spec 6.6): what an administrator did not type and the definition has no default for, by type.</summary>
public static class ReportSamples
{
    /// <summary>Adds a sample for every <b>required</b> parameter that has neither a supplied value nor a default. Optional parameters stay empty (NULL), so the unfiltered query is what the preview shows.</summary>
    public static Dictionary<string, JsonElement> Complete(IReadOnlyList<ReportParameterDefinition> definitions, IReadOnlyDictionary<string, JsonElement> supplied, BuiltInContext context)
    {
        var values = new Dictionary<string, JsonElement>(supplied, StringComparer.OrdinalIgnoreCase);
        foreach (var d in definitions.Where(d => d.IsRequired))
        {
            if (values.TryGetValue(d.Name, out var v) && v.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined) && !(v.ValueKind == JsonValueKind.String && v.GetString()!.Length == 0))
                continue;
            if (ParameterDefaults.Resolve(d, context) is not null)
                continue;
            values[d.Name] = Sample(d, context);
        }

        return values;
    }

    public static JsonElement Sample(ReportParameterDefinition d, BuiltInContext context)
    {
        switch (d.Type)
        {
            case ReportParameterType.Number:
                var n = d.Min is { } min && min > 0 ? min : d.Max is { } max && max < 0 ? max : 0m;
                return JsonSerializer.SerializeToElement(n);
            case ReportParameterType.Date:
                return JsonSerializer.SerializeToElement(context.Today.ToString("yyyy-MM-dd"));
            case ReportParameterType.DateRange:
                return JsonSerializer.SerializeToElement(new { from = new DateOnly(context.Today.Year, context.Today.Month, 1).ToString("yyyy-MM-dd"), to = context.Today.ToString("yyyy-MM-dd") });
            case ReportParameterType.Text:
                var text = "sample";
                return JsonSerializer.SerializeToElement(d.MaxLength is { } len and > 0 && len < text.Length ? text[..len] : text);
            case ReportParameterType.YesNo:
                return JsonSerializer.SerializeToElement(false);
            case ReportParameterType.Single:
                return d.Options.Count > 0 ? JsonSerializer.SerializeToElement(d.Options[0].Value) : JsonSerializer.SerializeToElement("");
            case ReportParameterType.Multi:
                return d.Options.Count > 0 ? JsonSerializer.SerializeToElement(new[] { d.Options[0].Value }) : JsonSerializer.SerializeToElement(Array.Empty<string>());
            case ReportParameterType.Lookup:
                return d.LookupMulti ? JsonSerializer.SerializeToElement(new[] { 1 }) : JsonSerializer.SerializeToElement(1);
            default:
                return JsonSerializer.SerializeToElement("");
        }
    }
}
