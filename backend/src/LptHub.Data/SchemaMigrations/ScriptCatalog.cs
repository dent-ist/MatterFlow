namespace MatterFlow.Data.SchemaMigrations;

public static class ScriptCatalog
{
    /// <summary>Parses, validates (naming, duplicate prefixes) and sorts ascending by integer prefix.</summary>
    public static IReadOnlyList<MigrationScript> Load(IMigrationScriptSource source)
    {
        var scripts = source.ReadAll().Select(s => MigrationScript.Create(s.Name, s.Content)).ToList();

        var duplicates = scripts.GroupBy(s => s.Prefix).Where(g => g.Count() > 1).OrderBy(g => g.Key).ToList();
        if (duplicates.Count > 0)
        {
            var detail = string.Join("; ", duplicates.Select(g =>
                $"prefix {g.Key}: {string.Join(", ", g.Select(s => s.Name).Order(StringComparer.Ordinal))}"));
            throw new SchemaMigrationException($"Duplicate script prefixes found ({detail}). Renumber the unmerged script.");
        }

        return scripts.OrderBy(s => s.Prefix).ToList();
    }
}
