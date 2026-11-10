using System.Reflection;

namespace MatterFlow.Data.SchemaMigrations;

public interface IMigrationScriptSource
{
    /// <summary>Returns every script (name and raw text). Order is irrelevant; the catalog sorts and validates.</summary>
    IReadOnlyList<(string Name, string Content)> ReadAll();
}

/// <summary>Scripts embedded from /db/scripts with logical names <c>db.scripts.{file}</c>.</summary>
public sealed class EmbeddedMigrationScriptSource(Assembly? assembly = null) : IMigrationScriptSource
{
    private const string Prefix = "db.scripts.";
    private readonly Assembly _assembly = assembly ?? typeof(EmbeddedMigrationScriptSource).Assembly;

    public IReadOnlyList<(string Name, string Content)> ReadAll()
    {
        var result = new List<(string, string)>();
        foreach (var resource in _assembly.GetManifestResourceNames())
        {
            if (!resource.StartsWith(Prefix, StringComparison.Ordinal) || !resource.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            using var stream = _assembly.GetManifestResourceStream(resource)!;
            using var reader = new StreamReader(stream);
            result.Add((resource[Prefix.Length..], reader.ReadToEnd()));
        }

        return result;
    }
}

/// <summary>Scripts read from a directory (ops hotfix testing, tests).</summary>
public sealed class FolderMigrationScriptSource(string folder) : IMigrationScriptSource
{
    public IReadOnlyList<(string Name, string Content)> ReadAll()
    {
        if (!Directory.Exists(folder))
        {
            throw new SchemaMigrationException($"Migrations:ScriptsFolder '{folder}' does not exist.");
        }

        return Directory.EnumerateFiles(folder, "*.sql")
            .Select(f => (Path.GetFileName(f), File.ReadAllText(f)))
            .ToList();
    }
}

/// <summary>Fixed in-memory list, mainly for tests.</summary>
public sealed class InMemoryMigrationScriptSource(IEnumerable<(string Name, string Content)> scripts) : IMigrationScriptSource
{
    private readonly List<(string Name, string Content)> _scripts = [.. scripts];

    public IReadOnlyList<(string Name, string Content)> ReadAll() => _scripts;
}
