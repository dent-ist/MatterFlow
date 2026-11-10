using LptHub.Reports.Domain;
using LptHub.Reports.Domain.Parameters;
using Microsoft.Extensions.Logging;

namespace LptHub.Reports.Application.Starters;

/// <summary>What happened to one starter report.</summary>
public enum StarterSeedOutcome
{
    /// <summary>Created now: category, report, first version (previewed and active) and the role assignments.</summary>
    Created,

    /// <summary>Already seeded (marker present) or a report with that name exists; left exactly as it is.</summary>
    Existing,

    /// <summary>Dry run: would be created.</summary>
    WouldCreate,

    /// <summary>Could not be seeded (see the detail); the others continue and the next start tries again.</summary>
    Failed,
}

public sealed record StarterSeedAction(string Key, StarterSeedOutcome Outcome, string? Detail = null);

public sealed class StarterReportSeedReport(bool dryRun)
{
    private readonly List<StarterSeedAction> _actions = [];

    public bool DryRun { get; } = dryRun;

    public IReadOnlyList<StarterSeedAction> Actions => _actions;

    public bool HasFailures => _actions.Any(a => a.Outcome == StarterSeedOutcome.Failed);

    public bool Changed => _actions.Any(a => a.Outcome == StarterSeedOutcome.Created);

    public int Count(StarterSeedOutcome outcome) => _actions.Count(a => a.Outcome == outcome);

    internal void Add(string key, StarterSeedOutcome outcome, string? detail = null) => _actions.Add(new StarterSeedAction(key, outcome, detail));

    public string Summary() => string.Join(", ", _actions.GroupBy(a => a.Outcome).Select(g => $"{g.Count()} {g.Key}"));
}

/// <summary>Remembers which starter reports were handled once (<c>dbo.SeedMarker</c>), so an administrator's edits, renames and deactivations are never undone.</summary>
public interface IReportStarterMarkers
{
    Task<bool> ExistsAsync(string name, CancellationToken cancellationToken);

    Task AddAsync(string name, CancellationToken cancellationToken);
}

/// <summary>
/// Creates the starter reports (issue #724) on a database that does not have them yet. It follows the pattern of the starter-configuration seed: idempotent,
/// off outside Development unless switched on, a dry run only logs, and an existing item is never modified (one <c>SeedMarker</c> per starter, so an
/// administrator who renamed, edited or deactivated a starter keeps it that way and a deleted-by-deactivation one does not come back).
/// <para>
/// Each starter is created through the same tables as an administrator's report (category, definition, first version with its parameter snapshot) and is marked as
/// previewed and made active without being executed at startup: the SQL runs only when a person clicks Run. That the SQL is valid and runs on the real schema
/// through the read-only login is proved by the integration test <c>ReportStarterTests</c>, which fails the build when a schema change breaks a starter.
/// The seeder never assigns a report to a role unless the manifest names one, and no starter names one: no starter role holds <c>Report.Run</c>.
/// </para>
/// </summary>
public sealed class ReportStarterSeeder(IReportAdminStore admin, IReportDefinitionStore definitions, IReportStarterMarkers markers, ILogger<ReportStarterSeeder> logger)
{
    public const string ChangeNote = "Starter report";

    public Task<StarterReportSeedReport> SeedAsync(bool dryRun, CancellationToken cancellationToken = default) =>
        SeedAsync(StarterReportManifest.LoadEmbedded(), dryRun, cancellationToken);

    public async Task<StarterReportSeedReport> SeedAsync(StarterReportManifest manifest, bool dryRun, CancellationToken cancellationToken = default)
    {
        var report = new StarterReportSeedReport(dryRun);
        Dictionary<string, CategoryRow>? categories = null;
        Dictionary<string, int>? roleIds = null;

        foreach (var starter in manifest.Reports.OrderBy(r => r.SortOrder).ThenBy(r => r.Name, StringComparer.Ordinal))
        {
            try
            {
                if (await markers.ExistsAsync(starter.MarkerName, cancellationToken))
                {
                    report.Add(starter.Key, StarterSeedOutcome.Existing);
                    continue;
                }

                if (Problem(starter) is { } problem)
                {
                    report.Add(starter.Key, StarterSeedOutcome.Failed, problem);
                    logger.LogWarning("Starter report {Key} is not valid and was not created: {Detail}", starter.Key, problem);
                    continue;
                }

                if (dryRun)
                {
                    report.Add(starter.Key, StarterSeedOutcome.WouldCreate);
                    logger.LogInformation("Dry run: would create the starter report {Name}.", starter.Name);
                    continue;
                }

                categories ??= (await admin.ListCategoriesAsync(cancellationToken)).ToDictionary(c => c.Name, StringComparer.OrdinalIgnoreCase);
                var categoryId = await EnsureCategoryAsync(manifest, starter.Category, categories, cancellationToken);
                if (categoryId is null)
                {
                    report.Add(starter.Key, StarterSeedOutcome.Failed, $"The category '{starter.Category}' is missing or inactive.");
                    logger.LogWarning("Starter report {Key} was not created: the category '{Category}' is missing or inactive.", starter.Key, starter.Category);
                    continue;
                }

                var created = await admin.CreateReportAsync(
                    new NewReport(
                        new ReportDetails(starter.Name, categoryId.Value, starter.Description, starter.HelpText, starter.SortOrder, null, null),
                        starter.Sql,
                        SqlValidator.Hash(starter.Sql),
                        ReportAuthoringService.NormalizeParameters(starter.ParametersJson, out _),
                        ChangeNote,
                        null),
                    cancellationToken);

                if (created.Status == StoreStatus.DuplicateName)
                {
                    // A report with this name is already there (an administrator made it, or renamed another one to it): never touch it.
                    await markers.AddAsync(starter.MarkerName, cancellationToken);
                    report.Add(starter.Key, StarterSeedOutcome.Existing, "A report with this name already exists; left as it is.");
                    continue;
                }

                if (!created.IsOk)
                {
                    report.Add(starter.Key, StarterSeedOutcome.Failed, "The report could not be created: " + created.Status);
                    logger.LogWarning("Starter report {Key} could not be created: {Status}", starter.Key, created.Status);
                    continue;
                }

                var value = created.Value!;
                // The version counts as previewed (CI runs every starter through the report login) and the report is active from the start.
                if (await definitions.MarkPreviewOkAsync(value.ReportId, value.VersionId, null, cancellationToken) is null
                    || await definitions.SetActiveAsync(value.ReportId, true, null, cancellationToken) is null)
                {
                    report.Add(starter.Key, StarterSeedOutcome.Failed, "The report was created but could not be activated; an administrator can preview and activate it.");
                    await markers.AddAsync(starter.MarkerName, cancellationToken);
                    continue;
                }

                if (starter.Roles.Count > 0)
                {
                    roleIds ??= (await admin.GetMatrixAsync(cancellationToken)).Roles.ToDictionary(r => r.Name, r => r.Id, StringComparer.OrdinalIgnoreCase);
                    var wanted = starter.Roles.Where(roleIds.ContainsKey).Select(r => roleIds[r]).ToList();
                    if (wanted.Count > 0)
                        await admin.ReplaceReportRolesAsync(value.ReportId, wanted, null, cancellationToken);
                }

                await markers.AddAsync(starter.MarkerName, cancellationToken);
                report.Add(starter.Key, StarterSeedOutcome.Created);
                logger.LogInformation("Created the starter report {Name} (version {Version}, active).", starter.Name, value.VersionNo);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // A failing starter never stops the host or the other starters; the next start tries it again.
                report.Add(starter.Key, StarterSeedOutcome.Failed, ex.GetType().Name);
                logger.LogError(ex, "Starter report {Key} could not be seeded.", starter.Key);
            }
        }

        logger.LogInformation("Starter reports{DryRun}: {Summary}", dryRun ? " (dry run)" : "", report.Summary());
        return report;
    }

    /// <summary>Why a starter cannot be created (its SQL or its parameters fail the same checks an administrator's report would), or null.</summary>
    internal static string? Problem(StarterReport starter)
    {
        ReportAuthoringService.NormalizeParameters(starter.ParametersJson, out var parameterProblem);
        if (parameterProblem is not null)
            return "The parameters are not valid: " + parameterProblem.Message;

        var parameters = ParameterDefinitionJson.Deserialize(ReportAuthoringService.NormalizeParameters(starter.ParametersJson, out _));
        var (_, validation) = ReportSqlCompiler.CompileAndValidate(starter.Sql, parameters);
        if (!validation.IsValid)
            return "The SQL is not accepted by the validator: " + string.Join("; ", validation.Errors.Select(e => $"line {e.Line}: {e.Message}"));

        return null;
    }

    private async Task<int?> EnsureCategoryAsync(StarterReportManifest manifest, string name, Dictionary<string, CategoryRow> categories, CancellationToken cancellationToken)
    {
        if (categories.TryGetValue(name, out var existing))
            return existing.IsActive ? existing.CategoryId : null;

        var sortOrder = manifest.Categories.FirstOrDefault(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase))?.SortOrder ?? 100;
        var created = await admin.CreateCategoryAsync(name, sortOrder, null, cancellationToken);
        if (!created.IsOk)
            return null;
        categories[name] = created.Value!;
        return created.Value!.CategoryId;
    }
}
