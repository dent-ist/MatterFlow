namespace MatterFlow.Data.SchemaMigrations;

/// <summary>Settings bound from the <c>Migrations</c> configuration section (architecture 4.3, item 8).</summary>
public sealed class MigrationsOptions
{
    public const string SectionName = "Migrations";

    /// <summary>When false the runner is skipped at startup.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Directory with *.sql files. Null (default) uses the scripts embedded in MatterFlow.Data.</summary>
    public string? ScriptsFolder { get; set; }

    public int LockTimeoutSeconds { get; set; } = 300;

    public int CommandTimeoutSeconds { get; set; } = 600;

    /// <summary>Name under <c>ConnectionStrings</c>; falls back to <c>Default</c>.</summary>
    public string ConnectionStringName { get; set; } = "Migrations";
}
