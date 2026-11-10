using System.ComponentModel.DataAnnotations;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Lookups;

/// <summary>An item of a matter pick list (Matter Type, Current State or Team Title) for the admin screens and the pickers.</summary>
/// <param name="Id">Item id.</param>
/// <param name="Name">Display name (unique within the list, case-insensitive).</param>
/// <param name="SortOrder">Position in pickers.</param>
/// <param name="IsActive">False = not offered for new choices; matters and team rows that already use it, and history, keep showing it.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64); send it back on update.</param>
/// <param name="InUseCount">Matters that carry the item (Matter Type, Current State) or team members that carry it (Team Title). Only an item with 0 can be deleted.</param>
public sealed record MatterListItemView(
    [property: Required] int Id,
    [property: Required] string Name,
    [property: Required] int SortOrder,
    [property: Required] bool IsActive,
    [property: Required] string RowVersion,
    [property: Required] int InUseCount);

/// <summary>Body to add an item to a matter pick list (appended at the end).</summary>
public sealed record CreateMatterListItemRequest([Required, StringLength(100)] string Name, bool IsActive = true);

/// <summary>Body to rename, activate or deactivate an item of a matter pick list.</summary>
public sealed record UpdateMatterListItemRequest(
    [Required, StringLength(100)] string Name,
    [Required] bool IsActive,
    [Required] string RowVersion);

/// <summary>
/// Admin commands and reads for one matter pick list (epic #1298): the three lists share every rule. Changes are audited by the generic interceptor.
/// A used item is deactivated; only an item nobody uses (In Use 0) can be deleted (409 <c>IN_USE</c> otherwise).
/// </summary>
/// <typeparam name="T">The list's entity.</typeparam>
public sealed class MatterListService<T>(DbContext db, string itemLabel, MatterListKind kind, IMatterListUsage usage)
    where T : MatterListEntity, new()
{
    private const int MaxName = 100;

    private static MatterListItemView ToView(T r, int inUse) => new(r.Id, r.Name, r.SortOrder, r.IsActive, LookupSupport.FormatRowVersion(r.RowVersion), inUse);

    private async Task<int> InUseAsync(int id, CancellationToken ct) => (await usage.CountsAsync(kind, ct)).GetValueOrDefault(id);

    public async Task<IReadOnlyList<MatterListItemView>> ListViewsAsync(CancellationToken ct = default)
    {
        var counts = await usage.CountsAsync(kind, ct);
        return [.. (await db.Set<T>().AsNoTracking().OrderBy(r => r.SortOrder).ThenBy(r => r.Id).ToListAsync(ct)).Select(r => ToView(r, counts.GetValueOrDefault(r.Id)))];
    }

    /// <summary>Deletes an item nobody uses. 409 <c>IN_USE</c> when matters or team members carry it: deactivate it instead.</summary>
    public async Task<Result> DeleteAsync(int id, CancellationToken ct = default)
    {
        var item = await db.Set<T>().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (item is null)
            return Error.NotFound($"{itemLabel} not found.");

        var inUse = LookupErrors.InUse("This item is in use. Deactivate it instead of deleting it.");
        if (await InUseAsync(id, ct) > 0)
            return inUse;

        db.Set<T>().Remove(item);
        var failure = await LookupSupport.SaveAsync(db, null, inUse, ct);
        return failure is not null ? failure : Result.Success();
    }

    public async Task<Result<MatterListItemView>> CreateAsync(CreateMatterListItemRequest request, CancellationToken ct = default)
    {
        var name = LookupSupport.CleanText(request.Name, "name", "Enter a name.", MaxName);
        if (name.IsFailure)
            return name.Error!;
        if (await NameExistsAsync(name.Value, null, ct))
            return Duplicate(name.Value);

        var max = await db.Set<T>().MaxAsync(r => (int?)r.SortOrder, ct) ?? 0;
        var item = new T { Name = name.Value, IsActive = request.IsActive, SortOrder = max + 1 };
        db.Set<T>().Add(item);
        var failure = await LookupSupport.SaveAsync(db, Duplicate(name.Value), null, ct);
        return failure is not null ? failure : ToView(item, 0);
    }

    public async Task<Result<MatterListItemView>> UpdateAsync(int id, UpdateMatterListItemRequest request, CancellationToken ct = default)
    {
        var version = LookupSupport.ParseRowVersion(request.RowVersion);
        if (version is null)
            return LookupErrors.InvalidRowVersion();
        var name = LookupSupport.CleanText(request.Name, "name", "Enter a name.", MaxName);
        if (name.IsFailure)
            return name.Error!;

        var item = await db.Set<T>().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (item is null)
            return Error.NotFound($"{itemLabel} not found.");
        if (!LookupSupport.VersionMatches(item, version))
            return LookupErrors.Concurrency();
        if (await NameExistsAsync(name.Value, id, ct))
            return Duplicate(name.Value);

        item.Name = name.Value;
        item.IsActive = request.IsActive;
        LookupSupport.ExpectVersion(db, item, version);
        var failure = await LookupSupport.SaveAsync(db, Duplicate(name.Value), null, ct);
        return failure is not null ? failure : ToView(item, await InUseAsync(id, ct));
    }

    public async Task<Result<IReadOnlyList<MatterListItemView>>> ReorderAsync(IReadOnlyList<int> ids, CancellationToken ct = default)
    {
        var all = await db.Set<T>().ToListAsync(ct);
        if (ids.Count != all.Count || ids.Distinct().Count() != ids.Count || !all.Select(r => r.Id).ToHashSet().SetEquals(ids))
            return Error.Validation("ids", "INVALID", "List every item exactly once.");

        var byId = all.ToDictionary(r => r.Id);
        for (var i = 0; i < ids.Count; i++)
            byId[ids[i]].SortOrder = i + 1;

        var failure = await LookupSupport.SaveAsync(db, null, null, ct);
        return failure is not null ? failure : Result<IReadOnlyList<MatterListItemView>>.Success(await ListViewsAsync(ct));
    }

    private Task<bool> NameExistsAsync(string name, int? exceptId, CancellationToken ct) =>
        db.Set<T>().AnyAsync(r => r.Name == name && (exceptId == null || r.Id != exceptId), ct);

    private Error Duplicate(string name) => LookupErrors.Duplicate("name", $"{itemLabel} '{name}' already exists.");
}

/// <summary>The <see cref="IMatterListCatalog"/> read side over the three lists.</summary>
public sealed class MatterListCatalog(DbContext db) : IMatterListCatalog
{
    public Task<IReadOnlyList<MatterListItemInfo>> ListAsync(MatterListKind kind, bool includeInactive, CancellationToken cancellationToken = default) => kind switch
    {
        MatterListKind.MatterType => ReadAsync<MatterType>(includeInactive, cancellationToken),
        MatterListKind.CurrentState => ReadAsync<CurrentState>(includeInactive, cancellationToken),
        MatterListKind.TeamTitle => ReadAsync<TeamTitle>(includeInactive, cancellationToken),
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    public IQueryable<MatterListItemKey> Keys(MatterListKind kind) => kind switch
    {
        MatterListKind.MatterType => KeysOf<MatterType>(),
        MatterListKind.CurrentState => KeysOf<CurrentState>(),
        MatterListKind.TeamTitle => KeysOf<TeamTitle>(),
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    private IQueryable<MatterListItemKey> KeysOf<T>()
        where T : MatterListEntity =>
        db.Set<T>().AsNoTracking().Select(r => new MatterListItemKey { Id = r.Id, Name = r.Name, SortOrder = r.SortOrder });

    private async Task<IReadOnlyList<MatterListItemInfo>> ReadAsync<T>(bool includeInactive, CancellationToken ct)
        where T : MatterListEntity =>
        [.. (await db.Set<T>().AsNoTracking()
            .Where(r => includeInactive || r.IsActive)
            .OrderBy(r => r.SortOrder).ThenBy(r => r.Id)
            .ToListAsync(ct)).Select(r => new MatterListItemInfo(r.Id, r.Name, r.SortOrder, r.IsActive))];
}

/// <summary>Default <see cref="IMatterListUsage"/> until the Organization module registers the real one: nothing is in use.</summary>
public sealed class NoMatterListUsage : IMatterListUsage
{
    public Task<IReadOnlyDictionary<int, int>> CountsAsync(MatterListKind kind, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, int>>(new Dictionary<int, int>());
}
