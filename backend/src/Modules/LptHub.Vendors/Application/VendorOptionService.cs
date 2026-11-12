using LptHub.SharedKernel.Results;
using LptHub.Vendors.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Vendors.Application;

/// <summary>
/// Admin commands and reads for one vendor pick list (Services or Areas): the two lists share every rule. Changes are audited by the generic interceptor.
/// An item that vendors use is deactivated; only an item nobody uses (In Use 0) can be deleted (409 <c>IN_USE</c> otherwise).
/// </summary>
/// <typeparam name="T">The list's entity.</typeparam>
public sealed class VendorOptionService<T>(DbContext db, string itemLabel, Func<CancellationToken, Task<IReadOnlyDictionary<int, int>>> usage)
    where T : VendorOption, new()
{
    private const int MaxName = 100;

    private static VendorOptionView ToView(T r, int inUse) => new(r.Id, r.Name, r.SortOrder, r.IsActive, VendorSupport.Encode(r.RowVersion), inUse);

    public async Task<IReadOnlyList<VendorOptionView>> ListAsync(CancellationToken ct = default)
    {
        var counts = await usage(ct);
        var rows = await db.Set<T>().AsNoTracking().OrderBy(r => r.SortOrder).ThenBy(r => r.Id).ToListAsync(ct);
        return [.. rows.Select(r => ToView(r, counts.GetValueOrDefault(r.Id)))];
    }

    public async Task<Result<VendorOptionView>> CreateAsync(CreateVendorOptionRequest request, CancellationToken ct = default)
    {
        var name = CleanName(request.Name);
        if (name.IsFailure)
            return name.Error!;
        if (await NameExistsAsync(name.Value, null, ct))
            return Duplicate(name.Value);

        var max = await db.Set<T>().MaxAsync(r => (int?)r.SortOrder, ct) ?? 0;
        var item = new T { Name = name.Value, IsActive = request.IsActive, SortOrder = max + 1 };
        db.Set<T>().Add(item);
        var failure = await SaveAsync(Duplicate(name.Value), null, ct);
        return failure is not null ? failure : ToView(item, 0);
    }

    public async Task<Result<VendorOptionView>> UpdateAsync(int id, UpdateVendorOptionRequest request, CancellationToken ct = default)
    {
        var name = CleanName(request.Name);
        if (name.IsFailure)
            return name.Error!;

        var item = await db.Set<T>().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (item is null)
            return VendorSupport.NotFound(itemLabel);

        var version = VendorSupport.CheckRowVersion(item.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (await NameExistsAsync(name.Value, id, ct))
            return Duplicate(name.Value);

        item.Name = name.Value;
        item.IsActive = request.IsActive;
        VendorSupport.TrackOriginalRowVersion(db, item, request.RowVersion);
        var failure = await SaveAsync(Duplicate(name.Value), null, ct);
        return failure is not null ? failure : ToView(item, (await usage(ct)).GetValueOrDefault(id));
    }

    public async Task<Result<IReadOnlyList<VendorOptionView>>> ReorderAsync(IReadOnlyList<int> ids, CancellationToken ct = default)
    {
        var all = await db.Set<T>().ToListAsync(ct);
        if (ids.Count != all.Count || ids.Distinct().Count() != ids.Count || !all.Select(r => r.Id).ToHashSet().SetEquals(ids))
            return Error.Validation("ids", "INVALID", "List every item exactly once.");

        var byId = all.ToDictionary(r => r.Id);
        for (var i = 0; i < ids.Count; i++)
            byId[ids[i]].SortOrder = i + 1;

        var failure = await SaveAsync(null, null, ct);
        return failure is not null ? failure : Result<IReadOnlyList<VendorOptionView>>.Success(await ListAsync(ct));
    }

    /// <summary>Deletes an item nobody uses. 409 <c>IN_USE</c> when vendors carry it: deactivate it instead.</summary>
    public async Task<Result> DeleteAsync(int id, CancellationToken ct = default)
    {
        var item = await db.Set<T>().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (item is null)
            return VendorSupport.NotFound(itemLabel);

        var inUse = Error.Conflict(ErrorCodes.InUse, "This item is in use. Deactivate it instead of deleting it.");
        if ((await usage(ct)).GetValueOrDefault(id) > 0)
            return inUse;

        db.Set<T>().Remove(item);
        var failure = await SaveAsync(null, inUse, ct);
        return failure is not null ? failure : Result.Success();
    }

    private static Result<string> CleanName(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
            return Error.Validation("name", "REQUIRED", "Enter a name.");
        if (text.Length > MaxName)
            return Error.Validation("name", "TOO_LONG", $"Use at most {MaxName} characters.");
        return text;
    }

    private Task<bool> NameExistsAsync(string name, int? exceptId, CancellationToken ct) =>
        db.Set<T>().AnyAsync(r => r.Name == name && (exceptId == null || r.Id != exceptId), ct);

    private Error Duplicate(string name) => VendorSupport.Duplicate("name", $"{itemLabel} '{name}' already exists.");

    private async Task<Error?> SaveAsync(Error? duplicate, Error? inUse, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            return VendorSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (duplicate is not null && VendorSupport.IsUniqueViolation(ex))
        {
            return duplicate;
        }
        catch (DbUpdateException ex) when (inUse is not null && VendorSupport.IsForeignKeyViolation(ex))
        {
            return inUse;
        }
    }
}
