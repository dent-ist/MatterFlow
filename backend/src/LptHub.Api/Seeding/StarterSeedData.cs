using System.Text.Json;
using System.Text.Json.Serialization;

namespace MatterFlow.Api.Seeding;

/// <summary>An option of a seeded SELECT, RADIO or MULTISELECT field.</summary>
public sealed record SeedOption(string Key, string Label);

/// <summary>A seeded form field, in the plain vocabulary of docs/sme/seed-configuration.json.</summary>
public sealed record SeedField
{
    public string Key { get; init; } = string.Empty;

    public string Label { get; init; } = string.Empty;

    public string Type { get; init; } = string.Empty;

    public bool Required { get; init; }

    public string? Help { get; init; }

    public JsonElement? Default { get; init; }

    public List<SeedOption>? Options { get; init; }

    public JsonElement? ShowWhen { get; init; }

    public JsonElement? RequiredWhen { get; init; }
}

public sealed record SeedRole
{
    public string Name { get; init; } = string.Empty;

    public bool BuiltIn { get; init; }

    public string? Description { get; init; }

    public List<string> Permissions { get; init; } = [];
}

public sealed record SeedAssetType
{
    public string Name { get; init; } = string.Empty;

    public List<string> StatusValues { get; init; } = [];

    public string? Naming { get; init; }

    public List<SeedField> Fields { get; init; } = [];

    /// <summary>Key of the NUMBER field that is the default size of the type (epic #851); empty: none.</summary>
    public string? SizeField { get; init; }

    /// <summary>Its unit: B, KB, MB, GB, TB or Items.</summary>
    public string? SizeUnit { get; init; }
}

public sealed record SeedStep
{
    public string Code { get; init; } = string.Empty;

    public string Title { get; init; } = string.Empty;

    public string? Description { get; init; }

    public string? Instructions { get; init; }

    public string? DocUrl { get; init; }

    /// <summary>Free-form tags of the library step (for example Relativity, Processing); optional.</summary>
    public List<string> Tags { get; init; } = [];

    public List<SeedField> Fields { get; init; } = [];
}

public sealed record SeedWorkflowStep(string Step, bool Skippable, bool SkipCommentRequired);

public sealed record SeedWorkflow
{
    public string Name { get; init; } = string.Empty;

    public bool Ordered { get; init; } = true;

    public string? Description { get; init; }

    public List<SeedWorkflowStep> Steps { get; init; } = [];
}

public sealed record SeedTaskType
{
    public string Name { get; init; } = string.Empty;

    public string? Description { get; init; }

    public string? TitleHint { get; init; }

    /// <summary>Icon key from the icon library (contracts/task-type-icons.json); omitted = the default icon.</summary>
    public string? IconKey { get; init; }

    public List<SeedField> Fields { get; init; } = [];

    public List<string> EligibleWorkflows { get; init; } = [];

    public string? DefaultWorkflow { get; init; }
}

/// <summary>The SME starter configuration (docs/sme/seed-configuration.json, embedded into the host at build time).</summary>
public sealed record StarterSeedData
{
    public const string ResourceName = "MatterFlow.Seed.seed-configuration.json";

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        ReadCommentHandling = JsonCommentHandling.Skip,
        Converters = { new JsonStringEnumConverter() },
    };

    public List<SeedRole> Roles { get; init; } = [];

    public List<SeedAssetType> AssetTypes { get; init; } = [];

    public List<SeedStep> StepDefinitions { get; init; } = [];

    public List<SeedWorkflow> Workflows { get; init; } = [];

    public List<SeedTaskType> TaskTypes { get; init; } = [];

    /// <summary>Loads the embedded seed file.</summary>
    public static StarterSeedData LoadEmbedded()
    {
        using var stream = typeof(StarterSeedData).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"The embedded resource {ResourceName} is missing.");
        return Parse(stream);
    }

    public static StarterSeedData Parse(Stream json) =>
        JsonSerializer.Deserialize<StarterSeedData>(json, Options) ?? throw new InvalidOperationException("The seed configuration is empty.");

    public static StarterSeedData Parse(string json) =>
        JsonSerializer.Deserialize<StarterSeedData>(json, Options) ?? throw new InvalidOperationException("The seed configuration is empty.");
}
