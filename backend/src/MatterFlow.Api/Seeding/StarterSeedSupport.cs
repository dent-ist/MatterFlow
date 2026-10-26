using System.Text;
using System.Text.Json;
using MatterFlow.Configuration.Application.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.Identity.Access;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MatterFlow.Api.Seeding;

/// <summary>Settings of the optional starter-configuration seed (<c>Seed:StarterConfiguration</c>).</summary>
/// <param name="Enabled">Whether the seed runs at startup. Default: on in Development, off everywhere else.</param>
/// <param name="DryRun">Only log what would be created; write nothing.</param>
public sealed record StarterConfigurationOptions(bool Enabled, bool DryRun)
{
    public const string SectionName = "Seed:StarterConfiguration";

    public static StarterConfigurationOptions From(IConfiguration configuration, IHostEnvironment environment)
    {
        var section = configuration.GetSection(SectionName);
        return new StarterConfigurationOptions(
            section.GetValue<bool?>("Enabled") ?? environment.IsDevelopment(),
            section.GetValue<bool?>("DryRun") ?? false);
    }
}

/// <summary>What happened to one seeded item.</summary>
public enum SeedOutcome
{
    /// <summary>Created now.</summary>
    Created,

    /// <summary>Existed but was an untouched shell (empty form or empty first draft); filled and published now.</summary>
    Completed,

    /// <summary>Already there; left exactly as it is (admin edits are never overwritten).</summary>
    Existing,

    /// <summary>Dry run: would be created.</summary>
    WouldCreate,

    /// <summary>Dry run: would be filled and published.</summary>
    WouldComplete,

    /// <summary>Could not be seeded (see the detail); the rest of the seed continues.</summary>
    Failed,
}

/// <summary>One line of the seed report.</summary>
/// <param name="Kind">Role, Step, Workflow, TaskType or AssetType.</param>
/// <param name="Name">Stable name (role name, step title, workflow name, ...).</param>
/// <param name="Outcome">What happened.</param>
/// <param name="Detail">Why, for a failure or a note.</param>
public sealed record SeedAction(string Kind, string Name, SeedOutcome Outcome, string? Detail = null);

/// <summary>The result of one seed run.</summary>
public sealed class StarterSeedReport(bool dryRun)
{
    private readonly List<SeedAction> _actions = [];

    public bool DryRun { get; } = dryRun;

    public IReadOnlyList<SeedAction> Actions => _actions;

    /// <summary>True when any item failed.</summary>
    public bool HasFailures => _actions.Any(a => a.Outcome == SeedOutcome.Failed);

    /// <summary>True when a real run wrote anything.</summary>
    public bool Changed => _actions.Any(a => a.Outcome is SeedOutcome.Created or SeedOutcome.Completed);

    public int Count(string kind, params SeedOutcome[] outcomes) =>
        _actions.Count(a => a.Kind == kind && (outcomes.Length == 0 || outcomes.Contains(a.Outcome)));

    internal void Add(string kind, string name, SeedOutcome outcome, string? detail = null) =>
        _actions.Add(new SeedAction(kind, name, outcome, detail));

    public string Summary()
    {
        var parts = _actions
            .GroupBy(a => a.Kind)
            .Select(g => g.Key + ": " + string.Join(", ", g.GroupBy(a => a.Outcome).Select(o => $"{o.Count()} {o.Key}")));
        return string.Join("; ", parts);
    }
}

/// <summary>
/// The acting identity of the seed: a system actor without a user row (audit shows "system") that holds every permission, so the real
/// application services run exactly as they do for a System Admin. It is only used inside the seed scope (see <see cref="Active"/>).
/// </summary>
public sealed class SeedActor : ICurrentUser, IPermissionChecker
{
    public bool Active { get; set; }

    public int? UserId => null;

    public bool IsAuthenticated => Active;

    public string? DisplayName => Active ? "Starter configuration seed" : null;

    public bool IsSystemAdmin => Active;

    public bool Has(string permissionCode) => Active;

    public Result Require(string permissionCode) =>
        Active
            ? Result.Success()
            : Result.Failure(Error.Forbidden($"The permission '{permissionCode}' is required."));

    /// <summary>Routes <see cref="ICurrentUser"/> and <see cref="IPermissionChecker"/> to the seed actor inside the seed scope, to the request user elsewhere.</summary>
    public static IServiceCollection AddSeedActor(IServiceCollection services)
    {
        services.TryAddScoped<SeedActor>();
        services.Replace(ServiceDescriptor.Scoped<ICurrentUser>(sp =>
            sp.GetRequiredService<SeedActor>().Active ? sp.GetRequiredService<SeedActor>() : sp.GetRequiredService<CurrentUser>()));
        services.Replace(ServiceDescriptor.Scoped<IPermissionChecker>(sp =>
            sp.GetRequiredService<SeedActor>().Active ? sp.GetRequiredService<SeedActor>() : sp.GetRequiredService<CurrentUser>()));
        return services;
    }
}

/// <summary>Converts the seed's plain field definitions into the real form schema.</summary>
public static class StarterFormBuilder
{
    /// <summary>Field keys that are mirrored into the typed filter index (domain review MF-3: filter Tasks by deadline driver).</summary>
    private static readonly HashSet<string> FilterableKeys = ["deadline_driver"];

    private static readonly HashSet<string> OptionControls = ["SELECT", "RADIO", "MULTISELECT"];

    public static IReadOnlyList<FormFieldModel> Build(IEnumerable<SeedField> fields) => [.. fields.Select(Convert)];

    public static FormFieldModel Convert(SeedField f) => new()
    {
        Key = f.Key,
        Label = f.Label,
        Control = f.Type,
        HelpText = string.IsNullOrWhiteSpace(f.Help) ? null : f.Help,
        Required = f.Required,
        DefaultValue = f.Default is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) } d ? d : null,
        ShowWhen = Rule(f.ShowWhen),
        RequiredWhen = Rule(f.RequiredWhen),
        IsFilterable = FilterableKeys.Contains(f.Key),
        Options = OptionControls.Contains(f.Type) ? [.. (f.Options ?? []).Select(o => new FormOptionModel { Key = o.Key, Label = o.Label })] : null,
    };

    /// <summary>
    /// The Asset Type form of the seed: the SME status values become a leading <c>asset_status</c> SELECT, because an Asset has only an
    /// active flag in the real schema (no status list). The field is LABELLED "Lifecycle" (#513): the record itself is Active or Inactive, and a
    /// second "Status" next to it reads as two statuses. The key and the option keys do not change, so stored values stay valid.
    /// </summary>
    /// <summary>The label of the seeded life-cycle select of an Asset Type form (key <c>asset_status</c>).</summary>
    public const string AssetLifecycleLabel = "Lifecycle";

    public static IReadOnlyList<FormFieldModel> BuildAssetType(SeedAssetType type)
    {
        var fields = new List<FormFieldModel>();
        if (type.StatusValues.Count > 0 && type.Fields.All(f => f.Key != "asset_status"))
        {
            fields.Add(new FormFieldModel
            {
                Key = "asset_status",
                Label = AssetLifecycleLabel,
                Control = "SELECT",
                Options = [.. type.StatusValues.Select(v => new FormOptionModel { Key = Slug(v), Label = v })],
            });
        }

        fields.AddRange(Build(type.Fields));
        return fields;
    }

    /// <summary>Lower-case slug used for option keys (letters, digits and underscores).</summary>
    public static string Slug(string label)
    {
        var sb = new StringBuilder();
        foreach (var c in label.Trim().ToLowerInvariant())
        {
            if (char.IsAsciiLetterOrDigit(c))
                sb.Append(c);
            else if (sb.Length > 0 && sb[^1] != '_')
                sb.Append('_');
        }

        return sb.ToString().Trim('_');
    }

    /// <summary>Converts model fields to the specs the publish validator takes.</summary>
    public static IReadOnlyList<FormFieldSpec> ToSpecs(IEnumerable<FormFieldModel> fields) =>
    [
        .. fields.Select(m => new FormFieldSpec
        {
            Key = m.Key,
            Label = m.Label,
            Control = m.Control,
            HelpText = m.HelpText,
            Section = m.Section,
            Required = m.Required,
            Default = m.DefaultValue,
            Validation = m.Validation,
            ShowWhen = m.ShowWhen,
            RequiredWhen = m.RequiredWhen,
            IsFilterable = m.IsFilterable,
            Options = [.. (m.Options ?? []).Select(o => new FormOptionSpec(o.Key, o.Label, o.AvailableWhen))],
        }),
    ];

    /// <summary>Runs the real publish validation (rule contract section 4 plus the architecture 7.5 checks) on a seeded form.</summary>
    public static FormPublishValidator.Outcome Validate(IEnumerable<FormFieldModel> fields) =>
        FormPublishValidator.Validate(ToSpecs(fields), new Dictionary<string, MatterFlow.Configuration.Domain.Forms.Rules.FormControl>());

    private static JsonElement? Rule(JsonElement? rule) =>
        rule is { ValueKind: JsonValueKind.Object } r ? r : null;
}
