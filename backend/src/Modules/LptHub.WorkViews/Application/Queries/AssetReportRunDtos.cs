using System.ComponentModel.DataAnnotations;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>A column of an asset report result. The first column is always the number of assets; the others are the measure per unit.</summary>
/// <param name="Key"><c>count</c>, <c>sum:&lt;unit&gt;</c> or <c>average:&lt;unit&gt;</c>.</param>
/// <param name="Label">For example <c>Assets</c> or <c>Sum of Size (GB)</c>.</param>
/// <param name="Unit">The unit of a measure column (<c>GB</c>, <c>Items</c>, ...); null for the count.</param>
public sealed record AssetReportColumn([property: Required] string Key, [property: Required] string Label, string? Unit);

/// <summary>One group of an asset report result: its label and one cell per column (null where no asset of the group had a value).</summary>
/// <param name="Key">The group (a disposition code, an id, an option key); empty for assets without a value of a group-by field.</param>
/// <param name="Label">What the table shows.</param>
/// <param name="Cells">One cell per column, in column order.</param>
public sealed record AssetReportRow([property: Required] string Key, [property: Required] string Label, [property: Required] IReadOnlyList<decimal?> Cells);

/// <summary>
/// The result of running an asset report: a table first (columns and rows), the totals and the notes a reader needs. Computed with the viewer's current visibility; a matter hidden
/// by the sensitive-matter rule contributes nothing to any count, sum, group label or matter list.
/// </summary>
/// <param name="Measure"><c>count</c>, <c>sum</c> or <c>average</c>.</param>
/// <param name="GroupBy">The group-by key of the definition.</param>
/// <param name="GroupByLabel">For example <c>Disposition</c>.</param>
/// <param name="AssetTypeId">The asset type, or null for all types.</param>
/// <param name="AssetTypeName">Its name.</param>
/// <param name="Columns">The columns; the first is the number of assets.</param>
/// <param name="Rows">The groups, largest first (disposition in its natural order), at most 200.</param>
/// <param name="Totals">All groups together (an average is the average of all assets with a value).</param>
/// <param name="HiddenGroups">How many smaller groups are not listed ("Top 200 by value, N more hidden").</param>
/// <param name="UnitsWarning">Set when the result mixes units; null otherwise.</param>
/// <param name="Assets">All assets counted.</param>
public sealed record AssetReportResult(
    [property: Required] string Measure,
    [property: Required] string GroupBy,
    [property: Required] string GroupByLabel,
    int? AssetTypeId,
    string? AssetTypeName,
    [property: Required] IReadOnlyList<AssetReportColumn> Columns,
    [property: Required] IReadOnlyList<AssetReportRow> Rows,
    [property: Required] AssetReportRow Totals,
    [property: Required] int HiddenGroups,
    string? UnitsWarning,
    [property: Required] int Assets);
