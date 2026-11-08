using System.Data;
using System.Globalization;
using MatterFlow.Assets.Domain;
using MatterFlow.Audit.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace MatterFlow.Assets.Application;

/// <summary>
/// The administrator's view of the automatic numbering (issue #1297): the counter of an asset type per matter and the control that sets the next number, for example to continue after
/// folders that already exist on the share. Only matters the caller may see are listed or changed (sensitive-matter rule, mode M); a hidden matter is a 404 like a missing one.
/// </summary>
public sealed class AssetNumberingService(
    DbContext db,
    IMatterDirectory matters,
    IMatterVisibility visibility,
    AssetAccess access,
    IAuditWriter audit,
    IClock clock)
{
    /// <summary>The audit event of a changed next number (object: the asset type; the matter is its scope; old and new value are the next numbers).</summary>
    public const string NextNumberSetEvent = "ASSET_NEXT_NUMBER_SET";

    public static readonly string[] SortFields = ["matter", "nextNumber", "modifiedAt"];

    /// <summary>Most matters the CM Number search expands to (they become an <c>IN</c> list).</summary>
    private const int MatterFilterLimit = 1000;

    private const string LockCounterSql = """
        INSERT dbo.AssetNumberCounter (AssetTypeId, ScopeKey, NextNumber)
        SELECT @assetTypeId, @scopeKey, 1
         WHERE NOT EXISTS (SELECT 1 FROM dbo.AssetNumberCounter WITH (UPDLOCK, HOLDLOCK) WHERE AssetTypeId = @assetTypeId AND ScopeKey = @scopeKey);

        SELECT NextNumber FROM dbo.AssetNumberCounter WITH (UPDLOCK, ROWLOCK) WHERE AssetTypeId = @assetTypeId AND ScopeKey = @scopeKey;
        """;

    /// <summary>The counters of an asset type, one row per matter that has one (matters never numbered are not listed: look one up with <see cref="GetAsync"/>), by CM Number by default.</summary>
    public async Task<Result<PagedResult<AssetNumberCounterItem>>> ListAsync(int assetTypeId, AssetNumberCounterListQuery query, CancellationToken ct)
    {
        var paging = AssetSupport.PagingOf(query, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        var type = await db.Set<AssetType>().AsNoTracking().SingleOrDefaultAsync(t => t.Id == assetTypeId, ct);
        if (type is null)
            return AssetSupport.NotFound("Asset type");

        var (page, sort) = paging.Value;
        var counters = visibility.WhereMatterVisible(db.Set<AssetNumberCounter>().AsNoTracking().Where(c => c.AssetTypeId == assetTypeId), c => c.ScopeKey);
        if (query.Q?.Trim() is { Length: > 0 } text)
        {
            int[] matterIds = [.. await matters.FindIdsMatchingAsync(text, MatterFilterLimit, ct)];
            counters = counters.Where(c => matterIds.Contains(c.ScopeKey));
        }

        var total = await counters.CountAsync(ct);
        var field = sort.Count == 0 ? new SortField("matter", false) : sort[0];
        IQueryable<AssetNumberCounter> ordered;
        switch (field.Field)
        {
            case "nextNumber":
                ordered = (field.Descending ? counters.OrderByDescending(c => c.NextNumber) : counters.OrderBy(c => c.NextNumber)).ThenBy(c => c.ScopeKey);
                break;
            case "modifiedAt":
                ordered = (field.Descending ? counters.OrderByDescending(c => c.ModifiedAtUtc) : counters.OrderBy(c => c.ModifiedAtUtc)).ThenBy(c => c.ScopeKey);
                break;
            default:
                var keyed = from c in counters join m in matters.SortKeys() on c.ScopeKey equals m.MatterId select new { Counter = c, m.MatterRef };
                ordered = (field.Descending ? keyed.OrderByDescending(x => x.MatterRef) : keyed.OrderBy(x => x.MatterRef)).ThenBy(x => x.Counter.ScopeKey).Select(x => x.Counter);
                break;
        }

        var rows = await ordered.Skip(page.Skip).Take(page.PageSize).ToListAsync(ct);
        var ids = rows.Select(r => r.ScopeKey).ToList();
        var pageMatters = await matters.FindManyAsync(ids, ct);
        var highest = await HighestAsync(assetTypeId, ids, ct);
        var items = rows
            .Where(r => pageMatters.ContainsKey(r.ScopeKey))
            .Select(r => ToItem(type, pageMatters[r.ScopeKey], r.NextNumber, highest.GetValueOrDefault(r.ScopeKey), hasCounter: true, r.ModifiedAtUtc))
            .ToList();
        return AssetSupport.Page(items, total, page);
    }

    /// <summary>The counter of one asset type in one matter; a matter without a counter row answers the defaults (next number 1, nothing assigned) with <c>HasCounter</c> false.</summary>
    public async Task<Result<AssetNumberCounterItem>> GetAsync(int assetTypeId, int matterId, CancellationToken ct)
    {
        var type = await db.Set<AssetType>().AsNoTracking().SingleOrDefaultAsync(t => t.Id == assetTypeId, ct);
        if (type is null)
            return AssetSupport.NotFound("Asset type");

        var matter = await VisibleMatterAsync(matterId, ct);
        if (matter is null)
            return AssetSupport.NotFound("Matter");

        var counter = await db.Set<AssetNumberCounter>().AsNoTracking().SingleOrDefaultAsync(c => c.AssetTypeId == assetTypeId && c.ScopeKey == matterId, ct);
        var highest = (await HighestAsync(assetTypeId, [matterId], ct)).GetValueOrDefault(matterId);
        return counter is null
            ? ToItem(type, matter, Math.Max(1, highest + 1), highest, hasCounter: false, modifiedAtUtc: null)
            : ToItem(type, matter, counter.NextNumber, highest, hasCounter: true, counter.ModifiedAtUtc);
    }

    /// <summary>
    /// Sets the counter value the next asset of the type in the matter gets. Never lower than the highest assigned number plus one (400 <c>NEXT_NUMBER_TOO_LOW</c>); the counter row is created when
    /// missing. The counter row is locked first, so a create that is numbering at the same moment finishes before the check and the change (the highest number is then exact). Audited: who, matter, old and new.
    /// </summary>
    public async Task<Result<AssetNumberCounterItem>> SetNextAsync(int assetTypeId, int matterId, AssetNextNumberChange request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        var type = await db.Set<AssetType>().AsNoTracking().SingleOrDefaultAsync(t => t.Id == assetTypeId, ct);
        if (type is null)
            return AssetSupport.NotFound("Asset type");

        var matter = await VisibleMatterAsync(matterId, ct);
        if (matter is null)
            return AssetSupport.NotFound("Matter");

        if (request.NextNumber is < 1 or > AssetNumbering.MaxNextNumber)
            return Error.Validation("nextNumber", "OUT_OF_RANGE", $"The next number must be between 1 and {AssetNumbering.MaxNextNumber.ToString("N0", CultureInfo.InvariantCulture)}.");

        int old;
        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            old = await LockCounterAsync(assetTypeId, matterId, ct);
            var highest = (await HighestAsync(assetTypeId, [matterId], ct)).GetValueOrDefault(matterId);
            if (request.NextNumber <= highest)
            {
                // Dispose without commit: a row created only to be locked goes away with the transaction.
                return Error.Validation(
                    "nextNumber",
                    "NEXT_NUMBER_TOO_LOW",
                    $"Numbers up to {highest} are already in use for this asset type in matter {matter.MatterRef}. The next number must be at least {highest + 1}.");
            }

            if (request.NextNumber != old)
            {
                var now = clock.UtcNow;
                await db.Set<AssetNumberCounter>()
                    .Where(c => c.AssetTypeId == assetTypeId && c.ScopeKey == matterId)
                    .ExecuteUpdateAsync(s => s.SetProperty(c => c.NextNumber, request.NextNumber).SetProperty(c => c.ModifiedAtUtc, now), ct);
                audit.Write(new AuditEntry
                {
                    EventType = NextNumberSetEvent,
                    ObjectType = nameof(AssetType),
                    ObjectId = assetTypeId.ToString(CultureInfo.InvariantCulture),
                    MatterId = matterId,
                    FieldKey = "nextNumber",
                    OldValue = old.ToString(CultureInfo.InvariantCulture),
                    NewValue = request.NextNumber.ToString(CultureInfo.InvariantCulture),
                    Summary = $"Next number of '{type.Name}' in matter {matter.MatterRef} set from {old} to {request.NextNumber}.",
                });
                await db.SaveChangesAsync(ct);
            }

            await transaction.CommitAsync(ct);
        }

        return await GetAsync(assetTypeId, matterId, ct);
    }

    /// <summary>The matter when it exists and the caller may see it as a whole (mode M), otherwise null (a hidden matter looks like a missing one).</summary>
    private async Task<MatterSummary?> VisibleMatterAsync(int matterId, CancellationToken ct) =>
        await access.CanSeeMatterAsync(matterId, ct) ? await matters.FindAsync(matterId, ct) : null;

    /// <summary>Creates the counter row if it is missing and locks it until the transaction ends; returns the value the next asset would get.</summary>
    private async Task<int> LockCounterAsync(int assetTypeId, int matterId, CancellationToken ct)
    {
        var transaction = db.Database.CurrentTransaction ?? throw new InvalidOperationException("The counter is locked inside a transaction.");
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = LockCounterSql;
        command.Parameters.Add(new SqlParameter("@assetTypeId", SqlDbType.Int) { Value = assetTypeId });
        command.Parameters.Add(new SqlParameter("@scopeKey", SqlDbType.Int) { Value = matterId });
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
    }

    /// <summary>The highest counter value carried by an asset of the type, per matter (one grouped statement); matters without a numbered asset are absent.</summary>
    private async Task<Dictionary<int, int>> HighestAsync(int assetTypeId, IReadOnlyCollection<int> matterIds, CancellationToken ct) =>
        await db.Set<Asset>().AsNoTracking()
            .Where(a => a.AssetTypeId == assetTypeId && matterIds.Contains(a.MatterId) && a.AssetNumberSeq != null)
            .GroupBy(a => a.MatterId)
            .Select(g => new { MatterId = g.Key, Highest = g.Max(a => a.AssetNumberSeq!.Value) })
            .ToDictionaryAsync(x => x.MatterId, x => x.Highest, ct);

    private static AssetNumberCounterItem ToItem(AssetType type, MatterSummary matter, int next, int highest, bool hasCounter, DateTime? modifiedAtUtc) =>
        new(
            type.Id,
            matter.MatterId,
            matter.MatterRef,
            matter.Name,
            highest,
            next,
            Preview(type, matter, next),
            hasCounter,
            AssetSupport.Utc(modifiedAtUtc));

    private static string Preview(AssetType type, MatterSummary matter, int next)
    {
        try
        {
            return AssetNumbering.Parse(type.NumberingPattern).Pattern?.Render(matter.MatterRef, next) ?? string.Empty;
        }
        catch (ArgumentException)
        {
            return string.Empty;
        }
    }
}
