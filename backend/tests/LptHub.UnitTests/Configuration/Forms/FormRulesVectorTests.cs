using System.Text.Json;
using MatterFlow.Configuration.Domain.Forms.Rules;
using Shouldly;

namespace MatterFlow.UnitTests.Configuration.Forms;

/// <summary>Data-driven conformance test over the shared contracts/form-rules.vectors.json (linked, not copied).</summary>
public class FormRulesVectorTests
{
    private static readonly Lazy<JsonDocument> Document = new(() =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Configuration", "Forms", "form-rules.vectors.json"))));

    public static TheoryData<string> VectorNames()
    {
        var data = new TheoryData<string>();
        foreach (var vector in Document.Value.RootElement.GetProperty("vectors").EnumerateArray())
        {
            data.Add(vector.GetProperty("name").GetString()!);
        }

        return data;
    }

    [Fact]
    public void Vector_file_has_expected_contract_version_and_size()
    {
        Document.Value.RootElement.GetProperty("contractVersion").GetInt32().ShouldBe(1);
        Document.Value.RootElement.GetProperty("vectors").GetArrayLength().ShouldBe(171);
    }

    [Theory]
    [MemberData(nameof(VectorNames))]
    public void Vector_conforms(string name)
    {
        var vector = Document.Value.RootElement.GetProperty("vectors").EnumerateArray()
            .Single(v => v.GetProperty("name").GetString() == name);
        var expected = vector.GetProperty("expected");
        var fields = FormSchemaJson.ParseFields(vector.GetProperty("schema"));
        var compiled = FormSchema.Compile(fields);

        if (!expected.GetProperty("definitionValid").GetBoolean())
        {
            compiled.IsValid.ShouldBeFalse();
            var expectedCodes = expected.GetProperty("definitionErrors").EnumerateArray().Select(e => e.GetString()!).Order(StringComparer.Ordinal);
            compiled.Errors.Select(e => e.Code.ToWireName()).Distinct().Order(StringComparer.Ordinal).ShouldBe(expectedCodes);
            return;
        }

        compiled.Errors.ShouldBeEmpty();
        var mode = vector.TryGetProperty("mode", out var m) && m.GetString() == "draft" ? FormEvaluationMode.Draft : FormEvaluationMode.Submit;
        var result = FormEvaluator.Evaluate(compiled.Schema!, FormValues.FromElement(vector.GetProperty("values")), mode);

        result.Visible.ShouldBe(BoolMap(expected.GetProperty("visible")), ignoreOrder: true);
        result.Required.ShouldBe(BoolMap(expected.GetProperty("required")), ignoreOrder: true);

        var expectedOptions = expected.GetProperty("options").EnumerateObject()
            .ToDictionary(p => p.Name, p => p.Value.EnumerateArray().Select(e => e.GetString()!).ToList());
        result.Options.Keys.Order().ShouldBe(expectedOptions.Keys.Order());
        foreach (var (key, list) in expectedOptions)
        {
            result.Options[key].ShouldBe(list);
        }

        var expectedErrors = expected.GetProperty("errors").EnumerateArray()
            .Select(e => (e.GetProperty("fieldKey").GetString()!, e.GetProperty("code").GetString()!))
            .Order().ToList();
        var actualErrors = result.Errors.Select(e => (e.FieldKey, e.Code.ToWireName())).Order().ToList();
        actualErrors.ShouldBe(expectedErrors);

        JsonEquals(JsonDocument.Parse(result.Normalized.ToJson()).RootElement, expected.GetProperty("normalized")).ShouldBeTrue(
            $"normalized differs: {result.Normalized.ToJson()} vs {expected.GetProperty("normalized").GetRawText()}");
    }

    private static Dictionary<string, bool> BoolMap(JsonElement obj) =>
        obj.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetBoolean());

    private static bool JsonEquals(JsonElement a, JsonElement b)
    {
        if (a.ValueKind != b.ValueKind && !(a.ValueKind is JsonValueKind.True or JsonValueKind.False && b.ValueKind == a.ValueKind))
        {
            return false;
        }

        return a.ValueKind switch
        {
            JsonValueKind.Object => a.EnumerateObject().Count() == b.EnumerateObject().Count() &&
                a.EnumerateObject().All(p => b.TryGetProperty(p.Name, out var other) && JsonEquals(p.Value, other)),
            JsonValueKind.Array => a.GetArrayLength() == b.GetArrayLength() &&
                a.EnumerateArray().Zip(b.EnumerateArray()).All(t => JsonEquals(t.First, t.Second)),
            JsonValueKind.Number => a.GetDouble() == b.GetDouble(),
            JsonValueKind.String => a.GetString() == b.GetString(),
            _ => true,
        };
    }
}
