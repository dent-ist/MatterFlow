using System.Data;
using MatterFlow.Assets.Domain;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.ValueObjects;
using MatterFlow.WorkManagement.Domain;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Search.Application.Queries;

/// <summary>
/// Read side of global and advanced search: plain SQL Server queries (architecture 14), one per object type, never a search engine. Each type is
/// searched only when the caller holds its View permission. Matching is number-aware (padded or unpadded) and every row carries the relevance tier it
/// matched at (<see cref="SearchRanking"/>); hits sort by tier, then a stable per-type key. User text only ever reaches SQL as an escaped LIKE parameter.
/// </summary>
public sealed class SearchService(DbContext db, IPermissionChecker permissions)
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

        var groups = new List<SearchGroup>();
        foreach (var type in SearchTypes.All.Where(t => requested.Value.Contains(t) && permissions.Has(ViewPermission[t])))
        {
            // One extra row tells whether the cap cut something off, without a count over a substring scan.
            var hits = await HitsAsync(type, term.Value, filter: null, skip: 0, take: limit + 1, ct);
            groups.Add(new SearchGroup(type, hits.Take(limit).ToList(), hits.Count > limit));
        }

        return new SearchResponse(term.Value.Text, term.Value.Normalized, groups);
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

    private Task<int> CountAsync(string type, SearchTerm? term, AdvancedFilter filter, CancellationToken ct) => type switch
    {
        SearchTypes.Client => ClientRows(term, filter).CountAsync(ct),
        SearchTypes.Matter => MatterRanked(term, filter).CountAsync(ct),
        SearchTypes.Project => ProjectRanked(term, filter).CountAsync(ct),
        SearchTypes.Task => TaskRanked(term, filter).CountAsync(ct),
        _ => AssetRanked(term, filter).CountAsync(ct),
    };

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
        var rows = await ClientRows(term, filter).OrderBy(r => r.Rank).ThenBy(r => r.Name).ThenBy(r => r.Id).Skip(skip).Take(take).ToListAsync(ct);
        return [.. rows.Select(r => new SearchHit(SearchTypes.Client, r.Id, r.Number, r.Name, null, $"/clients/{r.Id}", false, null, null, r.IsActive, null))];
    }

    // Matters

    private IQueryable<Ranked<MatterRow>> MatterRanked(SearchTerm? term, AdvancedFilter? filter)
    {
        var rows =
            from m in db.Set<Matter>().AsNoTracking()
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
        var rows = await MatterRanked(term, filter).OrderBy(r => r.Rank).ThenBy(r => r.Item.Ref).ThenBy(r => r.Item.Id).Skip(skip).Take(take).ToListAsync(ct);
        return
        [
            .. rows.Select(r => new SearchHit(
                SearchTypes.Matter, r.Item.Id, r.Item.Ref, r.Item.Name, r.Item.ClientName, $"/matters/{r.Item.Id}",
                r.Item.IsSensitive, r.Item.Ref, r.Item.Name, r.Item.IsActive, null)),
        ];
    }

    // Projects

    private IQueryable<Ranked<ProjectRow>> ProjectRanked(SearchTerm? term, AdvancedFilter? filter)
    {
        var rows =
            from p in db.Set<Project>().AsNoTracking()
            join m in db.Set<Matter>().AsNoTracking() on p.MatterId equals m.Id
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
        var rows = await ProjectRanked(term, filter).OrderBy(r => r.Rank).ThenBy(r => r.Item.Name).ThenBy(r => r.Item.Id).Skip(skip).Take(take).ToListAsync(ct);
        return
        [
            .. rows.Select(r => new SearchHit(
                SearchTypes.Project, r.Item.Id, null, r.Item.Name, ShowMatter ? $"{r.Item.MatterRef} {r.Item.MatterName}" : null, $"/projects/{r.Item.Id}",
                r.Item.IsSensitive, ShowMatter ? r.Item.MatterRef : null, ShowMatter ? r.Item.MatterName : null, r.Item.IsActive, null)),
        ];
    }

    // Tasks

    private IQueryable<Ranked<TaskRow>> TaskRanked(SearchTerm? term, AdvancedFilter? filter)
    {
        var rows =
            from t in db.Set<WorkTask>().AsNoTracking()
            join m in db.Set<Matter>().AsNoTracking() on t.MatterId equals m.Id
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
            rows = rows.Where(r => r.Requestor.Contains(requestor) || (r.RequestorEmail != null && r.RequestorEmail.Contains(requestor)));

        if (term is null)
            return RankedQuery.Rank(rows, [], requireMatch: false);

        var tiers = new List<Tier<TaskRow>>();
        tiers.AddRange(RankedQuery.EqualTier<TaskRow>(SearchRanking.Exact, r => r.Number, term.TaskNumber));
        tiers.AddRange(RankedQuery.AnyLike<TaskRow>(SearchRanking.StartsWith, r => r.Number, [term.TaskPrefix]));
        tiers.AddRange(RankedQuery.TextTiers<TaskRow>(r => r.Title, term));
        tiers.AddRange(RankedQuery.TextTiers<TaskRow>(r => r.Requestor, term).Select(t => t with { Rank = Math.Max(t.Rank, SearchRanking.StartsWith) }));
        tiers.AddRange(RelatedTiers<TaskRow>(r => r.MatterRef, term));
        return RankedQuery.Rank(rows, tiers, requireMatch: true);
    }

    private async Task<List<SearchHit>> TaskHitsAsync(SearchTerm? term, AdvancedFilter? filter, int skip, int take, CancellationToken ct)
    {
        var rows = await TaskRanked(term, filter).OrderBy(r => r.Rank).ThenByDescending(r => r.Item.Id).Skip(skip).Take(take).ToListAsync(ct);
        return
        [
            .. rows.Select(r => new SearchHit(
                SearchTypes.Task, r.Item.Id, r.Item.Number, r.Item.Title, r.Item.Requestor, $"/tasks/{r.Item.Id}",
                r.Item.IsSensitive, ShowMatter ? r.Item.MatterRef : null, ShowMatter ? r.Item.MatterName : null, true, r.Item.Status.ToCode())),
        ];
    }

    // Assets

    private IQueryable<Ranked<AssetRow>> AssetRanked(SearchTerm? term, AdvancedFilter? filter)
    {
        var rows =
            from a in db.Set<Asset>().AsNoTracking()
            join m in db.Set<Matter>().AsNoTracking() on a.MatterId equals m.Id
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
        var rows = await AssetRanked(term, filter).OrderBy(r => r.Rank).ThenBy(r => r.Item.Name).ThenBy(r => r.Item.Id).Skip(skip).Take(take).ToListAsync(ct);
        return
        [
            .. rows.Select(r => new SearchHit(
                SearchTypes.Asset, r.Item.Id, r.Item.ExternalReference, r.Item.Name, r.Item.TypeName, $"/assets/{r.Item.Id}",
                r.Item.IsSensitive, ShowMatter ? r.Item.MatterRef : null, ShowMatter ? r.Item.MatterName : null, r.Item.IsActive, null)),
        ];
    }

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

    // ---- rows

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
