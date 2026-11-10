using System.ComponentModel.DataAnnotations;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Lookups;

/// <summary>A Task-to-Asset link role.</summary>
/// <param name="Id">Role id.</param>
/// <param name="Name">Display name (Source, Destination, Subject, Result, ...).</param>
/// <param name="SortOrder">Position in pickers.</param>
/// <param name="IsActive">False = not offered for new links; existing links still show it.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64); send it back on update.</param>
/// <param name="LinkCount">
/// Task-asset links that use this role (#639), whichever Asset, counting only the links of Tasks the viewer may see (sensitive-matter rule). Null (not 0)
/// when the viewer lacks <c>Task.View</c> or <c>Asset.View</c>. The list and every create, update and reorder response carry it.
/// </param>
public sealed record AssetLinkRoleView(
    [property: Required] int Id,
    [property: Required] string Name,
    [property: Required] int SortOrder,
    [property: Required] bool IsActive,
    [property: Required] string RowVersion,
    int? LinkCount = null);

/// <summary>Body to create a link role (appended at the end).</summary>
public sealed record CreateAssetLinkRoleRequest([Required, StringLength(50)] string Name, bool IsActive = true);

/// <summary>Body to change a link role.</summary>
public sealed record UpdateAssetLinkRoleRequest(
    [Required, StringLength(50)] string Name,
    [Required] bool IsActive,
    [Required] string RowVersion);

/// <summary>Asset link roles: admin commands and the <see cref="IAssetLinkRoleCatalog"/> read side.</summary>
public sealed class AssetLinkRoleService(DbContext db, IEnumerable<IAssetLinkRoleUsage> usage, IPermissionChecker permissions) : IAssetLinkRoleCatalog
{
    private static AssetLinkRoleView ToView(AssetLinkRole r, int? linkCount = null) =>
        new(r.Id, r.Name, r.SortOrder, r.IsActive, LookupSupport.FormatRowVersion(r.RowVersion), linkCount);

    /// <summary>
    /// The link count of each role (one grouped statement per usage probe for the whole list), or null when the viewer may not see Tasks or
    /// Assets, so the responses carry null instead of a made-up 0. A role no link uses is 0.
    /// </summary>
    private async Task<Dictionary<int, int>?> LinkCountsAsync(IReadOnlyCollection<int> ids, CancellationToken ct)
    {
        if (!permissions.Has(Permissions.Task.View) || !permissions.Has(Permissions.Asset.View))
            return null;
        var counts = new Dictionary<int, int>();
        foreach (var probe in usage)
        {
            foreach (var (id, count) in await probe.CountLinksAsync(ids, ct))
                counts[id] = counts.GetValueOrDefault(id) + count;
        }

        return counts;
    }

    private async Task<AssetLinkRoleView> ToCountedViewAsync(AssetLinkRole r, CancellationToken ct)
    {
        var counts = await LinkCountsAsync([r.Id], ct);
        return ToView(r, counts is null ? null : counts.GetValueOrDefault(r.Id));
    }

    public async Task<IReadOnlyList<AssetLinkRoleView>> ListViewsAsync(CancellationToken ct = default)
    {
        var rows = await db.Set<AssetLinkRole>().AsNoTracking().OrderBy(r => r.SortOrder).ThenBy(r => r.Id).ToListAsync(ct);
        var counts = await LinkCountsAsync([.. rows.Select(r => r.Id)], ct);
        return [.. rows.Select(r => ToView(r, counts is null ? null : counts.GetValueOrDefault(r.Id)))];
    }

    public async Task<IReadOnlyList<AssetLinkRoleInfo>> ListAsync(bool includeInactive, CancellationToken cancellationToken = default) =>
        (await db.Set<AssetLinkRole>().AsNoTracking()
            .Where(r => includeInactive || r.IsActive)
            .OrderBy(r => r.SortOrder).ThenBy(r => r.Id)
            .ToListAsync(cancellationToken))
            .Select(r => new AssetLinkRoleInfo(r.Id, r.Name, r.SortOrder, r.IsActive))
            .ToList();

    public Task<bool> IsAssignableAsync(int assetLinkRoleId, CancellationToken cancellationToken = default) =>
        db.Set<AssetLinkRole>().AnyAsync(r => r.Id == assetLinkRoleId && r.IsActive, cancellationToken);

    public async Task<Result<AssetLinkRoleView>> CreateAsync(CreateAssetLinkRoleRequest request, CancellationToken ct = default)
    {
        var name = LookupSupport.CleanText(request.Name, "name", "Enter a name.");
        if (name.IsFailure)
            return name.Error!;
        if (await NameExistsAsync(name.Value, null, ct))
            return Duplicate(name.Value);

        var max = await db.Set<AssetLinkRole>().MaxAsync(r => (int?)r.SortOrder, ct) ?? 0;
        var role = new AssetLinkRole { Name = name.Value, IsActive = request.IsActive, SortOrder = max + 1 };
        db.Set<AssetLinkRole>().Add(role);
        var failure = await LookupSupport.SaveAsync(db, Duplicate(name.Value), null, ct);
        return failure is not null ? failure : await ToCountedViewAsync(role, ct);
    }

    public async Task<Result<AssetLinkRoleView>> UpdateAsync(int id, UpdateAssetLinkRoleRequest request, CancellationToken ct = default)
    {
        var version = LookupSupport.ParseRowVersion(request.RowVersion);
        if (version is null)
            return LookupErrors.InvalidRowVersion();
        var name = LookupSupport.CleanText(request.Name, "name", "Enter a name.");
        if (name.IsFailure)
            return name.Error!;

        var role = await db.Set<AssetLinkRole>().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (role is null)
            return Error.NotFound("Link role not found.");
        if (!LookupSupport.VersionMatches(role, version))
            return LookupErrors.Concurrency();
        if (await NameExistsAsync(name.Value, id, ct))
            return Duplicate(name.Value);

        role.Name = name.Value;
        role.IsActive = request.IsActive;
        LookupSupport.ExpectVersion(db, role, version);
        var failure = await LookupSupport.SaveAsync(db, Duplicate(name.Value), null, ct);
        return failure is not null ? failure : await ToCountedViewAsync(role, ct);
    }

    public async Task<Result<IReadOnlyList<AssetLinkRoleView>>> ReorderAsync(IReadOnlyList<int> ids, CancellationToken ct = default)
    {
        var all = await db.Set<AssetLinkRole>().ToListAsync(ct);
        if (ids.Count != all.Count || ids.Distinct().Count() != ids.Count || !all.Select(r => r.Id).ToHashSet().SetEquals(ids))
            return Error.Validation("ids", "INVALID", "List every link role exactly once.");

        var byId = all.ToDictionary(r => r.Id);
        for (var i = 0; i < ids.Count; i++)
            byId[ids[i]].SortOrder = i + 1;

        var failure = await LookupSupport.SaveAsync(db, null, null, ct);
        return failure is not null ? failure : Result<IReadOnlyList<AssetLinkRoleView>>.Success(await ListViewsAsync(ct));
    }

    /// <summary>Deletes an unused link role. One that links reference can only be deactivated.</summary>
    public async Task<Result> DeleteAsync(int id, CancellationToken ct = default)
    {
        var role = await db.Set<AssetLinkRole>().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (role is null)
            return Error.NotFound("Link role not found.");

        var inUse = LookupErrors.InUse("Asset links use this role, so it cannot be deleted. Deactivate it instead.");
        foreach (var probe in usage)
        {
            if (await probe.IsInUseAsync(id, ct))
                return inUse;
        }

        db.Set<AssetLinkRole>().Remove(role);
        var failure = await LookupSupport.SaveAsync(db, null, inUse, ct);
        return failure is not null ? failure : Result.Success();
    }

    private Task<bool> NameExistsAsync(string name, int? exceptId, CancellationToken ct) =>
        db.Set<AssetLinkRole>().AnyAsync(r => r.Name == name && (exceptId == null || r.Id != exceptId), ct);

    private static Error Duplicate(string name) => LookupErrors.Duplicate("name", $"A link role named '{name}' exists.");
}
