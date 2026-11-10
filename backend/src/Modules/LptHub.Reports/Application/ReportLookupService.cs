using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Reports.Application;

/// <summary>One record a person may choose for a lookup parameter: the id the report takes and the words the form shows. Nothing else, by design.</summary>
public sealed record ReportLookupItem(int Id, string Label);

/// <summary>Reads the directory behind a lookup parameter. Implemented in Infrastructure with plain SQL on the application connection (owner decision 13).</summary>
public interface IReportLookupStore
{
    /// <summary>
    /// Active records of <paramref name="kind"/> whose label contains <paramref name="text"/> (all when empty), sorted by label, at most <paramref name="take"/>.
    /// Sensitive matters are never returned.
    /// </summary>
    Task<IReadOnlyList<ReportLookupItem>> SearchAsync(LookupKind kind, string? text, int take, CancellationToken cancellationToken);

    /// <summary>The records with these ids (active or not), sorted by label. Ids that do not exist, and ids of sensitive matters, are simply missing from the answer.</summary>
    Task<IReadOnlyList<ReportLookupItem>> ResolveAsync(LookupKind kind, IReadOnlyCollection<int> ids, CancellationToken cancellationToken);
}

/// <summary>
/// The reports-owned directory behind the lookup parameters (matter, client, user, pod, role, task type; owner decision 13, 2026-11-07). Anyone who may run a report may use the
/// lookups of THAT report, without <c>Client.View</c>, <c>Matter.View</c> or the other picker permissions, and gets only an id and a label. It is not a general directory:
/// the report must be runnable by the caller (same 404 as everywhere), the parameter must exist and be of type <c>lookup</c>, and the kind comes from the report definition.
/// <b>Sensitive matters are never listed or resolved, for anybody, whatever <c>Matter.ViewSensitive</c> says:</b> reports are for trusted roles and a run is not filtered
/// (option A), but this directory must not tell a person who has no matter permission that a sensitive matter exists. A report author who needs a sensitive matter filters by
/// typing its number in a text parameter.
/// </summary>
public sealed class ReportLookupService(ICurrentUser user, IReportCatalog catalog, IReportLookupStore store)
{
    public const int DefaultTake = 25;
    public const int MaxTake = 50;
    public const int MaxSearchLength = 100;
    public const int MaxIds = 200;

    public const string NotFoundMessage = "This report does not exist or is not available to you.";
    public const string NoSuchLookupMessage = "This report has no such lookup.";

    /// <summary>
    /// Searches (<paramref name="ids"/> null or empty) or resolves (<paramref name="ids"/> given, the text is ignored) the records of a lookup parameter of a report the caller may run.
    /// </summary>
    public async Task<AdminResult<IReadOnlyList<ReportLookupItem>>> GetAsync(int reportId, string parameter, string? text, int? take, IReadOnlyCollection<int>? ids, CancellationToken cancellationToken)
    {
        if (user.UserId is not { } userId)
            return AdminResult<IReadOnlyList<ReportLookupItem>>.Fail(401, ErrorCodes.Unauthenticated, "Sign in to run reports.");
        var report = await catalog.FindRunnableAsync(reportId, userId, cancellationToken);
        if (report is null)
            return AdminResult<IReadOnlyList<ReportLookupItem>>.Fail(404, ErrorCodes.NotFound, NotFoundMessage);

        var name = (parameter ?? "").Trim().ToUpperInvariant();
        var definition = ParameterDefinitionJson.Deserialize(report.ParametersJson).FirstOrDefault(d => d.Name == name);
        if (definition is not { Type: ReportParameterType.Lookup, LookupKind: { } kind })
            return AdminResult<IReadOnlyList<ReportLookupItem>>.Fail(404, ErrorCodes.NotFound, NoSuchLookupMessage);

        if (ids is { Count: > 0 })
        {
            if (ids.Count > MaxIds)
                return AdminResult<IReadOnlyList<ReportLookupItem>>.Fail(400, "LOOKUP_TOO_MANY_IDS", $"Ask for at most {MaxIds} records at a time.");
            return AdminResult<IReadOnlyList<ReportLookupItem>>.Ok(await store.ResolveAsync(kind, [.. ids.Distinct()], cancellationToken));
        }

        var trimmed = text?.Trim();
        if (trimmed is { Length: > MaxSearchLength })
            return AdminResult<IReadOnlyList<ReportLookupItem>>.Fail(400, "LOOKUP_TEXT_TOO_LONG", $"Search text can have at most {MaxSearchLength} characters.");
        var count = Math.Clamp(take ?? DefaultTake, 1, MaxTake);
        return AdminResult<IReadOnlyList<ReportLookupItem>>.Ok(await store.SearchAsync(kind, trimmed, count, cancellationToken));
    }
}
