using System.Globalization;
using System.Text.Json;
using MatterFlow.Assets.Contracts;
using MatterFlow.Assets.Domain;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Assets.Application;

/// <summary>
/// Assets: one Matter each (fixed at create), a type whose own fields are validated server-side against the published form version
/// and stored with the version they were captured under, deactivation instead of deletion, and a readable change history
/// (field-level events of the Asset plus one <c>form:&lt;key&gt;</c> event per changed type-specific value).
/// </summary>
public sealed class AssetService(
    DbContext db,
    IAuditWriter audit,
    IMatterDirectory matters,
    IFormDefinitionResolver forms,
    IFormSubmissionValidator validator,
    IFormValueStore valueStore,
    IPermissionChecker permissions,
    IEnumerable<IAssetTaskLinkReader> taskLinks,
    AssetAccess access)
{
    /// <summary>Sort fields: <c>matter</c> is the Matter reference (then the name), <c>linkedTaskCount</c> the number of linked Tasks (constant without <c>Task.View</c>).</summary>
    public static readonly string[] SortFields = ["displayName", "assetType", "createdAt", "matter", "linkedTaskCount"];

    /// <summary>Most Matters the Matter column filter expands to (they become an <c>IN</c> list).</summary>
    private const int MatterFilterLimit = 1000;

    private static readonly IReadOnlyDictionary<string, JsonElement> NoValues = new Dictionary<string, JsonElement>();

    private static readonly Dictionary<string, Func<IQueryable<AssetRow>, bool, bool, IOrderedQueryable<AssetRow>>> Orderings = new()
    {
        ["displayName"] = AssetSupport.By<AssetRow, string>(r => r.Asset.DisplayName),
        ["assetType"] = AssetSupport.By<AssetRow, string>(r => r.AssetTypeName),
        ["createdAt"] = AssetSupport.By<AssetRow, DateTime>(r => r.Asset.CreatedAtUtc),
        ["matter"] = AssetSupport.By<AssetRow, string>(r => r.MatterRef),
        ["linkedTaskCount"] = AssetSupport.By<AssetRow, int>(r => r.Linked),
    };

    private IAssetTaskLinkReader? LinkReader => taskLinks.FirstOrDefault();

    /// <summary>Link counts are Task data: only for a person with <c>Task.View</c>, and only when the Task module is there.</summary>
    private bool CanCountTasks => permissions.Has(Permissions.Task.View) && LinkReader is not null;

    public async Task<Result<PagedResult<AssetListItem>>> ListAsync(AssetListQuery query, CancellationToken ct)
    {
        var paging = AssetSupport.PagingOf(query, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        var (page, sort) = paging.Value;
        var rows = Rows();
        if (query.MatterId is { } matterId)
            rows = rows.Where(r => r.Asset.MatterId == matterId);
        if (query.AssetTypeId is { Length: > 0 } typeIds)
        {
            int[] types = [.. typeIds.Distinct()];
            rows = rows.Where(r => types.Contains(r.Asset.AssetTypeId));
        }
        if (query.IsActive is { } active)
            rows = rows.Where(r => r.Asset.IsActive == active);
        rows = ApplySearch(rows, query.Q);
        if (query.Name?.Trim() is { Length: > 0 } name)
            rows = rows.Where(r => r.Asset.DisplayName.Contains(name));
        if (query.ExternalReference?.Trim() is { Length: > 0 } reference)
            rows = rows.Where(r => r.Asset.ExternalReference != null && r.Asset.ExternalReference.Contains(reference));
        if (query.Matter?.Trim() is { Length: > 0 } matterText)
        {
            int[] matterIds = [.. await matters.FindIdsMatchingAsync(matterText, MatterFilterLimit, ct)];
            rows = rows.Where(r => matterIds.Contains(r.Asset.MatterId));
        }

        var total = await rows.CountAsync(ct);

        // The Matter and count sorts need their data inside the statement (a join on the Matter references, one grouped left join on the link
        // counts); without them the plain rows are used. Without Task.View the count sort is a constant, so the order falls back to the tie-break.
        var order = WithMatterThenName(sort.Count == 0 ? [new SortField("displayName", false)] : sort);
        var ordered = rows;
        if (order.Any(f => f.Field == "matter"))
        {
            ordered = from r in ordered
                      join m in matters.SortKeys() on r.Asset.MatterId equals m.MatterId
                      select new AssetRow { Asset = r.Asset, AssetTypeName = r.AssetTypeName, AssetTypeIsActive = r.AssetTypeIsActive, MatterRef = m.MatterRef, Linked = r.Linked, Open = r.Open };
        }

        var countsJoined = order.Any(f => f.Field == "linkedTaskCount") && CanCountTasks;
        if (countsJoined)
        {
            ordered = from r in ordered
                      join g in LinkReader!.Grouped() on r.Asset.Id equals g.AssetId into joined
                      from g in joined.DefaultIfEmpty()
                      select new AssetRow { Asset = r.Asset, AssetTypeName = r.AssetTypeName, AssetTypeIsActive = r.AssetTypeIsActive, MatterRef = r.MatterRef, Linked = (int?)g.Linked ?? 0, Open = (int?)g.Open ?? 0 };
        }

        var items = await AssetSupport.ApplySort(ordered, order, Orderings, r => r.Asset.Id)
            .Skip(page.Skip)
            .Take(page.PageSize)
            .ToListAsync(ct);

        // One grouped statement for the whole page, never one per row (none at all when the count sort already brought the counts with the page).
        IReadOnlyDictionary<int, AssetTaskCounts>? counts = !CanCountTasks
            ? null
            : countsJoined
                ? items.ToDictionary(r => r.Asset.Id, r => new AssetTaskCounts(r.Linked, r.Open))
                : await LinkReader!.CountForAssetsAsync([.. items.Select(r => r.Asset.Id)], ct);

        var matterCache = new Dictionary<int, MatterSummary?>();
        var list = new List<AssetListItem>(items.Count);
        foreach (var row in items)
        {
            var matter = await MatterAsync(matterCache, row.Asset.MatterId, ct);
            list.Add(new AssetListItem(
                row.Asset.Id,
                row.Asset.MatterId,
                matter?.MatterRef ?? string.Empty,
                matter?.Name ?? string.Empty,
                row.Asset.AssetTypeId,
                row.AssetTypeName,
                row.Asset.DisplayName,
                row.Asset.ExternalReference,
                row.Asset.Description,
                row.Asset.IsActive,
                AssetSupport.Encode(row.Asset.RowVersion),
                AssetSupport.Utc(row.Asset.CreatedAtUtc),
                AssetSupport.Utc(row.Asset.ModifiedAtUtc),
                counts is null ? null : counts.GetValueOrDefault(row.Asset.Id)?.Linked ?? 0,
                counts is null ? null : counts.GetValueOrDefault(row.Asset.Id)?.Open ?? 0));
        }

        return AssetSupport.Page(list, total, page);
    }

    /// <summary>Picker lookup: Assets of one Matter matching a fragment, active ones by default, limited and ordered by name.</summary>
    public async Task<Result<IReadOnlyList<AssetLookupItem>>> LookupAsync(AssetLookupQuery query, CancellationToken ct)
    {
        var rows = Rows().Where(r => r.Asset.MatterId == query.MatterId);
        if (!query.IncludeInactive)
            rows = rows.Where(r => r.Asset.IsActive);
        rows = ApplySearch(rows, query.Q);

        var items = await rows
            .OrderBy(r => r.Asset.DisplayName)
            .ThenBy(r => r.Asset.Id)
            .Take(query.Limit)
            .Select(r => new AssetLookupItem(r.Asset.Id, r.Asset.MatterId, r.AssetTypeName, r.Asset.DisplayName, r.Asset.ExternalReference, r.Asset.IsActive))
            .ToListAsync(ct);
        return Result<IReadOnlyList<AssetLookupItem>>.Success(items);
    }

    public async Task<Result<AssetResponse>> GetAsync(int id, CancellationToken ct) => await GetAsync(id, [], ct);

    /// <summary>True when the caller may see the asset (mode A); the linked-tasks endpoint gates on it.</summary>
    public Task<bool> CanSeeAsync(int id, CancellationToken ct) => access.Visible(db.Set<Asset>().AsNoTracking()).AnyAsync(a => a.Id == id, ct);

    /// <summary>
    /// Creates an Asset. A SQL Server deadlock victim (error 1205: the transaction was rolled back as a whole) is repeated once from a clean
    /// change tracker; a second loss is a retryable 409 CONCURRENCY_CONFLICT, never a 500 (BUG-6).
    /// </summary>
    public Task<Result<AssetResponse>> CreateAsync(CreateAssetRequest request, CancellationToken ct) =>
        WithDeadlockRetryAsync(() => CreateOnceAsync(request, ct));

    private async Task<Result<AssetResponse>> CreateOnceAsync(CreateAssetRequest request, CancellationToken ct)
    {
        // A matter the caller may not see (sensitive-matter rule, mode M) is "not found" in the body, like one that does not exist.
        var matter = await access.CanSeeMatterAsync(request.MatterId, ct) ? await matters.FindAsync(request.MatterId, ct) : null;
        if (matter is null)
            return Error.Validation("matterId", "NOT_FOUND", "Select a matter.");
        if (!matter.IsActive)
            return Error.Conflict(ErrorCodes.MatterInactive, $"Matter {matter.MatterRef} is inactive; assets can't be added to it.");

        var type = await db.Set<AssetType>().AsNoTracking().SingleOrDefaultAsync(t => t.Id == request.AssetTypeId, ct);
        if (type is null)
            return Error.Validation("assetTypeId", "NOT_FOUND", "Select an asset type.");
        if (!type.IsActive)
            return Error.Conflict(ErrorCodes.AssetTypeInactive, $"Asset type '{type.Name}' is inactive. Choose another type.");

        var name = request.DisplayName.Trim();
        if (name.Length == 0)
            return Error.Validation("displayName", "REQUIRED", "Enter a name.");

        var values = request.FormValues ?? [];
        var plan = await PlanFormAsync(type.Id, request.MatterId, values, existing: null, ct);
        if (plan.IsFailure)
            return plan.Error!;

        var asset = new Asset
        {
            MatterId = matter.MatterId,
            AssetTypeId = type.Id,
            DisplayName = name,
            ExternalReference = AssetSupport.Clean(request.ExternalReference),
            Description = AssetSupport.Clean(request.Description),
        };
        db.Set<Asset>().Add(asset);

        IReadOnlyList<string> dropped = [];
        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            await db.SaveChangesAsync(ct);
            if (plan.Value is { } formPlan)
            {
                var saved = await SaveValuesAsync(asset, formPlan, values, previous: NoValues, ct);
                if (saved.IsFailure)
                {
                    db.ChangeTracker.Clear();
                    return saved.Error!;
                }

                dropped = saved.Value;
            }

            await transaction.CommitAsync(ct);
        }

        return await GetAsync(asset.Id, dropped, ct);
    }

    /// <summary>Saves an Asset's editable fields and type values; a lost deadlock is retried once, then 409 (see <see cref="CreateAsync"/>).</summary>
    public Task<Result<AssetResponse>> UpdateAsync(int id, UpdateAssetRequest request, CancellationToken ct) =>
        WithDeadlockRetryAsync(() => UpdateOnceAsync(id, request, ct));

    private async Task<Result<AssetResponse>> UpdateOnceAsync(int id, UpdateAssetRequest request, CancellationToken ct)
    {
        var asset = await access.OfVisibleMatters(db.Set<Asset>()).SingleOrDefaultAsync(a => a.Id == id, ct);
        if (asset is null)
            return AssetSupport.NotFound("Asset");

        if (request.MatterId is { } matterId && matterId != asset.MatterId)
            return Error.Conflict(ErrorCodes.ImmutableField, "An asset belongs to one matter and cannot move to another. Create a new asset in the other matter instead.");
        if (request.AssetTypeId is { } typeId && typeId != asset.AssetTypeId)
            return Error.Conflict(ErrorCodes.ImmutableField, "The asset type cannot be changed after the asset is created.");

        var version = AssetSupport.CheckRowVersion(asset.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (!asset.IsActive)
            return Error.Conflict(ErrorCodes.AssetInactive, "This asset is inactive. Reactivate it before editing.");

        var name = request.DisplayName.Trim();
        if (name.Length == 0)
            return Error.Validation("displayName", "REQUIRED", "Enter a name.");

        var patch = request.FormValues;
        IReadOnlyDictionary<string, JsonElement> previous = NoValues;
        FormPlan? target = null;
        if (patch is not null)
        {
            var definition = await forms.EnsureDefinitionAsync(FormOwnerKind.AssetType, asset.AssetTypeId, ct);
            if (definition.IsFailure)
                return definition.Error!;

            var stored = await valueStore.GetAsync(FormValueOwnerKind.Asset, asset.Id, definition.Value, ct);
            previous = stored?.Values ?? NoValues;
            // An existing asset without stored values that is saved without entering any value is not validated (decisions addendum P).
            if (stored is not null || patch.Values.Any(v => v.ValueKind != JsonValueKind.Null))
            {
                var plan = await PlanFormAsync(asset.AssetTypeId, asset.MatterId, patch, stored is null ? null : previous, ct);
                if (plan.IsFailure)
                    return plan.Error!;

                target = plan.Value;
            }
        }

        asset.DisplayName = name;
        asset.ExternalReference = AssetSupport.Clean(request.ExternalReference);
        asset.Description = AssetSupport.Clean(request.Description);
        AssetSupport.TrackOriginalRowVersion(db, asset, request.RowVersion);

        IReadOnlyList<string> dropped = [];
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            if (target is not null && patch is not null)
            {
                var saved = await SaveValuesAsync(asset, target, patch, previous, ct);
                if (saved.IsFailure)
                {
                    db.ChangeTracker.Clear();
                    return saved.Error!;
                }

                dropped = saved.Value;
            }

            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return AssetSupport.ConcurrencyError();
        }

        return await GetAsync(id, dropped, ct);
    }

    /// <summary>
    /// Deactivates or reactivates an Asset. Assets are never deleted; their history stays readable. A lost deadlock is retried once, then 409
    /// (see <see cref="CreateAsync"/>).
    /// </summary>
    public Task<Result<AssetResponse>> SetActiveAsync(int id, SetAssetActiveRequest request, CancellationToken ct) =>
        WithDeadlockRetryAsync(() => SetActiveOnceAsync(id, request, ct));

    private async Task<Result<AssetResponse>> SetActiveOnceAsync(int id, SetAssetActiveRequest request, CancellationToken ct)
    {
        var asset = await access.OfVisibleMatters(db.Set<Asset>()).SingleOrDefaultAsync(a => a.Id == id, ct);
        if (asset is null)
            return AssetSupport.NotFound("Asset");

        var version = AssetSupport.CheckRowVersion(asset.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        if (asset.IsActive != request.IsActive)
        {
            asset.IsActive = request.IsActive;
            AssetSupport.TrackOriginalRowVersion(db, asset, request.RowVersion);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                db.ChangeTracker.Clear();
                return AssetSupport.ConcurrencyError();
            }
        }

        return await GetAsync(id, ct);
    }

    /// <summary>
    /// Runs one unit of work (validate, write, read back). When SQL Server picks it as the deadlock victim (1205) the whole transaction is already
    /// rolled back, so it is safe to run again from a clean change tracker and without the audit entries the failed save put back; a second loss
    /// returns the retryable 409 the client already handles. Not repeated inside a caller's transaction (the caller owns the retry).
    /// </summary>
    private async Task<Result<AssetResponse>> WithDeadlockRetryAsync(Func<Task<Result<AssetResponse>>> unit)
    {
        try
        {
            return await unit();
        }
        catch (Exception ex) when (AssetSupport.IsDeadlock(ex) && db.Database.CurrentTransaction is null)
        {
            db.ChangeTracker.Clear();
            audit.DiscardPending();
        }

        try
        {
            return await unit();
        }
        catch (Exception ex) when (AssetSupport.IsDeadlock(ex) && db.Database.CurrentTransaction is null)
        {
            db.ChangeTracker.Clear();
            audit.DiscardPending();
            return AssetSupport.LostRace();
        }
    }

    private async Task<Result<AssetResponse>> GetAsync(int id, IReadOnlyList<string> dropped, CancellationToken ct)
    {
        var row = await Rows().Where(r => r.Asset.Id == id).SingleOrDefaultAsync(ct);
        if (row is null)
            return AssetSupport.NotFound("Asset");

        var matter = await matters.FindAsync(row.Asset.MatterId, ct);
        // Read path: never create the definition here (a GET that writes would bypass the CSRF guard, SEC-22).
        var definitionId = await forms.FindDefinitionIdAsync(FormOwnerKind.AssetType, row.Asset.AssetTypeId, ct);
        var stored = definitionId is { } existing
            ? await valueStore.GetAsync(FormValueOwnerKind.Asset, row.Asset.Id, existing, ct)
            : null;
        var published = await forms.GetPublishedVersionAsync(FormOwnerKind.AssetType, row.Asset.AssetTypeId, ct);
        var counts = CanCountTasks ? (await LinkReader!.CountForAssetsAsync([row.Asset.Id], ct)).GetValueOrDefault(row.Asset.Id) : null;

        return new AssetResponse(
            row.Asset.Id,
            row.Asset.MatterId,
            matter?.MatterRef ?? string.Empty,
            matter?.Name ?? string.Empty,
            row.Asset.AssetTypeId,
            row.AssetTypeName,
            row.AssetTypeIsActive,
            row.Asset.DisplayName,
            row.Asset.ExternalReference,
            row.Asset.Description,
            row.Asset.IsActive,
            stored?.FormVersionId,
            published.IsSuccess ? published.Value.FormVersionId : null,
            stored is null ? [] : new Dictionary<string, JsonElement>(stored.Values),
            dropped,
            AssetSupport.Encode(row.Asset.RowVersion),
            AssetSupport.Utc(row.Asset.CreatedAtUtc),
            AssetSupport.Utc(row.Asset.ModifiedAtUtc),
            CanCountTasks ? counts?.Linked ?? 0 : null,
            CanCountTasks ? counts?.Open ?? 0 : null,
            matter is null || !matter.IsSensitive || await access.CanSeeMatterAsync(row.Asset.MatterId, ct));
    }

    /// <summary>The Matter sort is "Matter reference, then display name": the name is the last tie-break before the id unless the person asked for it elsewhere.</summary>
    private static IReadOnlyList<SortField> WithMatterThenName(IReadOnlyList<SortField> sort) =>
        sort.Any(f => f.Field == "matter") && !sort.Any(f => f.Field == "displayName")
            ? [.. sort, new SortField("displayName", false)]
            : sort;

    /// <summary>
    /// Validates the submitted values against the type's published form before anything is written. Returns the version to store them
    /// under, or null when the type has no published form and nothing was submitted. Submitting values to a type without a published
    /// form is FORM_NOT_PUBLISHED.
    /// </summary>
    private async Task<Result<FormPlan?>> PlanFormAsync(
        int assetTypeId,
        int matterId,
        IReadOnlyDictionary<string, JsonElement> values,
        IReadOnlyDictionary<string, JsonElement>? existing,
        CancellationToken ct)
    {
        var published = await forms.GetPublishedVersionAsync(FormOwnerKind.AssetType, assetTypeId, ct);
        if (published.IsFailure)
        {
            var notPublished = published.Error!.Code is ErrorCodes.FormNotPublished or ErrorCodes.NotFound;
            if (notPublished && values.Values.All(v => v.ValueKind == JsonValueKind.Null))
                return Result<FormPlan?>.Success(null);

            return Result<FormPlan?>.Failure(
                notPublished
                    ? Error.Conflict(ErrorCodes.FormNotPublished, "This asset type has no published form, so it has no fields to fill in.")
                    : published.Error!);
        }

        var checkedValues = await validator.ValidateAsync(
            published.Value.FormVersionId,
            values,
            new FormSubmissionOptions
            {
                Mode = FormSubmissionMode.Submit,
                ExistingValues = existing,
                ValidateOnly = existing is null ? null : FormSubmissionOptions.ChangedFieldsOf(values, existing),
                RequireAllWhenChanged = true,
                References = new FormReferenceContext(matterId),
            },
            ct);
        if (checkedValues.IsFailure)
            return Result<FormPlan?>.Failure(checkedValues.Error!);
        if (checkedValues.Value.ToError() is { } invalid)
            return Result<FormPlan?>.Failure(invalid);

        return Result<FormPlan?>.Success(new FormPlan(published.Value, checkedValues.Value));
    }

    /// <summary>Stores the values under the version, queues one history event per changed key, and returns the dropped (hidden) keys.</summary>
    private async Task<Result<IReadOnlyList<string>>> SaveValuesAsync(
        Asset asset,
        FormPlan plan,
        IReadOnlyDictionary<string, JsonElement> values,
        IReadOnlyDictionary<string, JsonElement> previous,
        CancellationToken ct)
    {
        // The history events are queued before the value write so that its SaveChanges persists them in the same transaction.
        QueueHistory(asset, plan.Validated, previous);
        var saved = await valueStore.SaveAsync(
            FormValueOwnerKind.Asset,
            asset.Id,
            plan.Version.FormVersionId,
            values,
            new FormSaveOptions { Mode = FormSubmissionMode.Submit, ValidateOnlyChanged = true, References = new FormReferenceContext(asset.MatterId) },
            ct);
        if (saved.IsFailure)
            return Result<IReadOnlyList<string>>.Failure(saved.Error!);

        return Result<IReadOnlyList<string>>.Success(saved.Value.DroppedFields);
    }

    private void QueueHistory(Asset asset, FormSubmissionResult validated, IReadOnlyDictionary<string, JsonElement> previous)
    {
        var current = validated.NormalizedValues;
        foreach (var key in previous.Keys.Concat(current.Keys.Where(k => !previous.ContainsKey(k))))
        {
            var hadOld = previous.TryGetValue(key, out var oldValue);
            var hasNew = current.TryGetValue(key, out var newValue);
            if (hadOld && hasNew && oldValue.GetRawText() == newValue.GetRawText())
                continue;

            audit.Write(new AuditEntry
            {
                EventType = AuditEventTypes.FieldChanged,
                ObjectType = nameof(Asset),
                ObjectId = asset.Id.ToString(CultureInfo.InvariantCulture),
                MatterId = asset.MatterId,
                FieldKey = Clip("form:" + key),
                OldValue = hadOld ? Display(oldValue) : null,
                NewValue = hasNew ? Display(newValue) : null,
            });
        }

        if (validated.DroppedFields.Count > 0)
        {
            audit.Write(new AuditEntry
            {
                EventType = "FORM_VALUES_DROPPED",
                ObjectType = nameof(Asset),
                ObjectId = asset.Id.ToString(CultureInfo.InvariantCulture),
                MatterId = asset.MatterId,
                Summary = "Hidden values dropped: " + string.Join(", ", validated.DroppedFields),
            });
        }
    }

    private static string Clip(string key) => key.Length <= 100 ? key : key[..100];

    private static string? Display(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Null => null,
        _ => e.GetRawText(),
    };

    private static IQueryable<AssetRow> ApplySearch(IQueryable<AssetRow> rows, string? text)
    {
        var q = text?.Trim();
        return string.IsNullOrEmpty(q)
            ? rows
            : rows.Where(r => r.Asset.DisplayName.Contains(q)
                || r.AssetTypeName.Contains(q)
                || (r.Asset.ExternalReference != null && r.Asset.ExternalReference.Contains(q)));
    }

    private IQueryable<AssetRow> Rows() =>
        from a in access.Visible(db.Set<Asset>().AsNoTracking())
        join t in db.Set<AssetType>().AsNoTracking() on a.AssetTypeId equals t.Id
        select new AssetRow { Asset = a, AssetTypeName = t.Name, AssetTypeIsActive = t.IsActive, MatterRef = string.Empty, Linked = 0, Open = 0 };

    private async Task<MatterSummary?> MatterAsync(Dictionary<int, MatterSummary?> cache, int matterId, CancellationToken ct)
    {
        if (!cache.TryGetValue(matterId, out var matter))
        {
            matter = await matters.FindAsync(matterId, ct);
            cache[matterId] = matter;
        }

        return matter;
    }

    private sealed record FormPlan(FormVersionRef Version, FormSubmissionResult Validated);

    internal sealed class AssetRow
    {
        public Asset Asset { get; init; } = null!;

        public string AssetTypeName { get; init; } = string.Empty;

        public bool AssetTypeIsActive { get; init; }

        /// <summary>The Matter reference; filled only when the list is sorted by Matter.</summary>
        public string MatterRef { get; init; } = string.Empty;

        /// <summary>The number of linked Tasks; filled only when the list is sorted by it (and the viewer has Task.View).</summary>
        public int Linked { get; init; }

        /// <summary>Of those, the open ones; filled together with <see cref="Linked"/>.</summary>
        public int Open { get; init; }
    }
}
