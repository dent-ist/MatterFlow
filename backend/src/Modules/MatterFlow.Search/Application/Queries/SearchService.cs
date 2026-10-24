using System.Data;
using System.Linq.Expressions;
using MatterFlow.Assets.Contracts;
using MatterFlow.Assets.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.ValueObjects;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Domain;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Search.Application.Queries;

/// <summary>
/// Read side of global and advanced search: plain SQL Server queries (architecture 14), one per object type, never a search engine. Each type is
/// searched only when the caller holds its View permission. Matching is number-aware (padded or unpadded) and every row carries the relevance tier it
/// matched at (<see cref="SearchRanking"/>); hits sort by tier, then a stable per-type key. User text only ever reaches SQL as an escaped LIKE parameter.
/// </summary>
public sealed class SearchService(DbContext db, IPermissionChecker permissions, IMatterVisibility visibility, IEnumerable<IAssetTaskLinkReader> assetLinks, IManagedMatterScope managed)
{
    private static readonly IReadOnlyDictionary<string, string> ViewPermission = new Dictionary<string, string>
    {
        [SearchTypes.Client] = Permissions.Client.View,
        [SearchTypes.Matter] = Permissions.Matter.View,
        [SearchTypes.Project] = Permissions.Project.View,
        [SearchTypes.Task] = Permissions.Task.View,
        [SearchTypes.Asset] = Permissions.Asset.View,
    };

    /// <summary>Every View permission a search needs one of; the endpoints are open to a caller holding at least one.</summary>
    public static readonly IReadOnlyList<string> AnyViewPermission = [.. ViewPermission.Values];

    /// <summary>Totals are exact up to this many matches per type; beyond it the group reports the cap and <c>TotalCapped</c> (profile: docs/ux/search-review/fixes/sr2-panel/profile.md).</summary>
    public const int TotalCap = 1000;

    // ---- global search

    public async Task<Result<SearchResponse>> SearchAsync(GlobalSearchQuery query, CancellationToken ct)
    {
        var term = SearchTerm.Parse(query.Q);
        if (term.IsFailure)
            return term.Error!;

        var limit = query.Limit ?? GlobalSearchQuery.DefaultLimit;
        if (limit is < 1 or > GlobalSearchQuery.MaxLimit)
            return Error.Validation("limit", "RANGE", $"limit must be between 1 and {GlobalSearchQuery.MaxLimit}.");

        var requested = ParseTypes(query.Types);
        if (requested.IsFailure)
            return requested.Error!;

        var searched = SearchTypes.All.Where(t => requested.Value.Contains(t) && permissions.Has(ViewPermission[t])).ToList();
        var groups = new List<SearchGroup>();
        foreach (var type in searched)
        {
            // One extra row tells whether the cap cut something off. When it did not, the rows fetched ARE the matches and the total is free; only a
            // type with more matches than the limit pays for a second count of the same predicate, cut at the cap when it is shown (the profile:
            // sr2-panel/profile.md; a TOP-bounded count measured slower than the plain one, so the cap is applied to the number, not the query).
            var hits = await HitsAsync(type, term.Value, filter: null, skip: 0, take: limit + 1, ct);
            var more = hits.Count > limit;
            var counted = more ? await CountAsync(type, term.Value, filter: null, ct) : hits.Count;
            var capped = counted > TotalCap;
            groups.Add(new SearchGroup(type, hits.Take(limit).ToList(), more, capped ? TotalCap : counted, capped));
        }

        return new SearchResponse(term.Value.Text, term.Value.Normalized, groups, searched);
    }

    private static Result<HashSet<string>> ParseTypes(string[]? types)
    {
        var names = (types ?? []).SelectMany(t => FilterParsing.SplitList(t)).Select(t => t.ToLowerInvariant()).ToList();
        if (names.Count == 0)
            return SearchTypes.All.ToHashSet();

        var unknown = names.FirstOrDefault(n => !SearchTypes.All.Contains(n));
        return unknown is null
            ? names.ToHashSet()
            : Error.Validation("types", "UNKNOWN_TYPE", $"Unknown type '{unknown}'. Allowed: {string.Join(", ", SearchTypes.All)}.");
    }

    // ---- advanced search

    public async Task<Result<AdvancedSearchPage>> AdvancedAsync(AdvancedSearchQuery query, CancellationToken ct)
    {
        var type = SearchTypes.All.FirstOrDefault(t => string.Equals(t, query.Type?.Trim(), StringComparison.OrdinalIgnoreCase));
        if (type is null)
            return Error.Validation("type", "UNKNOWN_TYPE", $"Choose a type. Allowed: {string.Join(", ", SearchTypes.All)}.");

        var allowed = permissions.Require(ViewPermission[type]);
        if (allowed.IsFailure)
            return allowed.Error!;

        var page = PageRequest.Create(query.Page, query.PageSize);
        if (page.IsFailure)
            return page.Error!;

        SearchTerm? term = null;
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var parsed = SearchTerm.Parse(query.Q);
            if (parsed.IsFailure)
                return parsed.Error!;
            term = parsed.Value;
        }

        var filter = AdvancedFilter.From(type, query);
        if (filter.IsFailure)
            return filter.Error!;

        var items = await HitsAsync(type, term, filter.Value, page.Value.Skip, page.Value.PageSize, ct);
        var total = await CountAsync(type, term, filter.Value, ct);
        return new AdvancedSearchPage(type, items, total, page.Value.Page, page.Value.PageSize);
    }

    // ---- per type

    private Task<List<SearchHit>> HitsAsync(string type, SearchTerm? term, AdvancedFilter? filter, int skip, int take, CancellationToken ct) => type switch
    {
        SearchTypes.Client => ClientHitsAsync(term, filter, skip, take, ct),
        SearchTypes.Matter => MatterHitsAsync(term, filter, skip, take, ct),
        SearchTypes.Project => ProjectHitsAsync(term, filter, skip, take, ct),
        SearchTypes.Task => TaskHitsAsync(term, filter, skip, take, ct),
        _ => AssetHitsAsync(term, filter, skip, take, ct),
    };

    private Task<int> CountAsync(string type, SearchTerm? term, AdvancedFilter? filter, CancellationToken ct) => type switch
    {
        SearchTypes.Client => ClientRows(term, filter).CountAsync(ct),
        SearchTypes.Matter => MatterRanked(term, filter).CountAsync(ct),
        SearchTypes.Project => ProjectRanked(term, filter).CountAsync(ct),
        SearchTypes.Task => TaskRanked(term, filter).CountAsync(ct),
        _ => AssetCountAsync(term, filter, ct),
    };

    private async Task<int> AssetCountAsync(SearchTerm? term, AdvancedFilter? filter, CancellationToken ct)
    {
        await PrepareAssetsAsync(ct);
        return await AssetRanked(term, filter).CountAsync(ct);
    }

    /// <summary>Loads, once per request, the assets the caller reaches only through a task assigned to them on a sensitive matter, so the rule is a short list instead of a subquery (issue #810).</summary>
    private async Task PrepareAssetsAsync(CancellationToken ct)
    {
        if (!visibility.Enabled || assetLinks.FirstOrDefault() is not { } reader)
            return;

        var viewer = visibility.Current;
        if (!viewer.SeeAll && viewer.UserId is { } user)
            await reader.PrepareAsync(user, ct);
    }

    private static Expression<Func<AssetMatter, bool>> AssignedAssets(IAssetTaskLinkReader? reader, int user)
    {
        if (reader is null)
            return x => false;

        if (reader.PreparedAssetIdsOfTasksAssignedTo(user) is not { } ids)
            return VisibilityPredicates.In<AssetMatter, int>(x => x.Asset.Id, reader.AssetIdsOfTasksAssignedTo(user));

        if (ids.Count == 0)
            return x => false;

        var list = ids.ToArray();
        return x => list.Contains(x.Asset.Id);
    }

    // Clients: the number column is a value-converted type that LINQ cannot LIKE, so this one is a parameterized SQL statement (still one query, still composable).

    private IQueryable<ClientRow> ClientRows(SearchTerm? term, AdvancedFilter? filter)
    {
        const string sql = """
            SELECT c.ClientId AS Id, c.ClientNumber AS Number, c.Name AS Name, c.IsActive AS IsActive,
              CASE WHEN @hasTerm = 0 THEN 0
                   WHEN c.ClientNumber = @number OR c.Name = @text THEN 0
                   WHEN c.ClientNumber = @pairClient OR c.ClientNumber LIKE @np0 OR c.ClientNumber LIKE @np1 OR c.ClientNumber LIKE @np2
                     OR c.ClientNumber LIKE @np3 OR c.ClientNumber LIKE @np4 OR c.Name LIKE @prefix ESCAPE '\' THEN 1
                   WHEN c.Name LIKE @word ESCAPE '\' THEN 2
                   ELSE 3 END AS [Rank]
            FROM dbo.Client c
            WHERE @hasTerm = 0 OR c.ClientNumber = @number OR c.ClientNumber = @pairClient OR c.ClientNumber LIKE @np0 OR c.ClientNumber LIKE @np1
              OR c.ClientNumber LIKE @np2 OR c.ClientNumber LIKE @np3 OR c.ClientNumber LIKE @np4 OR c.Name = @text OR c.Name LIKE @contains ESCAPE '\'
            """;

        SqlParameter Digits(string name, string value) => new(name, SqlDbType.VarChar, 8) { Value = value };
        SqlParameter Text(string name, string? value, int size) => new(name, SqlDbType.NVarChar, size) { Value = value ?? SearchTerm.Never };

        var np = term?.NumberPrefixes ?? [.. Enumerable.Repeat(SearchTerm.Never, SearchTerm.PrefixSlots)];
        object[] parameters =
        [
            new SqlParameter("hasTerm", SqlDbType.Bit) { Value = term is not null },
            Digits("number", term?.Number ?? SearchTerm.Never),
            Digits("pairClient", term?.PairClient ?? SearchTerm.Never),
            Digits("np0", np[0]),
            Digits("np1", np[1]),
            Digits("np2", np[2]),
            Digits("np3", np[3]),
            Digits("np4", np[4]),
            Text("text", term?.Text, SearchTerm.MaxLength),
            Text("prefix", term?.Prefix, 2 * SearchTerm.MaxLength + 1),
            Text("word", term?.WordStart, 2 * SearchTerm.MaxLength + 12),
            Text("contains", term?.Contains, 2 * SearchTerm.MaxLength + 2),
        ];

        var rows = db.Database.SqlQueryRaw<ClientRow>(sql, parameters);
        if (filter?.Active is { } active)
            rows = rows.Where(r => r.IsActive == active);
        return rows;
    }

    private async Task<List<SearchHit>> ClientHitsAsync(SearchTerm? term, AdvancedFilter? filter, int skip, int take, CancellationToken ct)
    {
        var page = ClientRows(term, filter).OrderBy(r => r.Rank).ThenBy(r => r.Name).ThenBy(r => r.Id).Skip(skip).Take(take);
        // A client is "mine" when one of its matters is.
        var rows = await PageWithLabelAsync(page, r => r.Id, clientKey: true, ct);
        return [.. rows.Select(x => new SearchHit(SearchTypes.Client, x.Item.Id, x.Item.Number, x.Item.Name, null, $"/clients/{x.Item.Id}", false, null, null, x.Item.IsActive, null, x.Mine))];
    }

    private IQueryable<Matter> ManagedClientMatters() =>
        managed.WhereManagedBy(db.Set<Matter>().AsNoTracking(), m => m.PrimaryManagerId, m => m.SecondaryManagerId, m => m.Id, managed.CurrentUserId ?? 0, ManagerPlace.Either);

    // Matters

    private IQueryable<Ranked<MatterRow>> MatterRanked(SearchTerm? term, AdvancedFilter? filter)
    {
        var rows =
            from m in VisibleMatters()
            join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
            select new MatterRow
            {
                Id = m.Id,
                Ref = m.MatterRef,
                Name = m.Name,
                ClientId = m.ClientId,
                ClientName = c.Name,
                ClientNumber = m.ClientNumber,
                MatterNumber = m.MatterNumber,
                IsActive = m.IsActive,
                IsSensitive = m.IsSensitive,
            };

        if (filter?.Client is { } client)
            rows = rows.Where(r => r.ClientId == client);
        if (filter?.Active is { } active)
            rows = rows.Where(r => r.IsActive == active);
        if (filter?.Sensitive is { } sensitive)
            rows = rows.Where(r => r.IsSensitive == sensitive);

        if (term is null)
            return RankedQuery.Rank(rows, [], requireMatch: false);

        var number = term.HasNumber ? BusinessNumber.FromStored(term.Number) : default;
        var pairRef = term.PairRef;
        var numberMatterPrefixes = term.NumberPrefixes.Select(p => p == SearchTerm.Never ? p : "_____-" + p).ToList();
        var tiers = new List<Tier<MatterRow>>();
        tiers.AddRange(RankedQuery.EqualTier<MatterRow>(SearchRanking.Exact, r => r.Ref, pairRef));
        if (term.HasNumber)
            tiers.Add(new Tier<MatterRow>(SearchRanking.Exact, r => r.MatterNumber == number || r.ClientNumber == number));
        tiers.AddRange(RankedQuery.AnyLike<MatterRow>(SearchRanking.StartsWith, r => r.Ref, term.PairPrefixes));
        tiers.AddRange(RankedQuery.AnyLike<MatterRow>(SearchRanking.StartsWith, r => r.Ref, term.NumberPrefixes));
        tiers.AddRange(RankedQuery.AnyLike<MatterRow>(SearchRanking.StartsWith, r => r.Ref, numberMatterPrefixes));
        tiers.AddRange(RankedQuery.TextTiers<MatterRow>(r => r.Name, term));
        return RankedQuery.Rank(rows, tiers, requireMatch: true);
    }

    private async Task<List<SearchHit>> MatterHitsAsync(SearchTerm? term, AdvancedFilter? filter, int skip, int take, CancellationToken ct)
    {
        var page = MatterRanked(term, filter).OrderBy(r => r.Rank).ThenBy(r => r.Item.Ref).ThenBy(r => r.Item.Id).Skip(skip).Take(take);
        var rows = await PageWithLabelAsync(page, r => r.Item.Id, clientKey: false, ct);
        return
        [
            .. rows.Select(x => new SearchHit(
                SearchTypes.Matter, x.Item.Item.Id, x.Item.Item.Ref, x.Item.Item.Name, x.Item.Item.ClientName, $"/matters/{x.Item.Item.Id}",
                x.Item.Item.IsSensitive, x.Item.Item.Ref, x.Item.Item.Name, x.Item.Item.IsActive, null, x.Mine)),
        ];
    }

    // Projects

    private IQueryable<Ranked<ProjectRow>> ProjectRanked(SearchTerm? term, AdvancedFilter? filter)
    {
        var rows =
            from p in db.Set<Project>().AsNoTracking()
            join m in VisibleMatters() on p.MatterId equals m.Id
            select new ProjectRow
            {
                Id = p.Id,
                Name = p.Name,
                IsActive = p.IsActive,
                MatterId = p.MatterId,
                MatterRef = m.MatterRef,
                MatterName = m.Name,
                IsSensitive = m.IsSensitive,
            };

        if (filter?.Matter is { } matter)
            rows = rows.Where(r => r.MatterId == matter);
        if (filter?.Active is { } active)
            rows = rows.Where(r => r.IsActive == active);

        if (term is null)
            return RankedQuery.Rank(rows, [], requireMatch: false);

        var tiers = new List<Tier<ProjectRow>>();
        tiers.AddRange(RankedQuery.TextTiers<ProjectRow>(r => r.Name, term));
        tiers.AddRange(RelatedTiers<ProjectRow>(r => r.MatterRef, term));
        return RankedQuery.Rank(rows, tiers, requireMatch: true);
    }

    private async Task<List<SearchHit>> ProjectHitsAsync(SearchTerm? term, AdvancedFilter? filter, int skip, int take, CancellationToken ct)
    {
        var page = ProjectRanked(term, filter).OrderBy(r => r.Rank).ThenBy(r => r.Item.Name).ThenBy(r => r.Item.Id).Skip(skip).Take(take);
        var rows = await PageWithLabelAsync(page, r => r.Item.MatterId, clientKey: false, ct);
        return
        [
            .. rows.Select(x => new SearchHit(
                SearchTypes.Project, x.Item.Item.Id, null, x.Item.Item.Name, ShowMatter ? $"{x.Item.Item.MatterRef} {x.Item.Item.MatterName}" : null, $"/projects/{x.Item.Item.Id}",
                x.Item.Item.IsSensitive, ShowMatter ? x.Item.Item.MatterRef : null, ShowMatter ? x.Item.Item.MatterName : null, x.Item.Item.IsActive, null, x.Mine)),
        ];
    }

    // Tasks

    private IQueryable<Ranked<TaskRow>> TaskRanked(SearchTerm? term, AdvancedFilter? filter)
    {
        // Mode T on the task's own columns (not sensitive, assigned to the viewer, or a matter the viewer manages; no extra join, issue #810).
        var joined = visibility.WhereTaskFlagVisible(
            from t in db.Set<WorkTask>().AsNoTracking()
            join m in db.Set<Matter>().AsNoTracking() on t.MatterId equals m.Id
            select new TaskMatter { Task = t, Matter = m },
            x => x.Task.MatterId,
            x => x.Task.IsMatterSensitive,
            x => x.Task.AssignedUserId);
        var rows =
            from x in joined
            let t = x.Task
            let m = x.Matter
            select new TaskRow
            {
                Id = t.Id,
                Number = t.Number,
                Title = t.Title,
                Requestor = t.RequestorName,
                RequestorEmail = t.RequestorEmail,
                Status = t.Status,
                MatterId = t.MatterId,
                ProjectId = t.ProjectId,
                ClientId = m.ClientId,
                MatterRef = m.MatterRef,
                MatterName = m.Name,
                IsSensitive = m.IsSensitive,
            };

        if (filter?.Client is { } client)
            rows = rows.Where(r => r.ClientId == client);
        if (filter?.Matter is { } matter)
            rows = rows.Where(r => r.MatterId == matter);
        if (filter?.Project is { } project)
            rows = rows.Where(r => r.ProjectId == project);
        if (filter is { Statuses.Count: > 0 })
        {
            var statuses = filter.Statuses.ToList();
            rows = rows.Where(r => statuses.Contains(r.Status));
        }

        if (filter?.Requestor is { } requestor)
        {
            var pattern = "%" + SearchTerm.EscapeLike(requestor.ToLowerInvariant()) + "%";
            rows = rows.Where(r => EF.Functions.Like(EF.Functions.Collate(r.Requestor.ToLower(), "Latin1_General_100_BIN2"), pattern, SearchTerm.Escape)
                || (r.RequestorEmail != null && EF.Functions.Like(EF.Functions.Collate(r.RequestorEmail.ToLower(), "Latin1_General_100_BIN2"), pattern, SearchTerm.Escape)));
        }

        if (term is null)
            return RankedQuery.Rank(rows, [], requireMatch: false);

        var tiers = new List<Tier<TaskRow>>();
        tiers.AddRange(RankedQuery.EqualTier<TaskRow>(SearchRanking.Exact, r => r.Number, term.TaskNumber));
        tiers.AddRange(RankedQuery.AnyLike<TaskRow>(SearchRanking.StartsWith, r => r.Number, [term.TaskPrefix]));
        // Binary path: the Task table is the second largest, and the case-insensitive collation scan costs about five times more CPU per request.
        tiers.AddRange(RankedQuery.TextTiers<TaskRow>(r => r.Title, term, binary: true));
        tiers.AddRange(RankedQuery.TextTiers<TaskRow>(r => r.Requestor, term, binary: true).Select(t => t with { Rank = Math.Max(t.Rank, SearchRanking.StartsWith) }));
        tiers.AddRange(RelatedTiers<TaskRow>(r => r.MatterRef, term));
        return RankedQuery.Rank(rows, tiers, requireMatch: true);
    }

    private async Task<List<SearchHit>> TaskHitsAsync(SearchTerm? term, AdvancedFilter? filter, int skip, int take, CancellationToken ct)
    {
        var page = TaskRanked(term, filter).OrderBy(r => r.Rank).ThenByDescending(r => r.Item.Id).Skip(skip).Take(take);
        var rows = await PageWithLabelAsync(page, r => r.Item.MatterId, clientKey: false, ct);
        return
        [
            .. rows.Select(x => new SearchHit(
                SearchTypes.Task, x.Item.Item.Id, x.Item.Item.Number, x.Item.Item.Title, x.Item.Item.Requestor, $"/tasks/{x.Item.Item.Id}",
                x.Item.Item.IsSensitive, ShowMatter ? x.Item.Item.MatterRef : null, ShowMatter ? x.Item.Item.MatterName : null, true, x.Item.Item.Status.ToCode(), x.Mine)),
        ];
    }

    // Assets

    private IQueryable<Ranked<AssetRow>> AssetRanked(SearchTerm? term, AdvancedFilter? filter)
    {
        // Mode A over the joined matter columns: the matter rule OR linked to a task assigned to the viewer.
        var linkReader = assetLinks.FirstOrDefault();
        var joined = visibility.WhereMatterRowVisibleOr(
            from a in db.Set<Asset>().AsNoTracking()
            join m in db.Set<Matter>().AsNoTracking() on a.MatterId equals m.Id
            select new AssetMatter { Asset = a, Matter = m },
            x => x.Matter.IsSensitive,
            x => x.Matter.PrimaryManagerId,
            x => x.Matter.SecondaryManagerId,
            user => AssignedAssets(linkReader, user));
        var rows =
            from x in joined
            let a = x.Asset
            let m = x.Matter
            join t in db.Set<AssetType>().AsNoTracking() on a.AssetTypeId equals t.Id
            select new AssetRow
            {
                Id = a.Id,
                Name = a.DisplayName,
                ExternalReference = a.ExternalReference,
                TypeName = t.Name,
                AssetTypeId = a.AssetTypeId,
                IsActive = a.IsActive,
                MatterId = a.MatterId,
                MatterRef = m.MatterRef,
                MatterName = m.Name,
                IsSensitive = m.IsSensitive,
            };

        if (filter?.Matter is { } matter)
            rows = rows.Where(r => r.MatterId == matter);
        if (filter?.AssetType is { } assetType)
            rows = rows.Where(r => r.AssetTypeId == assetType);
        if (filter?.Active is { } active)
            rows = rows.Where(r => r.IsActive == active);

        if (term is null)
            return RankedQuery.Rank(rows, [], requireMatch: false);

        var tiers = new List<Tier<AssetRow>>();
        tiers.AddRange(RankedQuery.TextTiers<AssetRow>(r => r.Name, term, binary: true));
        tiers.AddRange(RankedQuery.TextTiers<AssetRow>(r => r.ExternalReference, term, binary: true));
        tiers.AddRange(RankedQuery.TextTiers<AssetRow>(r => r.TypeName, term, binary: true).Select(t => t with { Rank = Math.Max(t.Rank, SearchRanking.WordStart) }));
        tiers.AddRange(RelatedTiers<AssetRow>(r => r.MatterRef, term));
        return RankedQuery.Rank(rows, tiers, requireMatch: true);
    }

    private async Task<List<SearchHit>> AssetHitsAsync(SearchTerm? term, AdvancedFilter? filter, int skip, int take, CancellationToken ct)
    {
        await PrepareAssetsAsync(ct);
        var page = AssetRanked(term, filter).OrderBy(r => r.Rank).ThenBy(r => r.Item.Name).ThenBy(r => r.Item.Id).Skip(skip).Take(take);
        var rows = await PageWithLabelAsync(page, r => r.Item.MatterId, clientKey: false, ct);
        return
        [
            .. rows.Select(x => new SearchHit(
                SearchTypes.Asset, x.Item.Item.Id, x.Item.Item.ExternalReference, x.Item.Item.Name, x.Item.Item.TypeName, $"/assets/{x.Item.Item.Id}",
                x.Item.Item.IsSensitive, ShowMatter ? x.Item.Item.MatterRef : null, ShowMatter ? x.Item.Item.MatterName : null, x.Item.Item.IsActive, null, x.Mine)),
        ];
    }

    /// <summary>The matters the caller may see as a whole (sensitive-matter rule, mode M; every matter while the go-live switch is off).</summary>
    private IQueryable<Matter> VisibleMatters() =>
        visibility.WhereMatterRowVisible(db.Set<Matter>().AsNoTracking(), m => m.IsSensitive, m => m.PrimaryManagerId, m => m.SecondaryManagerId);

    /// <summary>Matter reference and name travel with Project, Task and Asset hits only for callers who may view Matters (SEC2-11).</summary>
    private bool ShowMatter => permissions.Has(Permissions.Matter.View);

    /// <summary>A combined number (<c>343-12</c>, <c>343-</c>) also finds the records that belong to that Matter (SCN-020): they rank just below a name match at the start.</summary>
    private static IEnumerable<Tier<T>> RelatedTiers<T>(System.Linq.Expressions.Expression<Func<T, string?>> matterRef, SearchTerm term)
    {
        foreach (var tier in RankedQuery.EqualTier(SearchRanking.StartsWith, matterRef, term.PairRef))
            yield return tier;
        foreach (var tier in RankedQuery.AnyLike(SearchRanking.StartsWith, matterRef, term.PairPrefixes))
            yield return tier;
    }

    // ---- "in my matters" label (epic #758, PX-05)

    /// <summary>The matters the caller manages (Primary or Secondary), as a subquery; null for a caller who holds no <c>Matter.BeManager</c> (no label then).</summary>
    private IQueryable<int>? MyMatterIds() =>
        permissions.Has(Permissions.Matter.BeManager) && managed.CurrentUserId is { } me ? managed.ManagedMatterIds(me) : null;

    /// <summary>
    /// The page of hits with the label. The page is read exactly as before (the ranking and the paging are untouched); then ONE small statement per type that returned rows tells which of the
    /// (at most a page of) matter ids, or client ids, are managed by the caller: a probe of the two filtered manager indexes per returned row. The test is deliberately not part of the
    /// ranked statement: there the optimizer evaluated it for every candidate row before the top N (measured: +60 percent on a broad search over 100,000 assets, issue #770). The label is
    /// null for a caller without <c>Matter.BeManager</c>.
    /// </summary>
    private async Task<List<(T Item, bool? Mine)>> PageWithLabelAsync<T>(IQueryable<T> page, Func<T, int> keyOf, bool clientKey, CancellationToken ct)
    {
        var items = await page.ToListAsync(ct);
        var mine = MyMatterIds();
        if (mine is null || items.Count == 0)
            return [.. items.Select(i => (i, (bool?)null))];

        var keys = items.Select(keyOf).Distinct().ToList();
        var managedKeys = clientKey
            ? await ManagedClientMatters().Where(m => keys.Contains(m.ClientId)).Select(m => m.ClientId).Distinct().ToListAsync(ct)
            : await mine.Where(id => keys.Contains(id)).ToListAsync(ct);
        var set = managedKeys.ToHashSet();
        return [.. items.Select(i => (i, (bool?)set.Contains(keyOf(i))))];
    }

    // ---- rows

    private sealed class TaskMatter
    {
        public WorkTask Task { get; init; } = null!;

        public Matter Matter { get; init; } = null!;
    }

    private sealed class AssetMatter
    {
        public Asset Asset { get; init; } = null!;

        public Matter Matter { get; init; } = null!;
    }

    private sealed class ClientRow
    {
        public int Id { get; init; }

        public string Number { get; init; } = string.Empty;

        public string Name { get; init; } = string.Empty;

        public bool IsActive { get; init; }

        public int Rank { get; init; }
    }

    private sealed class MatterRow
    {
        public int Id { get; init; }

        public string Ref { get; init; } = string.Empty;

        public string Name { get; init; } = string.Empty;

        public int ClientId { get; init; }

        public string ClientName { get; init; } = string.Empty;

        public BusinessNumber ClientNumber { get; init; }

        public BusinessNumber MatterNumber { get; init; }

        public bool IsActive { get; init; }

        public bool IsSensitive { get; init; }
    }

    private sealed class ProjectRow
    {
        public int Id { get; init; }

        public string Name { get; init; } = string.Empty;

        public bool IsActive { get; init; }

        public int MatterId { get; init; }

        public string MatterRef { get; init; } = string.Empty;

        public string MatterName { get; init; } = string.Empty;

        public bool IsSensitive { get; init; }
    }

    private sealed class TaskRow
    {
        public long Id { get; init; }

        public string Number { get; init; } = string.Empty;

        public string Title { get; init; } = string.Empty;

        public string Requestor { get; init; } = string.Empty;

        public string? RequestorEmail { get; init; }

        public TaskStatusCode Status { get; init; }

        public int MatterId { get; init; }

        public int? ProjectId { get; init; }

        public int ClientId { get; init; }

        public string MatterRef { get; init; } = string.Empty;

        public string MatterName { get; init; } = string.Empty;

        public bool IsSensitive { get; init; }
    }

    private sealed class AssetRow
    {
        public int Id { get; init; }

        public string Name { get; init; } = string.Empty;

        public string? ExternalReference { get; init; }

        public string TypeName { get; init; } = string.Empty;

        public int AssetTypeId { get; init; }

        public bool IsActive { get; init; }

        public int MatterId { get; init; }

        public string MatterRef { get; init; } = string.Empty;

        public string MatterName { get; init; } = string.Empty;

        public bool IsSensitive { get; init; }
    }
}

/// <summary>The validated advanced-search filters for one type (a filter that does not apply to the type is rejected, not ignored).</summary>
public sealed record AdvancedFilter(
    int? Client,
    int? Matter,
    int? Project,
    int? AssetType,
    bool? Active,
    bool? Sensitive,
    IReadOnlyList<TaskStatusCode> Statuses,
    string? Requestor)
{
    private static readonly IReadOnlyDictionary<string, string[]> Applies = new Dictionary<string, string[]>
    {
        [SearchTypes.Client] = ["active"],
        [SearchTypes.Matter] = ["client", "active", "sensitive"],
        [SearchTypes.Project] = ["matter", "active"],
        [SearchTypes.Task] = ["client", "matter", "project", "status", "requestor"],
        [SearchTypes.Asset] = ["matter", "assetType", "active"],
    };

    public static Result<AdvancedFilter> From(string type, AdvancedSearchQuery q)
    {
        var supplied = new Dictionary<string, bool>
        {
            ["client"] = q.Client is not null,
            ["matter"] = q.Matter is not null,
            ["project"] = q.Project is not null,
            ["assetType"] = q.AssetType is not null,
            ["active"] = q.Active is not null,
            ["sensitive"] = q.Sensitive is not null,
            ["status"] = q.Status is { Length: > 0 },
            ["requestor"] = !string.IsNullOrWhiteSpace(q.Requestor),
        };

        var misplaced = supplied.Where(s => s.Value && !Applies[type].Contains(s.Key)).Select(s => s.Key).FirstOrDefault();
        if (misplaced is not null)
            return Error.Validation(misplaced, "FILTER_NOT_APPLICABLE", $"The '{misplaced}' filter does not apply to {type} searches. Allowed: {string.Join(", ", Applies[type])}.");

        var statuses = new List<TaskStatusCode>();
        foreach (var code in (q.Status ?? []).SelectMany(s => FilterParsing.SplitList(s)))
        {
            if (!TaskStatusCodeExtensions.TryParse(code.ToUpperInvariant(), out var status))
                return Error.Validation("status", "UNKNOWN_STATUS", $"Unknown status '{code}'.");
            statuses.Add(status);
        }

        var requestor = string.IsNullOrWhiteSpace(q.Requestor) ? null : q.Requestor.Trim();
        return new AdvancedFilter(q.Client, q.Matter, q.Project, q.AssetType, q.Active, q.Sensitive, statuses, requestor);
    }
}
