using System.ComponentModel.DataAnnotations;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Lookups;

/// <summary>One of the five fixed lifecycle statuses with its display label.</summary>
/// <param name="Code">Internal code (NEW, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED). Immutable.</param>
/// <param name="DisplayLabel">What users see.</param>
/// <param name="SortOrder">Lifecycle order.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64); send it back on update.</param>
/// <param name="TaskCount">
/// Tasks in this status, open or closed, over every pod, Matter and Project, counting only the Tasks the viewer may see (sensitive-matter rule).
/// Null (not 0) when the viewer lacks <c>Task.View</c>. The list and the update response carry it.
/// </param>
public sealed record StatusLabelView(
    [property: Required] string Code,
    [property: Required] string DisplayLabel,
    [property: Required] int SortOrder,
    [property: Required] string RowVersion,
    int? TaskCount = null);

/// <summary>Body to rename how a status is displayed. The code itself cannot be changed.</summary>
public sealed record UpdateStatusLabelRequest(
    [Required, StringLength(50)] string DisplayLabel,
    [Required] string RowVersion);

/// <summary>Status display labels: only the label of each fixed code is editable (no create, no delete, no code change).</summary>
public sealed class StatusLabelService(DbContext db, IPermissionChecker permissions, IConfigurationTaskCounts taskCounts) : IStatusLabelCatalog
{
    private static StatusLabelView ToView(TaskStatusLabel s, IReadOnlyDictionary<string, int>? counts) =>
        new(s.StatusCode, s.DisplayLabel, s.SortOrder, LookupSupport.FormatRowVersion(s.RowVersion), counts?.GetValueOrDefault(s.StatusCode));

    /// <summary>The Task count of each status (one grouped statement), or null when the viewer may not see Tasks. A status with no Task is 0.</summary>
    private async Task<IReadOnlyDictionary<string, int>?> CountsAsync(CancellationToken ct) =>
        permissions.Has(Permissions.Task.View) ? await taskCounts.CountByStatusAsync(ct) : null;

    public async Task<IReadOnlyList<StatusLabelView>> ListViewsAsync(CancellationToken ct = default)
    {
        var rows = await db.Set<TaskStatusLabel>().AsNoTracking().OrderBy(s => s.SortOrder).ToListAsync(ct);
        var counts = await CountsAsync(ct);
        return [.. rows.Select(s => ToView(s, counts))];
    }

    public async Task<IReadOnlyList<StatusLabelInfo>> ListAsync(CancellationToken cancellationToken = default) =>
        (await db.Set<TaskStatusLabel>().AsNoTracking().OrderBy(s => s.SortOrder).ToListAsync(cancellationToken))
            .Select(s => new StatusLabelInfo(s.StatusCode, s.DisplayLabel, s.SortOrder))
            .ToList();

    public async Task<string> GetLabelAsync(string statusCode, CancellationToken cancellationToken = default) =>
        await db.Set<TaskStatusLabel>().AsNoTracking()
            .Where(s => s.StatusCode == statusCode)
            .Select(s => s.DisplayLabel)
            .FirstOrDefaultAsync(cancellationToken) ?? statusCode;

    public async Task<Result<StatusLabelView>> UpdateAsync(string code, UpdateStatusLabelRequest request, CancellationToken ct = default)
    {
        var version = LookupSupport.ParseRowVersion(request.RowVersion);
        if (version is null)
            return LookupErrors.InvalidRowVersion();
        var label = LookupSupport.CleanText(request.DisplayLabel, "displayLabel", "Enter a label.");
        if (label.IsFailure)
            return label.Error!;

        var row = await db.Set<TaskStatusLabel>().FirstOrDefaultAsync(s => s.StatusCode == code, ct);
        if (row is null)
            return Error.NotFound("Status not found. The set of statuses is fixed.");
        if (!LookupSupport.VersionMatches(row, version))
            return LookupErrors.Concurrency();
        var duplicate = LookupErrors.Duplicate("displayLabel", $"A status labelled '{label.Value}' exists.");
        if (await db.Set<TaskStatusLabel>().AnyAsync(s => s.DisplayLabel == label.Value && s.StatusCode != code, ct))
            return duplicate;

        row.DisplayLabel = label.Value;
        LookupSupport.ExpectVersion(db, row, version);
        var failure = await LookupSupport.SaveAsync(db, duplicate, null, ct);
        return failure is not null ? failure : ToView(row, await CountsAsync(ct));
    }
}
