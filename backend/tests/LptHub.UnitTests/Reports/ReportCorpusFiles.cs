using System.Text.Json;

namespace MatterFlow.UnitTests.Reports;

/// <summary>Reads the security corpora of the Reports suite (issue #725): JSON data files under <c>Reports/Corpus</c>, copied next to the test assembly.</summary>
internal static class ReportCorpusFiles
{
    internal sealed record ValidatorEntry(string Id, string Category, string Sql, bool Valid, string[] Codes, string Note);

    private static JsonElement Read(string file)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Reports", "Corpus", file);
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        return document.RootElement.Clone();
    }

    public static IReadOnlyList<ValidatorEntry> Validator { get; } = Read("validator-corpus.json").GetProperty("entries").EnumerateArray()
        .Select(e => new ValidatorEntry(
            e.GetProperty("id").GetString()!,
            e.GetProperty("category").GetString()!,
            e.GetProperty("sql").GetString()!,
            e.GetProperty("valid").GetBoolean(),
            e.GetProperty("codes").EnumerateArray().Select(c => c.GetString()!).ToArray(),
            e.GetProperty("note").GetString()!))
        .ToList();

    private static IReadOnlyList<string> Strings(string file, string property) => Read(file).GetProperty(property).EnumerateArray().Select(v => v.GetString()!).ToList();

    public static IReadOnlyList<string> InjectionText { get; } = Strings("injection-values.json", "text");

    public static IReadOnlyList<string> InjectionNumbers { get; } = Strings("injection-values.json", "numbers");

    public static IReadOnlyList<string> InjectionDates { get; } = Strings("injection-values.json", "dates");

    public static IReadOnlyList<string> InjectionIds { get; } = Strings("injection-values.json", "ids");

    public static IReadOnlyList<string> FormulaGuarded { get; } = Strings("csv-formula-corpus.json", "guarded");

    public static IReadOnlyList<string> FormulaSafe { get; } = Strings("csv-formula-corpus.json", "safe");
}
