using System.Linq.Expressions;
using MatterFlow.Assets.Domain;
using MatterFlow.Identity.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The PM's asset list and the asset detail with its linked tasks (UI-03, #956). Assets of the scope's matters only (visible by construction); a hidden asset is a 404. Assets have NO comments: the
/// detail returns the linked tasks and, per task, its latest ORDINARY task comment (a plain-text excerpt; hold and cancel reason comments are not returned). Task fields come through the
/// task visibility rule (<see cref="VisibleTasks"/>).
/// </summary>
public sealed class MyMattersAssetsService(MyMattersScopeResolver scopes, DbContext db, IMatterVisibility visibility)
{
    private const int ExcerptLength = 160;

    private sealed class Row
    {
        public required int AssetId { get; init; }

        public required string Name { get; init; }

        public required string ExternalReference { get; init; }

        public required int ClientId { get; init; }

        public required string ClientName { get; init; }

        public required int MatterId { get; init; }

        public required string MatterRef { get; init; }

        public required string MatterName { get; init; }

        public required int AssetTypeId { get; init; }

        public required string AssetTypeName { get; init; }

        public string? IconKey { get; init; }

        public string? ColourKey { get; init; }

        public required DateTime CreatedAtUtc { get; init; }

        public DateTime? ModifiedAtUtc { get; init; }

        public required string StatusCode { get; init; }

        public required int StatusOrder { get; init; }

        public required int Linked { get; init; }

        public required int OpenLinked { get; init; }
    }

    public async Task<Result<PagedResult<MyMattersAssetRow>>> ListAsync(MyMattersAssetsQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var sort = string.IsNullOrWhiteSpace(query.Sort) ? "updated" : query.Sort.Trim();
        if (!MyMattersAssetsQuery.SortFields.Contains(sort))
            return Error.Validation("sort", "UNKNOWN_SORT", $"Unknown sort '{query.Sort}'. Allowed: {string.Join(", ", MyMattersAssetsQuery.SortFields)}.");
        var dir = string.IsNullOrWhiteSpace(query.Dir) ? (sort is "created" or "updated" ? "desc" : "asc") : query.Dir.Trim().ToLowerInvariant();
        if (dir is not ("asc" or "desc"))
            return Error.Validation("dir", "UNKNOWN_DIR", "dir must be asc or desc.");
        var statuses = new List<string>();
        foreach (var code in (query.Status ?? []).SelectMany(FilterParsing.SplitList))
        {
            var upper = code.Trim().ToUpperInvariant();
            if (!AssetDisposition.All.Contains(upper))
                return Error.Validation("status", "UNKNOWN_STATUS", $"Unknown status '{code}'. Allowed: {string.Join(", ", AssetDisposition.All)}.");
            if (!statuses.Contains(upper))
                statuses.Add(upper);
        }

        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;

        var rows = Rows(scope);
        if (query.Q?.Trim() is { Length: > 0 } q)
            rows = rows.Where(r => r.Name.Contains(q) || r.ExternalReference.Contains(q) || r.AssetTypeName.Contains(q) || r.MatterName.Contains(q));
        if (query.Name?.Trim() is { Length: > 0 } name)
            rows = rows.Where(r => r.Name.Contains(name));
        if (query.AssetTypeId is { Length: > 0 } types)
            rows = rows.Where(r => types.Contains(r.AssetTypeId));
        if (statuses.Count > 0)
            rows = rows.Where(r => statuses.Contains(r.StatusCode));
        if (query.CreatedFrom is { } cf)
        {
            var from = clock.StartOfDayUtc(cf);
            rows = rows.Where(r => r.CreatedAtUtc >= from);
        }

        if (query.CreatedTo is { } ct1)
        {
            var until = clock.EndOfDayUtc(ct1);
            rows = rows.Where(r => r.CreatedAtUtc < until);
        }

        if (query.UpdatedFrom is { } uf)
        {
            var from = clock.StartOfDayUtc(uf);
            rows = rows.Where(r => r.ModifiedAtUtc != null && r.ModifiedAtUtc >= from);
        }

        if (query.UpdatedTo is { } ut)
        {
            var until = clock.EndOfDayUtc(ut);
            rows = rows.Where(r => r.ModifiedAtUtc != null && r.ModifiedAtUtc < until);
        }

        var total = await rows.CountAsync(ct);
        var desc = dir == "desc";
        var ordered = sort switch
        {
            "name" => Order(rows, r => r.Name, desc),
            "client" => Order(rows, r => r.ClientName, desc),
            "matter" => Order(rows, r => r.MatterRef, desc),
            "assetType" => Order(rows, r => r.AssetTypeName, desc),
            "created" => Order(rows, r => r.CreatedAtUtc, desc),
            "status" => Order(rows, r => r.StatusOrder, desc),
            "linkedTasks" => Order(rows, r => r.Linked, desc),
            _ => Order(rows, r => r.ModifiedAtUtc ?? r.CreatedAtUtc, desc),
        };
        var page = await ordered.ThenBy(r => r.AssetId).Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToListAsync(ct);
        var items = page.Select(r => new MyMattersAssetRow(
            r.AssetId, r.Name, r.ClientId, r.ClientName, r.MatterId, r.MatterRef, r.MatterName, r.AssetTypeId, r.AssetTypeName,
            DateTime.SpecifyKind(r.CreatedAtUtc, DateTimeKind.Utc), r.ModifiedAtUtc is { } m ? DateTime.SpecifyKind(m, DateTimeKind.Utc) : null, r.StatusCode, r.Linked, r.OpenLinked, r.IconKey, r.ColourKey)).ToList();
        return new PagedResult<MyMattersAssetRow>(items, total, query.Page, query.PageSize);
    }

    public async Task<Result<MyMattersAssetDetail>> GetAsync(int assetId, MyMattersQuery query, CancellationToken ct)
    {
        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var clock = scope.Clock;

        var row = await Rows(scope).Where(r => r.AssetId == assetId).SingleOrDefaultAsync(ct);
        if (row is null)
            return Error.NotFound("Asset not found.");

        var asset = await db.Set<Asset>().AsNoTracking().Where(a => a.Id == assetId).Select(a => new { a.Description, a.CreatedByUserId }).SingleAsync(ct);
        var createdBy = asset.CreatedByUserId is { } uid ? await db.Set<AppUser>().AsNoTracking().Where(u => u.Id == uid).Select(u => u.DisplayName).FirstOrDefaultAsync(ct) : null;

        // The linked tasks through the task visibility rule; the owner's "latest task comment" is the newest ordinary, not deleted comment of each.
        var visibleTasks = VisibleTasks.Of(db, visibility);
        var links = await (from l in db.Set<TaskAsset>().AsNoTracking().Where(l => l.AssetId == assetId)
                           join t in visibleTasks on l.TaskId equals t.Id
                           select new
                           {
                               t.Id,
                               t.Number,
                               t.Title,
                               t.Status,
                               t.DueDate,
                               t.DueAtUtc,
                               t.AssignedUserId,
                           }).ToListAsync(ct);
        var taskIds = links.Select(l => l.Id).ToList();
        var assigneeIds = links.Where(l => l.AssignedUserId != null).Select(l => l.AssignedUserId!.Value).Distinct().ToList();
        var names = assigneeIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => assigneeIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);

        var latest = new Dictionary<long, (long Id, int Author, DateTime At, string Html)>();
        if (taskIds.Count > 0)
        {
            var comments = await db.Set<TaskComment>().AsNoTracking()
                .Where(c => taskIds.Contains(c.TaskId) && !c.IsDeleted && c.Purpose == TaskCommentPurpose.Normal)
                .GroupBy(c => c.TaskId)
                .Select(g => g.OrderByDescending(c => c.CreatedAtUtc).ThenByDescending(c => c.Id).Select(c => new { c.Id, c.TaskId, c.AuthorUserId, c.CreatedAtUtc, c.BodyHtml }).First())
                .ToListAsync(ct);
            foreach (var c in comments)
                latest[c.TaskId] = (c.Id, c.AuthorUserId, c.CreatedAtUtc, c.BodyHtml);
        }

        var authorIds = latest.Values.Select(v => v.Author).Distinct().ToList();
        var authors = authorIds.Count == 0 ? [] : await db.Set<AppUser>().AsNoTracking().Where(u => authorIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);

        var tasks = links
            .OrderBy(l => l.DueDate == null ? 1 : 0).ThenBy(l => l.DueDate).ThenBy(l => l.Id)
            .Select(l => new MyMattersLinkedTask(
                l.Id,
                l.Number,
                l.Title,
                l.Status.ToCode(),
                StatusLabel(l.Status),
                l.DueDate,
                TaskQueueRules.IsOverdue(l.Status, l.DueDate, l.DueAtUtc, clock) && l.Status != TaskStatusCode.OnHold,
                l.AssignedUserId is { } a ? names.GetValueOrDefault(a) : null,
                latest.TryGetValue(l.Id, out var c)
                    ? new MyMattersLatestComment(c.Id, authors.GetValueOrDefault(c.Author) ?? "Unknown", DateTime.SpecifyKind(c.At, DateTimeKind.Utc), Excerpt(c.Html))
                    : null))
            .ToList();

        return new MyMattersAssetDetail(
            row.AssetId, row.Name, row.ClientId, row.ClientName, row.MatterId, row.MatterRef, row.MatterName, row.AssetTypeId, row.AssetTypeName,
            asset.Description, string.IsNullOrEmpty(row.ExternalReference) ? null : row.ExternalReference,
            DateTime.SpecifyKind(row.CreatedAtUtc, DateTimeKind.Utc), createdBy, row.ModifiedAtUtc is { } m ? DateTime.SpecifyKind(m, DateTimeKind.Utc) : null, row.StatusCode, tasks, row.IconKey, row.ColourKey);
    }

    private IQueryable<Row> Rows(MyMattersScope scope)
    {
        var open = new[] { TaskStatusCode.New, TaskStatusCode.InProgress, TaskStatusCode.OnHold };
        return from a in db.Set<Asset>().AsNoTracking()
               join m in scope.Matters on a.MatterId equals m.Id
               join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
               join t in db.Set<AssetType>().AsNoTracking() on a.AssetTypeId equals t.Id
               select new Row
               {
                   AssetId = a.Id,
                   Name = a.DisplayName,
                   ExternalReference = a.ExternalReference ?? string.Empty,
                   ClientId = c.Id,
                   ClientName = c.Name,
                   MatterId = m.Id,
                   MatterRef = m.MatterRef,
                   MatterName = m.Name,
                   AssetTypeId = t.Id,
                   AssetTypeName = t.Name,
                   IconKey = t.IconKey,
                   ColourKey = t.ColourKey,
                   CreatedAtUtc = a.CreatedAtUtc,
                   ModifiedAtUtc = a.ModifiedAtUtc,
                   StatusCode = a.DispositionCode,
                   StatusOrder = a.DispositionCode == AssetDisposition.Active ? 0 : a.DispositionCode == AssetDisposition.Inactive ? 1 : a.DispositionCode == AssetDisposition.PendingDisposition ? 2 : 3,
                   Linked = db.Set<TaskAsset>().Count(l => l.AssetId == a.Id),
                   OpenLinked = (from l in db.Set<TaskAsset>()
                                 join tk in db.Set<WorkTask>() on l.TaskId equals tk.Id
                                 where l.AssetId == a.Id && open.Contains(tk.Status)
                                 select 1).Count(),
               };
    }

    private static IOrderedQueryable<Row> Order<TKey>(IQueryable<Row> rows, Expression<Func<Row, TKey>> key, bool descending) =>
        descending ? rows.OrderByDescending(key) : rows.OrderBy(key);

    private static string StatusLabel(TaskStatusCode status) => status switch
    {
        TaskStatusCode.New => "New",
        TaskStatusCode.InProgress => "In Progress",
        TaskStatusCode.OnHold => "On Hold",
        TaskStatusCode.Completed => "Completed",
        _ => "Cancelled",
    };

    private static string Excerpt(string html)
    {
        var text = CommentHtml.ToPlainText(html).Trim();
        return text.Length <= ExcerptLength ? text : text[..(ExcerptLength - 1)].TrimEnd() + "…";
    }
}
