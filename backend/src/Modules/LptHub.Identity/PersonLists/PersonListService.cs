using System.ComponentModel.DataAnnotations;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Entities;
using LptHub.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Identity.PersonLists;

/// <summary>An item of an admin list of a person (Office or Employment Status) for the admin screen and the pickers.</summary>
/// <param name="Id">Item id.</param>
/// <param name="Name">Display name (unique within the list, case-insensitive).</param>
/// <param name="SortOrder">Position in pickers.</param>
/// <param name="IsActive">False = not offered for new choices; people that already use it, and history, keep showing it.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64); send it back on update.</param>
/// <param name="InUseCount">People that carry the item. Only an item with 0 can be deleted.</param>
public sealed record PersonListItemView(
    [property: Required] int Id,
    [property: Required] string Name,
    [property: Required] int SortOrder,
    [property: Required] bool IsActive,
    [property: Required] string RowVersion,
    [property: Required] int InUseCount);

/// <summary>Body to add an item to an admin list of a person (appended at the end).</summary>
public sealed record CreatePersonListItemRequest([Required, StringLength(100)] string Name, bool IsActive = true);

/// <summary>Body to rename, activate or deactivate an item of an admin list of a person.</summary>
public sealed record UpdatePersonListItemRequest(
    [Required, StringLength(100)] string Name,
    [Required] bool IsActive,
    [Required] string RowVersion);

/// <summary>
/// Admin commands and reads for one admin list of a person (Office, Employment Status; epic #1389, issue #1394): same rules as the matter pick lists. Changes
/// are audited by the generic interceptor. A used item is deactivated; only an item nobody uses (In Use 0) can be deleted (409 <c>IN_USE</c> otherwise).
/// </summary>
/// <typeparam name="T">The list's entity.</typeparam>
public sealed class PersonListService<T>(DbContext db, string itemLabel, System.Linq.Expressions.Expression<Func<Person, int?>> itemOf)
    where T : PersonListEntity, new()
{
    private const int MaxName = 100;
    private const int SqlDuplicateKey = 2601;
    private const int SqlUniqueConstraint = 2627;
    private const int SqlForeignKey = 547;

    private static PersonListItemView ToView(T r, int inUse) => new(r.Id, r.Name, r.SortOrder, r.IsActive, Convert.ToBase64String(r.RowVersion), inUse);

    /// <summary>Item id to the number of people that carry it; items nobody uses are absent.</summary>
    private async Task<Dictionary<int, int>> CountsAsync(CancellationToken ct) =>
        (await db.Set<Person>().AsNoTracking().Select(itemOf).Where(id => id != null).GroupBy(id => id!.Value)
            .Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(ct))
        .ToDictionary(r => r.Id, r => r.Count);

    public async Task<IReadOnlyList<PersonListItemView>> ListViewsAsync(CancellationToken ct = default)
    {
        var counts = await CountsAsync(ct);
        return [.. (await db.Set<T>().AsNoTracking().OrderBy(r => r.SortOrder).ThenBy(r => r.Id).ToListAsync(ct)).Select(r => ToView(r, counts.GetValueOrDefault(r.Id)))];
    }

    public async Task<Result> DeleteAsync(int id, CancellationToken ct = default)
    {
        var item = await db.Set<T>().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (item is null)
            return Error.NotFound($"{itemLabel} not found.");

        var inUse = Error.Conflict(ErrorCodes.InUse, "This item is in use. Deactivate it instead of deleting it.");
        if ((await CountsAsync(ct)).GetValueOrDefault(id) > 0)
            return inUse;

        db.Set<T>().Remove(item);
        var failure = await SaveAsync(null, inUse, ct);
        return failure is not null ? failure : Result.Success();
    }

    public async Task<Result<PersonListItemView>> CreateAsync(CreatePersonListItemRequest request, CancellationToken ct = default)
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

    public async Task<Result<PersonListItemView>> UpdateAsync(int id, UpdatePersonListItemRequest request, CancellationToken ct = default)
    {
        var version = ParseRowVersion(request.RowVersion);
        if (version is null)
            return Error.Validation("rowVersion", "INVALID", "The row version is not valid.");
        var name = CleanName(request.Name);
        if (name.IsFailure)
            return name.Error!;

        var item = await db.Set<T>().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (item is null)
            return Error.NotFound($"{itemLabel} not found.");
        if (!item.RowVersion.AsSpan().SequenceEqual(version))
            return Concurrency();
        if (await NameExistsAsync(name.Value, id, ct))
            return Duplicate(name.Value);

        item.Name = name.Value;
        item.IsActive = request.IsActive;
        db.Entry(item).Property(nameof(IAuditStamped.RowVersion)).OriginalValue = version;
        var failure = await SaveAsync(Duplicate(name.Value), null, ct);
        return failure is not null ? failure : ToView(item, (await CountsAsync(ct)).GetValueOrDefault(id));
    }

    public async Task<Result<IReadOnlyList<PersonListItemView>>> ReorderAsync(IReadOnlyList<int> ids, CancellationToken ct = default)
    {
        var all = await db.Set<T>().ToListAsync(ct);
        if (ids.Count != all.Count || ids.Distinct().Count() != ids.Count || !all.Select(r => r.Id).ToHashSet().SetEquals(ids))
            return Error.Validation("ids", "INVALID", "List every item exactly once.");

        var byId = all.ToDictionary(r => r.Id);
        for (var i = 0; i < ids.Count; i++)
            byId[ids[i]].SortOrder = i + 1;

        var failure = await SaveAsync(null, null, ct);
        return failure is not null ? failure : Result<IReadOnlyList<PersonListItemView>>.Success(await ListViewsAsync(ct));
    }

    private Result<string> CleanName(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
            return Error.Validation("name", "REQUIRED", "Enter a name.");
        if (text.Length > MaxName)
            return Error.Validation("name", "TOO_LONG", $"Use at most {MaxName} characters.");
        return text;
    }

    private static byte[]? ParseRowVersion(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return null;
        try
        {
            var bytes = Convert.FromBase64String(value);
            return bytes.Length == 8 ? bytes : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private Task<bool> NameExistsAsync(string name, int? exceptId, CancellationToken ct) =>
        db.Set<T>().AnyAsync(r => r.Name == name && (exceptId == null || r.Id != exceptId), ct);

    private Error Duplicate(string name) =>
        new(
            ErrorType.Conflict,
            ErrorCodes.DuplicateName,
            $"{itemLabel} '{name}' already exists.",
            new Dictionary<string, IReadOnlyList<FieldError>> { ["name"] = [new FieldError("DUPLICATE", $"{itemLabel} '{name}' already exists.")] });

    private static Error Concurrency() => Error.Conflict(ErrorCodes.ConcurrencyConflict, "Someone else changed this item. Reload and try again.");

    private async Task<Error?> SaveAsync(Error? duplicate, Error? inUse, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            return Concurrency();
        }
        catch (DbUpdateException ex) when (duplicate is not null && ex.GetBaseException() is SqlException { Number: SqlDuplicateKey or SqlUniqueConstraint })
        {
            return duplicate;
        }
        catch (DbUpdateException ex) when (inUse is not null && ex.GetBaseException() is SqlException { Number: SqlForeignKey })
        {
            return inUse;
        }
    }
}

/// <summary>Body to set the order of an admin list of a person: every item id exactly once, in the new order.</summary>
public sealed record ReorderPersonListRequest([Required] IReadOnlyList<int> Ids);
