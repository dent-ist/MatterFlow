using System.Text.Json;
using System.Text.Json.Serialization;

namespace MatterFlow.Reports.Domain.Parameters;

/// <summary>The JSON form of the parameter definitions that a <c>ReportVersion</c> snapshots (<c>ParametersJson</c>), so an old version always runs with the parameters it was saved with.</summary>
public static class ParameterDefinitionJson
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static string Serialize(IReadOnlyList<ReportParameterDefinition> definitions) => JsonSerializer.Serialize(definitions, Options);

    public static IReadOnlyList<ReportParameterDefinition> Deserialize(string json) =>
        JsonSerializer.Deserialize<List<ReportParameterDefinition>>(json, Options) ?? [];
}
