using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Assets.Application;

/// <summary>Asset Type administration. Creating a type also creates its (empty, unpublished) field form definition.</summary>
public sealed class AssetTypeService(DbContext db, IFormDefinitionResolver forms, IPermissionChecker permissions)
{
    public static readonly string[] SortFields = ["sortOrder", "name", "createdAt"];

    private static readonly Dictionary<string, Func<IQueryable<AssetType>, bool, bool, IOrderedQueryable<AssetType>>> Orderings = new()
    {
        ["sortOrder"] = AssetSupport.By<AssetType, int>(t => t.SortOrder),
        ["name"] = AssetSupport.By<AssetType, string>(t => t.Name),
        ["createdAt"] = AssetSupport.By<AssetType, DateTime>(t => t.CreatedAtUtc),
    };

    public async Task<Result<PagedResult<AssetTypeResponse>>> ListAsync(AssetTypeListQuery query, CancellationToken ct)
    {
        var paging = AssetSupport.PagingOf(query, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        var (page, sort) = paging.Value;
        var types = db.Set<AssetType>().AsNoTracking();
        if (query.IsActive is { } active)
            types = types.Where(t => t.IsActive == active);

        var q = query.Q?.Trim();
        if (!string.IsNullOrEmpty(q))
            types = types.Where(t => t.Name.Contains(q));
        if (query.Name?.Trim() is { Length: > 0 } name)
            types = types.Where(t => t.Name.Contains(name));

        var total = await types.CountAsync(ct);
        var ordered = AssetSupport.ApplySort(types, sort.Count == 0 ? [new SortField("sortOrder", false), new SortField("name", false)] : sort, Orderings, t => t.Id);
        var items = await ordered.Skip(page.Skip).Take(page.PageSize).ToListAsync(ct);

        // Asset counts (only for a viewer who may see Assets) and the form summaries: one grouped statement each, however many types are on the page.
        var ids = items.Select(t => t.Id).ToList();
        var counts = await AssetCountsAsync(ids, ct);
        var summaries = (await forms.GetOwnerSummariesAsync(FormOwnerKind.AssetType, ids, ct)).ToDictionary(x => x.OwnerId!.Value);

        var responses = items
            .Select(type => ToResponse(type, counts?.GetValueOrDefault(type.Id), summaries.GetValueOrDefault(type.Id)))
            .ToList();

        return AssetSupport.Page(responses, total, page);
    }

    public async Task<Result<AssetTypeResponse>> GetAsync(int id, CancellationToken ct)
    {
        var type = await db.Set<AssetType>().AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, ct);
        if (type is null)
            return AssetSupport.NotFound("Asset type");

        var counts = await AssetCountsAsync([id], ct);
        var summary = (await forms.GetOwnerSummariesAsync(FormOwnerKind.AssetType, [id], ct)).FirstOrDefault();
        return ToResponse(type, counts?.GetValueOrDefault(id), summary);
    }

    public async Task<Result<AssetTypeResponse>> CreateAsync(CreateAssetTypeRequest request, CancellationToken ct)
    {
        var name = request.Name.Trim();
        if (name.Length == 0)
            return Error.Validation("name", "REQUIRED", "Enter a name.");

        var existing = await FindIdByNameAsync(name, null, ct);
        if (existing is not null)
            return DuplicateName(name, existing);

        var sortOrder = request.SortOrder
            ?? (await db.Set<AssetType>().MaxAsync(t => (int?)t.SortOrder, ct) ?? 0) + 10;
        var type = new AssetType { Name = name, Description = AssetSupport.Clean(request.Description), SortOrder = sortOrder };
        db.Set<AssetType>().Add(type);

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        try
        {
            await db.SaveChangesAsync(ct);
            var definition = await forms.EnsureDefinitionAsync(FormOwnerKind.AssetType, type.Id, ct);
            if (definition.IsFailure)
                return definition.Error!;

            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (AssetSupport.IsUniqueViolation(ex, AssetSupport.AssetTypeNameUnique))
        {
            db.ChangeTracker.Clear();
            return DuplicateName(name, await FindIdByNameAsync(name, null, ct));
        }

        return await GetAsync(type.Id, ct);
    }

    public async Task<Result<AssetTypeResponse>> UpdateAsync(int id, UpdateAssetTypeRequest request, CancellationToken ct)
    {
        var type = await db.Set<AssetType>().SingleOrDefaultAsync(t => t.Id == id, ct);
        if (type is null)
            return AssetSupport.NotFound("Asset type");

        var version = AssetSupport.CheckRowVersion(type.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var name = request.Name.Trim();
        if (name.Length == 0)
            return Error.Validation("name", "REQUIRED", "Enter a name.");

        if (!string.Equals(name, type.Name, StringComparison.OrdinalIgnoreCase))
        {
            var existing = await FindIdByNameAsync(name, id, ct);
            if (existing is not null)
                return DuplicateName(name, existing);
        }

        type.Name = name;
        type.Description = AssetSupport.Clean(request.Description);
        type.SortOrder = request.SortOrder;
        type.IsActive = request.IsActive;
        AssetSupport.TrackOriginalRowVersion(db, type, request.RowVersion);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return AssetSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (AssetSupport.IsUniqueViolation(ex, AssetSupport.AssetTypeNameUnique))
        {
            db.ChangeTracker.Clear();
            return DuplicateName(name, await FindIdByNameAsync(name, id, ct));
        }

        return await GetAsync(id, ct);
    }

    /// <summary>The Asset count of each type (one grouped statement), or null when the viewer may not see Assets, so the responses carry null instead of a made-up 0.</summary>
    private async Task<Dictionary<int, int>?> AssetCountsAsync(IReadOnlyCollection<int> typeIds, CancellationToken ct)
    {
        if (!permissions.Has(Permissions.Asset.View))
            return null;

        return await db.Set<Asset>().AsNoTracking()
            .Where(a => typeIds.Contains(a.AssetTypeId))
            .GroupBy(a => a.AssetTypeId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
    }

    private static AssetTypeResponse ToResponse(AssetType type, int? assetCount, FormOwnerSummary? form) =>
        new(
            type.Id,
            type.Name,
            type.Description,
            type.SortOrder,
            type.IsActive,
            assetCount,
            form?.PublishedVersionNo is null ? null : form.PublishedVersionId,
            form?.PublishedVersionNo,
            AssetSupport.Encode(type.RowVersion),
            AssetSupport.Utc(type.CreatedAtUtc),
            AssetSupport.Utc(type.ModifiedAtUtc),
            form?.PublishedVersionNo is null ? null : form.PublishedFieldCount,
            AssetSupport.Utc(form?.PublishedAtUtc),
            form?.DraftVersionNo);

    private async Task<int?> FindIdByNameAsync(string name, int? exceptId, CancellationToken ct) =>
        await db.Set<AssetType>().AsNoTracking()
            .Where(t => t.Name == name && (exceptId == null || t.Id != exceptId))
            .Select(t => (int?)t.Id)
            .FirstOrDefaultAsync(ct);

    private static Error DuplicateName(string name, int? existingId) =>
        AssetSupport.Duplicate("name", $"An asset type named '{name}' already exists.", existingId);
}
