using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;

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
public sealed class ReportBrowseService(IReportCatalog catalog, ICurrentUser user)
{
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
