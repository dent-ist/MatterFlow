using System.Text.Json;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using Microsoft.Extensions.Options;

namespace MatterFlow.Reports.Application;

/// <summary>
/// One report a person may run, as the catalogue reads it. <see cref="SqlText"/> is only here so the service can count the parameters the SQL really
/// uses; it is never copied into anything that leaves the service.
/// </summary>
public sealed record RunnableListItem(
    int ReportId,
    string Name,
    string? Description,
    int SortOrder,
    int CategoryId,
    string CategoryName,
    int CategorySortOrder,
    int VersionNo,
    string SqlText,
    string ParametersJson,
    DateTime? LastRunAtUtc);

/// <summary>
/// One report a person may run, with everything the run page shows. <see cref="SqlText"/> is only here so the service can find the parameters the SQL really
/// uses; it is never copied into anything that leaves the service.
/// </summary>
public sealed record RunnableDetail(
    int ReportId,
    string Name,
    string? Description,
    string? HelpText,
    int CategoryId,
    string CategoryName,
    int VersionNo,
    string SqlText,
    string ParametersJson,
    int? TimeoutSeconds,
    int? MaxRows);

/// <summary>A fixed choice of a single or multi choice parameter.</summary>
public sealed record RunnableOption(string Value, string Label);

/// <summary>
/// One input of the parameter form, in the shape the form needs and without anything the person must not get: no choice SELECT, no SQL, no limits the
/// form cannot use. Which members apply depends on <see cref="Type"/>.
/// </summary>
/// <param name="Name">The upper-case name used as the key of the run request (for <c>dateRange</c> the base name; the value is <c>{from,to}</c>).</param>
/// <param name="Type">number, date, text, single, multi, dateRange, yesNo or lookup.</param>
/// <param name="Default">The default already resolved for this person and day (a date for <c>today</c>, the person's pods for <c>myPods</c>), in the form the run request takes; null when there is none.</param>
/// <param name="Multiple">True when the value is a list (multi choice, or a lookup that takes several).</param>
/// <param name="LookupKind">For lookup: matter, client, user, pod, role or taskType.</param>
/// <param name="ValueType">For single and multi: <c>text</c> or <c>int</c> (what the option values are).</param>
/// <param name="ChoicesSource">For single and multi: <c>fixed</c> (the options are in <paramref name="Options"/>) or <c>query</c> (ask <c>POST /reports/{id}/choices/{name}</c>).</param>
public sealed record RunnableParameter(
    string Name,
    string Type,
    string Label,
    string? HelpText,
    bool Required,
    JsonElement? Default,
    bool Multiple,
    string? LookupKind,
    string? ValueType,
    string? ChoicesSource,
    IReadOnlyList<RunnableOption> Options,
    decimal? Min,
    decimal? Max,
    bool IntegerOnly,
    int? MaxLength,
    int? MaxSelected);

/// <summary>The definition of a report for the person who may run it (the run page).</summary>
/// <param name="TimeoutSeconds">The time limit that applies to a run of this report.</param>
/// <param name="MaxRows">The row limit that applies to a run of this report.</param>
public sealed record RunnableReportDefinition(
    int ReportId,
    string Name,
    string? Description,
    string? HelpText,
    int CategoryId,
    string CategoryName,
    int VersionNo,
    int TimeoutSeconds,
    int MaxRows,
    IReadOnlyList<RunnableParameter> Parameters);

/// <summary>A report in the list of a person who may run it. Carries no SQL.</summary>
/// <param name="ParameterLabels">The labels of the parameters the person is asked for, in order.</param>
/// <param name="LastRunAtUtc">When this person last ran the report successfully (previews and choice queries do not count); null when never.</param>
public sealed record RunnableReportSummary(
    int ReportId,
    string Name,
    string? Description,
    int SortOrder,
    int ParameterCount,
    IReadOnlyList<string> ParameterLabels,
    DateTime? LastRunAtUtc);

/// <summary>A category with the reports the person may run in it.</summary>
public sealed record RunnableCategory(int CategoryId, string Name, int SortOrder, IReadOnlyList<RunnableReportSummary> Reports);

/// <summary>
/// What a person who only holds <c>Report.Run</c> may see of the reports: the list of what is assigned to their roles. Never SQL, option SQL or
/// anything about reports the person may not run.
/// </summary>
public sealed class ReportBrowseService(IReportCatalog catalog, ICurrentUser user, BuiltInContextFactory builtIns, IOptions<ReportsOptions> options)
{
    private readonly ReportsOptions _options = options.Value;

    /// <summary>
    /// The definition of one report for the person who may run it. Unknown, inactive and not assigned all answer 404 with the same text as a run, so the
    /// existence of a hidden report is not revealed.
    /// </summary>
    public async Task<AdminResult<RunnableReportDefinition>> GetAsync(int reportId, CancellationToken cancellationToken)
    {
        if (user.UserId is not { } userId)
            return AdminResult<RunnableReportDefinition>.Fail(401, ErrorCodes.Unauthenticated, "Sign in to run reports.");

        var report = await catalog.FindRunnableDetailAsync(reportId, userId, cancellationToken);
        if (report is null)
            return AdminResult<RunnableReportDefinition>.Fail(404, ErrorCodes.NotFound, ReportRunService.NotAvailableMessage);

        var asked = AskedParameters(report.SqlText, report.ParametersJson);
        var context = asked.Any(d => d.Default is not null) ? await builtIns.CreateAsync(userId, cancellationToken) : null;
        return AdminResult<RunnableReportDefinition>.Ok(new RunnableReportDefinition(
            report.ReportId,
            report.Name,
            report.Description,
            report.HelpText,
            report.CategoryId,
            report.CategoryName,
            report.VersionNo,
            _options.EffectiveTimeout(report.TimeoutSeconds),
            _options.EffectiveMaxRows(report.MaxRows),
            asked.Select(d => ToParameter(d, context)).ToList()));
    }

    /// <summary>The form's view of a definition. Only the fixed options of a choice list are copied; the choice SELECT stays on the server.</summary>
    internal static RunnableParameter ToParameter(ReportParameterDefinition d, BuiltInContext? context)
    {
        var isChoice = d.Type is ReportParameterType.Single or ReportParameterType.Multi;
        var fixedChoices = isChoice && d.OptionsKind == OptionsKind.Fixed;
        return new RunnableParameter(
            d.Name,
            CamelCase(d.Type),
            d.Label.Length > 0 ? d.Label : d.Name,
            string.IsNullOrWhiteSpace(d.HelpText) ? null : d.HelpText,
            d.IsRequired,
            context is null ? null : ParameterDefaults.Resolve(d, context),
            d.IsList,
            d.Type == ReportParameterType.Lookup ? d.LookupKind is { } kind ? CamelCase(kind) : null : null,
            isChoice ? CamelCase(d.ValueType) : null,
            isChoice && d.OptionsKind is { } source ? CamelCase(source) : null,
            fixedChoices ? d.Options.Select(o => new RunnableOption(o.Value, o.Label)).ToList() : [],
            d.Type == ReportParameterType.Number ? d.Min : null,
            d.Type == ReportParameterType.Number ? d.Max : null,
            d.Type == ReportParameterType.Number && d.IntegerOnly,
            d.Type == ReportParameterType.Text ? d.MaxLength ?? ReportParameterDefinition.DefaultMaxTextLength : null,
            d.IsList ? d.MaxSelected ?? ReportParameterDefinition.DefaultMaxSelected : null);
    }

    private static string CamelCase<T>(T value) where T : struct, Enum => JsonNamingPolicy.CamelCase.ConvertName(value.ToString());

    /// <summary>
    /// The active reports (with a current version) that are assigned to one of the person's active roles, grouped by category in the administrator's
    /// order (category order, then name; report order, then name). A report is a parameter-free report when the SQL uses none of its definitions.
    /// </summary>
    public async Task<AdminResult<IReadOnlyList<RunnableCategory>>> ListAsync(CancellationToken cancellationToken)
    {
        if (user.UserId is not { } userId)
            return AdminResult<IReadOnlyList<RunnableCategory>>.Fail(401, ErrorCodes.Unauthenticated, "Sign in to see reports.");

        var items = await catalog.ListRunnableAsync(userId, cancellationToken);
        var categories = items
            .GroupBy(i => (i.CategoryId, i.CategoryName, i.CategorySortOrder))
            .OrderBy(g => g.Key.CategorySortOrder)
            .ThenBy(g => g.Key.CategoryName, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(g => g.Key.CategoryId)
            .Select(g => new RunnableCategory(
                g.Key.CategoryId,
                g.Key.CategoryName,
                g.Key.CategorySortOrder,
                g.OrderBy(i => i.SortOrder).ThenBy(i => i.Name, StringComparer.CurrentCultureIgnoreCase).ThenBy(i => i.ReportId).Select(Summarise).ToList()))
            .ToList();
        return AdminResult<IReadOnlyList<RunnableCategory>>.Ok(categories);
    }

    private static RunnableReportSummary Summarise(RunnableListItem item)
    {
        var labels = AskedParameters(item.SqlText, item.ParametersJson).Select(d => d.Label.Length > 0 ? d.Label : d.Name).ToList();
        return new RunnableReportSummary(item.ReportId, item.Name, item.Description, item.SortOrder, labels.Count, labels, item.LastRunAtUtc);
    }

    /// <summary>
    /// The definitions a person is asked for: those whose placeholder occurs in the SQL (the run binds only these; an unused definition would be a field
    /// that does nothing). When the stored text or definitions cannot be read the definitions are listed as they are, and the run itself refuses the report.
    /// </summary>
    internal static IReadOnlyList<ReportParameterDefinition> AskedParameters(string sqlText, string parametersJson)
    {
        IReadOnlyList<ReportParameterDefinition> definitions;
        try
        {
            definitions = ParameterDefinitionJson.Deserialize(parametersJson);
        }
        catch (System.Text.Json.JsonException)
        {
            return [];
        }

        try
        {
            var used = ReportSqlCompiler.Compile(sqlText, definitions).UsedPlaceholders;
            return definitions.Where(d => d.PlaceholderNames.Any(used.Contains)).ToList();
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return definitions;
        }
    }
}
