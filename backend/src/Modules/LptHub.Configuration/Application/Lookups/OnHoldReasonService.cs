using System.ComponentModel.DataAnnotations;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Lookups;

/// <summary>An on-hold reason for the admin screen and the status dialog.</summary>
/// <param name="Id">Reason id.</param>
/// <param name="Name">Display name (Waiting for client data, ...).</param>
/// <param name="SortOrder">Position in pickers.</param>
/// <param name="IsActive">False = not offered for new holds; tasks already on hold with it, and history, keep showing it.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64); send it back on update.</param>
public sealed record OnHoldReasonView(
    [property: Required] int Id,
    [property: Required] string Name,
    [property: Required] int SortOrder,
    [property: Required] bool IsActive,
    [property: Required] string RowVersion);

/// <summary>Body to create an on-hold reason (appended at the end).</summary>
public sealed record CreateOnHoldReasonRequest([Required, StringLength(100)] string Name, bool IsActive = true);

/// <summary>Body to rename, activate or deactivate an on-hold reason.</summary>
public sealed record UpdateOnHoldReasonRequest(
    [Required, StringLength(100)] string Name,
    [Required] bool IsActive,
    [Required] string RowVersion);

/// <summary>On-hold reasons: admin commands (audited by the generic interceptor) and the <see cref="IOnHoldReasonCatalog"/> read side. No delete: a used reason is deactivated.</summary>
public sealed class OnHoldReasonService(DbContext db) : IOnHoldReasonCatalog
{
    private static OnHoldReasonView ToView(OnHoldReason r) => new(r.Id, r.Name, r.SortOrder, r.IsActive, LookupSupport.FormatRowVersion(r.RowVersion));

    public async Task<IReadOnlyList<OnHoldReasonView>> ListViewsAsync(CancellationToken ct = default) =>
        [.. (await db.Set<OnHoldReason>().AsNoTracking().OrderBy(r => r.SortOrder).ThenBy(r => r.Id).ToListAsync(ct)).Select(ToView)];

    public async Task<IReadOnlyList<OnHoldReasonInfo>> ListAsync(bool includeInactive, CancellationToken cancellationToken = default) =>
        [.. (await db.Set<OnHoldReason>().AsNoTracking()
            .Where(r => includeInactive || r.IsActive)
            .OrderBy(r => r.SortOrder).ThenBy(r => r.Id)
            .ToListAsync(cancellationToken)).Select(r => new OnHoldReasonInfo(r.Id, r.Name, r.SortOrder, r.IsActive))];

    public async Task<OnHoldReasonInfo?> GetAsync(int onHoldReasonId, CancellationToken cancellationToken = default)
    {
        var r = await db.Set<OnHoldReason>().AsNoTracking().FirstOrDefaultAsync(x => x.Id == onHoldReasonId, cancellationToken);
        return r is null ? null : new OnHoldReasonInfo(r.Id, r.Name, r.SortOrder, r.IsActive);
    }

    public async Task<Result<OnHoldReasonView>> CreateAsync(CreateOnHoldReasonRequest request, CancellationToken ct = default)
    {
        var name = LookupSupport.CleanText(request.Name, "name", "Enter a name.", 100);
        if (name.IsFailure)
            return name.Error!;
        if (await NameExistsAsync(name.Value, null, ct))
            return Duplicate(name.Value);

        var max = await db.Set<OnHoldReason>().MaxAsync(r => (int?)r.SortOrder, ct) ?? 0;
        var reason = new OnHoldReason { Name = name.Value, IsActive = request.IsActive, SortOrder = max + 1 };
        db.Set<OnHoldReason>().Add(reason);
        var failure = await LookupSupport.SaveAsync(db, Duplicate(name.Value), null, ct);
        return failure is not null ? failure : ToView(reason);
    }

    public async Task<Result<OnHoldReasonView>> UpdateAsync(int id, UpdateOnHoldReasonRequest request, CancellationToken ct = default)
    {
        var version = LookupSupport.ParseRowVersion(request.RowVersion);
        if (version is null)
            return LookupErrors.InvalidRowVersion();
        var name = LookupSupport.CleanText(request.Name, "name", "Enter a name.", 100);
        if (name.IsFailure)
            return name.Error!;

        var reason = await db.Set<OnHoldReason>().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (reason is null)
            return Error.NotFound("On-hold reason not found.");
        if (!LookupSupport.VersionMatches(reason, version))
            return LookupErrors.Concurrency();
        if (await NameExistsAsync(name.Value, id, ct))
            return Duplicate(name.Value);

        reason.Name = name.Value;
        reason.IsActive = request.IsActive;
        LookupSupport.ExpectVersion(db, reason, version);
        var failure = await LookupSupport.SaveAsync(db, Duplicate(name.Value), null, ct);
        return failure is not null ? failure : ToView(reason);
    }

    public async Task<Result<IReadOnlyList<OnHoldReasonView>>> ReorderAsync(IReadOnlyList<int> ids, CancellationToken ct = default)
    {
        var all = await db.Set<OnHoldReason>().ToListAsync(ct);
        if (ids.Count != all.Count || ids.Distinct().Count() != ids.Count || !all.Select(r => r.Id).ToHashSet().SetEquals(ids))
            return Error.Validation("ids", "INVALID", "List every on-hold reason exactly once.");

        var byId = all.ToDictionary(r => r.Id);
        for (var i = 0; i < ids.Count; i++)
            byId[ids[i]].SortOrder = i + 1;

        var failure = await LookupSupport.SaveAsync(db, null, null, ct);
        return failure is not null ? failure : Result<IReadOnlyList<OnHoldReasonView>>.Success(await ListViewsAsync(ct));
    }

    private Task<bool> NameExistsAsync(string name, int? exceptId, CancellationToken ct) =>
        db.Set<OnHoldReason>().AnyAsync(r => r.Name == name && (exceptId == null || r.Id != exceptId), ct);

    private static Error Duplicate(string name) => LookupErrors.Duplicate("name", $"An on-hold reason named '{name}' exists.");
}
