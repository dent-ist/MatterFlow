using System.Globalization;
using System.Text;
using LptHub.Reports.Application.Results;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Time;
using Microsoft.Extensions.Configuration;

namespace LptHub.Reports.Application;

/// <summary>A CSV export that passed every check and is ready to stream.</summary>
/// <param name="Order">Row indexes of the live result that pass the filters, in sort order: the same walk the rows endpoint pages through.</param>
/// <param name="Columns">Column indexes in file order.</param>
public sealed record ExportPlan(StoredResult Stored, ResultOrigin Origin, int[] Order, int[] Columns, string FileName, ExportAuditInfo Audit)
{
    public int RowCount => Order.Length;
}

public sealed record ExportPrepared(ExportPlan? Plan, RunProblem? Problem);

/// <summary>
/// CSV export of the caller's live result (issue #721). It exports exactly what the grid could show: the same filter and sort strings as the rows
/// endpoint, over the same cached order, never more than the result holds (which the run already cut at the row cap). It re-checks that the caller may
/// still run the report, writes one run-log row of kind Export and the <c>REPORT_EXPORT</c> audit event, and builds a file name from the report name
/// that holds no path characters.
/// </summary>
public sealed class ReportExportService(ICurrentUser user, IReportCatalog catalog, IReportRunLog log, IConfiguration configuration, TimeProvider time)
{
    public const int MaxFileNameSlug = 60;

    public async Task<ExportPrepared> PrepareAsync(StoredResult stored, string? sort, string? filter, IReadOnlyList<string>? columnNames, CancellationToken cancellationToken)
    {
        if (user.UserId is not { } userId || userId != stored.OwnerUserId)
            return Fail(404, ErrorCodes.NotFound, "This result does not exist.");

        // A result that outlives the person's access (role removed, report deactivated, category deactivated) is not exported.
        if (stored.Origin is null || await catalog.FindRunnableAsync(stored.ReportId, userId, cancellationToken) is null)
            return Fail(404, ErrorCodes.NotFound, ReportRunService.NotAvailableMessage);

        try
        {
            var table = stored.Table;
            var filters = ResultQuery.ParseFilters(filter);
            var sorts = ResultQuery.ParseSort(sort, table);
            var columns = ResolveColumns(table, columnNames);
            var order = ResultQuery.Order(table, filters, sorts);
            var audit = new ExportAuditInfo(Summarize(filters, sorts), columns.Select(c => table.Columns[c].Name).ToList());
            return new ExportPrepared(new ExportPlan(stored, stored.Origin, order, columns, FileName(stored.Origin.ReportName, stored.Truncated), audit), null);
        }
        catch (ResultQueryException ex)
        {
            return Fail(400, "RESULT_QUERY_INVALID", ex.Message);
        }
    }

    /// <summary>Streams the file and keeps the run log: a row when it starts, completed when it ends (or is cut off by the client).</summary>
    public async Task<int> StreamAsync(ExportPlan plan, Stream body, CancellationToken cancellationToken)
    {
        var userId = plan.Stored.OwnerUserId;
        var start = new RunStart(plan.Stored.ReportId, plan.Origin.VersionId, userId, ReportRunKind.Export, null, Guid.NewGuid(), plan.Origin.ReportName, plan.Origin.VersionNo, plan.Audit);
        var runId = await log.StartAsync(start, CancellationToken.None);
        var written = 0;
        try
        {
            written = await ReportCsvWriter.WriteAsync(body, plan.Stored.Table, plan.Order, plan.Columns, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            await log.CompleteAsync(runId, start, new RunCompletion(ReportRunStatus.Cancelled, written, plan.Stored.Truncated, null, "CANCELLED", written), CancellationToken.None);
            throw;
        }
        catch (Exception)
        {
            await log.CompleteAsync(runId, start, new RunCompletion(ReportRunStatus.Failed, written, plan.Stored.Truncated, null, "UNEXPECTED", written), CancellationToken.None);
            throw;
        }

        await log.CompleteAsync(runId, start, new RunCompletion(plan.Stored.Truncated ? ReportRunStatus.Truncated : ReportRunStatus.Succeeded, written, plan.Stored.Truncated, null, null, written), CancellationToken.None);
        return written;
    }

    /// <summary>
    /// The columns to write, in the order given; all columns when none are named. Each is a position <c>#n</c> (what a client sends) or a name (the first column with that name,
    /// <see cref="ResultTable.Resolve"/>). A reference that is not a column is a 400; the same column named twice is written once, but two columns that happen to share a name
    /// are two columns, each written under its own name.
    /// </summary>
    internal static int[] ResolveColumns(ResultTable table, IReadOnlyList<string>? names)
    {
        var wanted = names?.Where(n => !string.IsNullOrEmpty(n)).ToList() ?? [];
        if (wanted.Count == 0)
            return Enumerable.Range(0, table.Columns.Count).ToArray();
        var indexes = new List<int>();
        foreach (var name in wanted)
        {
            var index = table.Resolve(name);
            if (index < 0)
                throw new ResultQueryException($"Unknown column '{(name.Length <= 40 ? name : name[..40] + "...")}'.");
            if (!indexes.Contains(index))
                indexes.Add(index);
        }

        return indexes.ToArray();
    }

    /// <summary>Filters and sort as the audit trail states them: columns and operators only, never the values typed (they can name people or matters).</summary>
    internal static string Summarize(IReadOnlyList<ResultFilter> filters, IReadOnlyList<ResultSort> sorts)
    {
        var parts = new List<string>();
        if (filters.Count > 0)
            parts.Add("filter: " + string.Join("; ", filters.Select(f => $"{f.Column} {f.Op}")));
        if (sorts.Count > 0)
            parts.Add("sort: " + string.Join(", ", sorts.Select(s => $"{s.Column} {(s.Descending ? "desc" : "asc")}")));
        var text = parts.Count == 0 ? "none" : string.Join(" | ", parts);
        return text.Length <= 1000 ? text : text[..997] + "...";
    }

    /// <summary><c>&lt;report-slug&gt;-yyyyMMdd-HHmm[-truncated].csv</c>; the time is the firm's local time. Only a-z, 0-9 and hyphens.</summary>
    internal string FileName(string reportName, bool truncated)
    {
        var zone = UserTimeZone.Resolve(null, configuration["Firm:TimeZoneId"]).Zone;
        var local = TimeZoneInfo.ConvertTimeFromUtc(time.GetUtcNow().UtcDateTime, zone);
        return $"{Slug(reportName)}-{local.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture)}{(truncated ? "-truncated" : "")}.csv";
    }

    /// <summary>Lower-case ASCII letters and digits separated by single hyphens; accents are dropped to their base letter; "report" when nothing is left.</summary>
    public static string Slug(string name)
    {
        var sb = new StringBuilder();
        foreach (var ch in (name ?? "").Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark)
                continue;
            var lower = char.ToLowerInvariant(ch);
            if (lower is >= 'a' and <= 'z' or >= '0' and <= '9')
                sb.Append(lower);
            else if (sb.Length > 0 && sb[^1] != '-')
                sb.Append('-');
        }

        var slug = sb.ToString().Trim('-');
        if (slug.Length > MaxFileNameSlug)
            slug = slug[..MaxFileNameSlug].Trim('-');
        return slug.Length == 0 ? "report" : slug;
    }

    private static ExportPrepared Fail(int status, string code, string message) => new(null, new RunProblem(status, code, message));
}
