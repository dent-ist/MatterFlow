using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Assets.Application;

/// <summary>Asset Type administration. Creating a type also creates its (empty, unpublished) field form definition.</summary>
public sealed class AssetTypeService(
    DbContext db,
    IFormDefinitionResolver forms,
    IPermissionChecker permissions,
    AssetAccess access,
    IFormFieldCatalog fields,
    IFormIndexMaintenance indexMaintenance,
    IMatterVisibility visibility,
    IMatterDirectory matters)
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

        var longest = await LongestCmNumberAsync(ct);
        var responses = new List<AssetTypeResponse>(items.Count);
        foreach (var type in items)
            responses.Add(ToResponse(type, counts is null ? null : counts.GetValueOrDefault(type.Id), summaries.GetValueOrDefault(type.Id), await ExampleAsync(type, longest, ct)));

        return AssetSupport.Page(responses, total, page);
    }

    public async Task<Result<AssetTypeResponse>> GetAsync(int id, CancellationToken ct)
    {
        var type = await db.Set<AssetType>().AsNoTracking().SingleOrDefaultAsync(t => t.Id == id, ct);
        if (type is null)
            return AssetSupport.NotFound("Asset type");

        var counts = await AssetCountsAsync([id], ct);
        var summary = (await forms.GetOwnerSummariesAsync(FormOwnerKind.AssetType, [id], ct)).FirstOrDefault();
        return ToResponse(type, counts is null ? null : counts.GetValueOrDefault(id), summary, await ExampleAsync(type, await LongestCmNumberAsync(ct), ct));
    }

    public async Task<Result<AssetTypeResponse>> CreateAsync(CreateAssetTypeRequest request, CancellationToken ct)
    {
        var name = request.Name.Trim();
        if (name.Length == 0)
            return Error.Validation("name", "REQUIRED", "Enter a name.");

        var existing = await FindIdByNameAsync(name, null, ct);
        if (existing is not null)
            return DuplicateName(name, existing);

        var look = CheckLook(request.IconKey, request.ColourKey);
        if (look.IsFailure)
            return look.Error!;

        var numbering = CheckNumbering(request.Numbering, current: null);
        if (numbering.IsFailure)
            return numbering.Error!;

        var sortOrder = request.SortOrder
            ?? (await db.Set<AssetType>().MaxAsync(t => (int?)t.SortOrder, ct) ?? 0) + 10;
        var type = new AssetType { Name = name, Description = AssetSupport.Clean(request.Description), SortOrder = sortOrder, IconKey = Blank(request.IconKey), ColourKey = Blank(request.ColourKey) };
        ApplyNumbering(type, numbering.Value);
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

        var look = CheckLook(request.IconKey, request.ColourKey);
        if (look.IsFailure)
            return look.Error!;

        var numbering = CheckNumbering(request.Numbering, current: type);
        if (numbering.IsFailure)
            return numbering.Error!;

        type.Name = name;
        type.IconKey = Blank(request.IconKey);
        type.ColourKey = Blank(request.ColourKey);
        type.Description = AssetSupport.Clean(request.Description);
        type.SortOrder = request.SortOrder;
        type.IsActive = request.IsActive;
        ApplyNumbering(type, numbering.Value);
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

    /// <summary>
    /// Designates (or clears) the default size field and unit of an Asset Type. The key must be a NUMBER field of the published form; no stored value is
    /// rewritten. The change is audited like any other field of the type.
    /// </summary>
    public async Task<Result<AssetTypeResponse>> SetSizeFieldAsync(int id, SetAssetTypeSizeFieldRequest request, CancellationToken ct)
    {
        var type = await db.Set<AssetType>().SingleOrDefaultAsync(t => t.Id == id, ct);
        if (type is null)
            return AssetSupport.NotFound("Asset type");

        var version = AssetSupport.CheckRowVersion(type.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var key = AssetSupport.Clean(request.SizeFieldKey);
        var unit = AssetSupport.Clean(request.SizeUnit);
        if (key is null != unit is null)
            return Error.Validation(key is null ? "sizeFieldKey" : "sizeUnit", "REQUIRED", "Choose the size field and the unit together, or neither.");

        if (key is not null)
        {
            if (!AssetSize.IsKnownUnit(unit))
                return Error.Validation("sizeUnit", "INVALID", $"The unit must be one of {string.Join(", ", AssetSize.Units)}.");

            var published = await fields.GetPublishedFieldsAsync(FormOwnerKind.AssetType, id, ct);
            if (!published.Any(f => f.IsNumber && string.Equals(f.Key, key, StringComparison.Ordinal)))
                return Error.Validation("sizeFieldKey", "INVALID", "The size field must be a number field of the published form of this asset type.");
        }

        type.SizeFieldKey = key;
        type.SizeUnit = unit;
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

        return await GetAsync(id, ct);
    }

    /// <summary>Rebuilds the filter index of every asset of the type from its stored values (idempotent; safe to repeat).</summary>
    public async Task<Result<AssetTypeReindexResponse>> ReindexAsync(int id, CancellationToken ct)
    {
        if (!await db.Set<AssetType>().AsNoTracking().AnyAsync(t => t.Id == id, ct))
            return AssetSupport.NotFound("Asset type");

        var definitionId = await forms.FindDefinitionIdAsync(FormOwnerKind.AssetType, id, ct);
        var processed = definitionId is { } definition ? await indexMaintenance.ReindexAsync(FormValueOwnerKind.Asset, definition, ct) : 0;
        return new AssetTypeReindexResponse(processed);
    }

    /// <summary>The Asset count of each type (one grouped statement), or null when the viewer may not see Assets, so the responses carry null instead of a made-up 0.</summary>
    private async Task<Dictionary<int, (int Total, int Numbered)>?> AssetCountsAsync(IReadOnlyCollection<int> typeIds, CancellationToken ct)
    {
        if (!permissions.Has(Permissions.Asset.View))
            return null;

        await access.PrepareAsync(ct);
        return await access.Visible(db.Set<Asset>().AsNoTracking())
            .Where(a => typeIds.Contains(a.AssetTypeId))
            .GroupBy(a => a.AssetTypeId)
            .Select(g => new { g.Key, Count = g.Count(), Numbered = g.Count(a => a.AssetNumber != null) })
            .ToDictionaryAsync(x => x.Key, x => (x.Count, x.Numbered), ct);
    }

    /// <summary>The longest CM Number among the matters the caller may see (so a screen can check the 100-character limit); null when there is none.</summary>
    private async Task<string?> LongestCmNumberAsync(CancellationToken ct) =>
        await visibility.WhereMatterVisible(matters.SortKeys(), m => m.MatterId)
            .OrderByDescending(m => m.MatterRef.Length)
            .ThenBy(m => m.MatterRef)
            .Select(m => m.MatterRef)
            .FirstOrDefaultAsync(ct);

    private static AssetTypeResponse ToResponse(AssetType type, (int Total, int Numbered)? counts, FormOwnerSummary? form, AssetNumberExample example) =>
        new(
            type.Id,
            type.Name,
            type.Description,
            type.SortOrder,
            type.IsActive,
            counts?.Total,
            form?.PublishedVersionNo is null ? null : form.PublishedVersionId,
            form?.PublishedVersionNo,
            AssetSupport.Encode(type.RowVersion),
            AssetSupport.Utc(type.CreatedAtUtc),
            AssetSupport.Utc(type.ModifiedAtUtc),
            form?.PublishedVersionNo is null ? null : form.PublishedFieldCount,
            AssetSupport.Utc(form?.PublishedAtUtc),
            form?.DraftVersionNo,
            type.SizeFieldKey,
            type.SizeUnit,
            type.IconKey,
            type.ColourKey,
            ToNumbering(type, example, counts));

    private static AssetTypeNumbering ToNumbering(AssetType type, AssetNumberExample? example, (int Total, int Numbered)? counts) =>
        new(
            type.NumberingEnabled,
            type.NumberingPattern,
            AssetNumbering.ScopeName(type.NumberingScope) ?? AssetNumbering.ScopeMatterName,
            example ?? SampleExample(type),
            counts?.Numbered,
            counts is { } c ? c.Total - c.Numbered : null);

    private static AssetNumberExample SampleExample(AssetType type, string? longest = null) => MakeExample(type, AssetNumbering.SampleCmNumber, 1, isSample: true, longest);

    private static AssetNumberExample MakeExample(AssetType type, string cmNumber, int counter, bool isSample, string? longest = null)
    {
        string text;
        try
        {
            text = AssetNumbering.Parse(type.NumberingPattern).Pattern?.Render(cmNumber, counter) ?? string.Empty;
        }
        catch (ArgumentException)
        {
            text = string.Empty;
        }

        return new AssetNumberExample(cmNumber, counter, isSample, text, longest);
    }

    /// <summary>
    /// The example of a numbered type: the matter most recently numbered for it (the latest counter change) among the matters the caller may see (a hidden matter's CM Number is never shown) and its real next
    /// counter; the sample when numbering is off or nothing visible was numbered yet.
    /// </summary>
    private async Task<AssetNumberExample> ExampleAsync(AssetType type, string? longest, CancellationToken ct)
    {
        if (!type.NumberingEnabled)
            return SampleExample(type, longest);

        var latest = await visibility.WhereMatterVisible(db.Set<AssetNumberCounter>().AsNoTracking().Where(c => c.AssetTypeId == type.Id), c => c.ScopeKey)
            .OrderByDescending(c => c.ModifiedAtUtc)
            .ThenByDescending(c => c.ScopeKey)
            .Select(c => new { c.ScopeKey, c.NextNumber })
            .FirstOrDefaultAsync(ct);
        if (latest is null || await matters.FindAsync(latest.ScopeKey, ct) is not { } matter)
            return SampleExample(type, longest);

        return MakeExample(type, matter.MatterRef, latest.NextNumber, isSample: false, longest);
    }

    private sealed record NumberingSettings(bool Enabled, string Pattern);

    /// <summary>The numbering settings after the request: an omitted value keeps the current one (the defaults for a new type), so a client that does not know the settings never changes them.</summary>
    private static Result<NumberingSettings> CheckNumbering(AssetTypeNumberingRequest? request, AssetType? current)
    {
        if (request?.Scope is { } scope && !AssetNumbering.IsMatterScopeName(scope))
            return Error.Validation("numbering.scope", "INVALID", "The numbering scope must be MATTER.");
        if (request?.Pattern is { } pattern)
        {
            var parsed = AssetNumbering.Parse(pattern);
            if (!parsed.IsValid)
                return Error.Validation("numbering.pattern", parsed.Code!, parsed.Message!);
        }

        return new NumberingSettings(
            request?.Enabled ?? current?.NumberingEnabled ?? false,
            request?.Pattern ?? current?.NumberingPattern ?? AssetNumbering.DefaultPattern);
    }

    private static void ApplyNumbering(AssetType type, NumberingSettings settings)
    {
        type.NumberingEnabled = settings.Enabled;
        type.NumberingPattern = settings.Pattern;
        type.NumberingScope = AssetNumbering.ScopeMatter;
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static Result CheckLook(string? icon, string? colour)
    {
        if (Blank(icon) is { } i && !TaskTypeIcons.IsValid(i))
            return Error.Validation("iconKey", "UNKNOWN_ICON", "Choose an icon from the list.");
        if (Blank(colour) is { } c && !TaskTypeColours.IsValid(c))
            return Error.Validation("colourKey", "UNKNOWN_COLOUR", "Choose a colour from the palette.");
        return Result.Success();
    }

    private async Task<int?> FindIdByNameAsync(string name, int? exceptId, CancellationToken ct) =>
        await db.Set<AssetType>().AsNoTracking()
            .Where(t => t.Name == name && (exceptId == null || t.Id != exceptId))
            .Select(t => (int?)t.Id)
            .FirstOrDefaultAsync(ct);

    private static Error DuplicateName(string name, int? existingId) =>
        AssetSupport.Duplicate("name", $"An asset type named '{name}' already exists.", existingId);
}
