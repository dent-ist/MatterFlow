using System.Globalization;
using LptHub.Audit.Contracts;
using LptHub.Productions.Domain;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Paging;
using LptHub.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Productions.Application;

/// <summary>
/// Productions of a matter as a simple managed list (owner decision, addendum AQ item 8): create, edit, delete, comments and a history of who changed what. There is no status workflow,
/// no QC and no Bates overlap check. The spec of a production must be an active spec of the SAME matter; a retired spec stays on productions that already use it unchanged.
/// </summary>
public sealed class ProductionService(DbContext db, IAuditWriter audit, ProductionAccess access, IAuditReader auditReader, ICurrentUser currentUser)
{
    public const string ObjectType = nameof(Production);
    public const string CreatedEvent = "PRODUCTION_CREATED";
    public const string DeletedEvent = "PRODUCTION_DELETED";
    public const string CommentAddedEvent = "PRODUCTION_COMMENT_ADDED";
    public const string CommentEditedEvent = "PRODUCTION_COMMENT_EDITED";
    public const string CommentDeletedEvent = "PRODUCTION_COMMENT_DELETED";

    public static readonly string[] SortFields = ["name", "volume", "direction", "party", "bates", "docs", "pages", "date", "updatedAt", "createdAt"];

    public async Task<Result<PagedResult<ProductionResponse>>> ListAsync(ProductionListQuery query, CancellationToken ct)
    {
        if (query.MatterId is not { } matterId)
            return Error.Validation("matterId", "REQUIRED", "matterId is required.");
        if (query.Direction is { } direction && !ProductionDirection.All.Contains(direction, StringComparer.Ordinal))
            return Error.Validation("direction", "INVALID", "direction must be OUT or IN.");

        var paging = ProductionSupport.PagingOf(query.Page, query.PageSize, query.Sort, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        if (await access.FindVisibleMatterAsync(matterId, ct) is null)
            return ProductionSupport.NotFound("Matter");

        var productions = access.Visible(db.Set<Production>().AsNoTracking(), p => p.MatterId).Where(p => p.MatterId == matterId);
        if (query.Direction is { } dir)
            productions = productions.Where(p => p.DirectionCode == dir);
        if (query.ProductionSpecId is { } specId)
            productions = productions.Where(p => p.ProductionSpecId == specId);
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var q = query.Q.Trim();
            productions = productions.Where(p =>
                p.Name.Contains(q)
                || (p.VolumeNo != null && p.VolumeNo.Contains(q))
                || (p.PartyName != null && p.PartyName.Contains(q))
                || (p.BatesBegin != null && p.BatesBegin.Contains(q))
                || (p.BatesEnd != null && p.BatesEnd.Contains(q))
                || (p.Notes != null && p.Notes.Contains(q)));
        }

        var (page, sort) = paging.Value;
        var total = await productions.CountAsync(ct);
        IOrderedQueryable<Production>? ordered = null;
        foreach (var field in sort)
        {
            var desc = field.Descending;
            ordered = field.Field switch
            {
                "name" => Order(productions, ordered, p => p.Name, desc),
                "volume" => Order(productions, ordered, p => p.VolumeNo, desc),
                "direction" => Order(productions, ordered, p => p.DirectionCode, desc),
                "party" => Order(productions, ordered, p => p.PartyName, desc),
                "bates" => Order(productions, ordered, p => p.BatesBegin, desc),
                "docs" => Order(productions, ordered, p => p.DocCount, desc),
                "pages" => Order(productions, ordered, p => p.PageCount, desc),
                "date" => Order(productions, ordered, p => p.DeliveredOrDueOn, desc),
                "updatedAt" => Order(productions, ordered, p => p.ModifiedAtUtc ?? p.CreatedAtUtc, desc),
                _ => Order(productions, ordered, p => p.CreatedAtUtc, desc),
            };
        }

        // Default: newest date first (undated last), then name.
        var ordering = ordered ?? productions.OrderByDescending(p => p.DeliveredOrDueOn).ThenBy(p => p.Name);
        var rows = await ordering.ThenBy(p => p.Id).Skip(page.Skip).Take(page.PageSize).ToListAsync(ct);
        return new PagedResult<ProductionResponse>(await ToResponsesAsync(rows, ct), total, page.Page, page.PageSize);
    }

    private static IOrderedQueryable<Production> Order<TKey>(IQueryable<Production> source, IOrderedQueryable<Production>? ordered, System.Linq.Expressions.Expression<Func<Production, TKey>> key, bool descending) =>
        ordered is null
            ? (descending ? source.OrderByDescending(key) : source.OrderBy(key))
            : (descending ? ordered.ThenByDescending(key) : ordered.ThenBy(key));

    public async Task<Result<ProductionSummaryResponse>> SummaryAsync(int matterId, CancellationToken ct)
    {
        if (await access.FindVisibleMatterAsync(matterId, ct) is null)
            return ProductionSupport.NotFound("Matter");

        var productions = await db.Set<Production>().CountAsync(p => p.MatterId == matterId, ct);
        var specs = await db.Set<ProductionSpec>().CountAsync(s => s.MatterId == matterId && s.StatusCode == SpecStatus.Active, ct);
        return new ProductionSummaryResponse(productions, specs);
    }

    public async Task<Result<ProductionResponse>> GetAsync(int id, CancellationToken ct)
    {
        var production = await access.Visible(db.Set<Production>().AsNoTracking(), p => p.MatterId).SingleOrDefaultAsync(p => p.Id == id, ct);
        return production is null ? ProductionSupport.NotFound("Production") : (await ToResponsesAsync([production], ct))[0];
    }

    public async Task<Result<ProductionResponse>> CreateAsync(CreateProductionRequest request, CancellationToken ct)
    {
        var matter = await access.FindVisibleMatterAsync(request.MatterId, ct);
        if (matter is null)
            return Error.Validation("matterId", "NOT_FOUND", "Select a matter.");
        if (!matter.IsActive)
            return Error.Conflict(ErrorCodes.MatterInactive, $"Matter {matter.MatterRef} is inactive; productions can't be added to it.");

        var production = new Production { MatterId = matter.MatterId };
        var valid = Validate(request);
        if (valid.IsFailure)
            return valid.Error!;

        Apply(production, request);
        var spec = await CheckSpecAsync(production, previousSpecId: null, ct);
        if (spec.IsFailure)
            return spec.Error!;

        db.Set<Production>().Add(production);
        audit.Write(new AuditEntry
        {
            EventType = CreatedEvent,
            ObjectType = ObjectType,
            ObjectIdFactory = () => ProductionSupport.Id(production.Id),
            MatterId = production.MatterId,
            Summary = production.Name,
        });
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(production.Id, ct);
    }

    public async Task<Result<ProductionResponse>> UpdateAsync(int id, UpdateProductionRequest request, CancellationToken ct)
    {
        var production = await access.FindTrackedAsync<Production>(p => p.MatterId, p => p.Id == id, ct);
        if (production is null)
            return ProductionSupport.NotFound("Production");

        var version = ProductionSupport.CheckRowVersion(production.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var valid = Validate(request);
        if (valid.IsFailure)
            return valid.Error!;

        var before = Snapshot(production);
        var previousSpec = production.ProductionSpecId;
        Apply(production, request);
        var spec = await CheckSpecAsync(production, previousSpec, ct);
        if (spec.IsFailure)
            return spec.Error!;

        var after = Snapshot(production);
        if (previousSpec != production.ProductionSpecId)
        {
            // History shows spec names, not ids.
            var ids = new[] { previousSpec, production.ProductionSpecId }.OfType<int>().ToList();
            var names = ids.Count == 0 ? [] : await db.Set<ProductionSpec>().AsNoTracking().Where(s => ids.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name, ct);
            before["Spec"] = previousSpec is { } p && names.TryGetValue(p, out var pn) ? pn : null;
            after["Spec"] = production.ProductionSpecId is { } n && names.TryGetValue(n, out var nn) ? nn : null;
        }

        ProductionSupport.WriteFieldChanges(audit, ObjectType, ProductionSupport.Id(production.Id), production.MatterId, before, after);
        ProductionSupport.TrackOriginalRowVersion(db, production, request.RowVersion);
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(id, ct);
    }

    public async Task<Result> DeleteAsync(int id, string? rowVersion, CancellationToken ct)
    {
        var production = await access.FindTrackedAsync<Production>(p => p.MatterId, p => p.Id == id, ct);
        if (production is null)
            return ProductionSupport.NotFound("Production");
        if (string.IsNullOrWhiteSpace(rowVersion))
            return Error.Validation("rowVersion", "REQUIRED", "rowVersion is required.");

        var version = ProductionSupport.CheckRowVersion(production.RowVersion, rowVersion);
        if (version.IsFailure)
            return version.Error!;

        audit.Write(new AuditEntry
        {
            EventType = DeletedEvent,
            ObjectType = ObjectType,
            ObjectId = ProductionSupport.Id(production.Id),
            MatterId = production.MatterId,
            Summary = production.Name,
        });
        ProductionSupport.TrackOriginalRowVersion(db, production, rowVersion);
        db.Set<Production>().Remove(production);
        return await SaveAsync(ct);
    }

    public async Task<Result<ProductionHistoryResponse>> HistoryAsync(int id, ProductionHistoryQuery query, CancellationToken ct)
    {
        var production = await access.Visible(db.Set<Production>().AsNoTracking(), p => p.MatterId).SingleOrDefaultAsync(p => p.Id == id, ct);
        if (production is null)
            return ProductionSupport.NotFound("Production");

        return await ProductionHistory.ReadAsync(auditReader, access, ObjectType, ProductionSupport.Id(id), query, valueNames: null, ct);
    }

    // ---------------------------------------------------------------- comments

    public async Task<Result<IReadOnlyList<ProductionCommentResponse>>> ListCommentsAsync(int productionId, CancellationToken ct)
    {
        if (!await access.Visible(db.Set<Production>().AsNoTracking(), p => p.MatterId).AnyAsync(p => p.Id == productionId, ct))
            return ProductionSupport.NotFound("Production");

        var rows = await db.Set<ProductionComment>().AsNoTracking().Where(c => c.ProductionId == productionId).OrderBy(c => c.CreatedAtUtc).ThenBy(c => c.Id).ToListAsync(ct);
        return Result<IReadOnlyList<ProductionCommentResponse>>.Success(await ToCommentResponsesAsync(rows, ct));
    }

    public async Task<Result<ProductionCommentResponse>> AddCommentAsync(int productionId, CreateProductionCommentRequest request, CancellationToken ct)
    {
        var production = await access.Visible(db.Set<Production>().AsNoTracking(), p => p.MatterId).SingleOrDefaultAsync(p => p.Id == productionId, ct);
        if (production is null)
            return ProductionSupport.NotFound("Production");

        var body = request.Body.Trim();
        if (body.Length == 0)
            return Error.Validation("body", "REQUIRED", "Enter a comment.");

        var comment = new ProductionComment { ProductionId = production.Id, MatterId = production.MatterId, Body = body };
        db.Set<ProductionComment>().Add(comment);
        audit.Write(new AuditEntry
        {
            EventType = CommentAddedEvent,
            ObjectType = ObjectType,
            ObjectId = ProductionSupport.Id(production.Id),
            MatterId = production.MatterId,
            Summary = Excerpt(body),
        });
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : (await ToCommentResponsesAsync([comment], ct))[0];
    }

    public async Task<Result<ProductionCommentResponse>> UpdateCommentAsync(int commentId, UpdateProductionCommentRequest request, CancellationToken ct)
    {
        var comment = await access.FindTrackedAsync<ProductionComment>(c => c.MatterId, c => c.Id == commentId, ct);
        if (comment is null)
            return ProductionSupport.NotFound("Comment");
        if (!IsAuthor(comment))
            return Error.Forbidden("You can edit only your own comments.", "NOT_COMMENT_AUTHOR");

        var version = ProductionSupport.CheckRowVersion(comment.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var body = request.Body.Trim();
        if (body.Length == 0)
            return Error.Validation("body", "REQUIRED", "Enter a comment.");

        comment.Body = body;
        audit.Write(new AuditEntry
        {
            EventType = CommentEditedEvent,
            ObjectType = ObjectType,
            ObjectId = ProductionSupport.Id(comment.ProductionId),
            MatterId = comment.MatterId,
            Summary = Excerpt(body),
        });
        ProductionSupport.TrackOriginalRowVersion(db, comment, request.RowVersion);
        var saved = await SaveAsync(ct);
        if (saved.IsFailure)
            return saved.Error!;

        var fresh = await db.Set<ProductionComment>().AsNoTracking().SingleAsync(c => c.Id == commentId, ct);
        return (await ToCommentResponsesAsync([fresh], ct))[0];
    }

    public async Task<Result> DeleteCommentAsync(int commentId, string? rowVersion, CancellationToken ct)
    {
        var comment = await access.FindTrackedAsync<ProductionComment>(c => c.MatterId, c => c.Id == commentId, ct);
        if (comment is null)
            return ProductionSupport.NotFound("Comment");
        if (!IsAuthor(comment))
            return Error.Forbidden("You can delete only your own comments.", "NOT_COMMENT_AUTHOR");
        if (string.IsNullOrWhiteSpace(rowVersion))
            return Error.Validation("rowVersion", "REQUIRED", "rowVersion is required.");

        var version = ProductionSupport.CheckRowVersion(comment.RowVersion, rowVersion);
        if (version.IsFailure)
            return version.Error!;

        audit.Write(new AuditEntry
        {
            EventType = CommentDeletedEvent,
            ObjectType = ObjectType,
            ObjectId = ProductionSupport.Id(comment.ProductionId),
            MatterId = comment.MatterId,
            Summary = Excerpt(comment.Body),
        });
        ProductionSupport.TrackOriginalRowVersion(db, comment, rowVersion);
        db.Set<ProductionComment>().Remove(comment);
        return await SaveAsync(ct);
    }

    private bool IsAuthor(ProductionComment comment) => currentUser.UserId is { } me && comment.CreatedByUserId == me;

    private static string Excerpt(string text) => text.Length <= 200 ? text : text[..200] + "...";

    // ---------------------------------------------------------------- helpers

    private static Result Validate(ProductionInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Name))
            return Error.Validation("name", "REQUIRED", "Enter a name.");
        if (!ProductionDirection.All.Contains(input.Direction, StringComparer.Ordinal))
            return Error.Validation("direction", "INVALID", "Choose OUT (produced by us) or IN (received).");
        return Result.Success();
    }

    private static void Apply(Production p, ProductionInput input)
    {
        p.Name = input.Name.Trim();
        p.VolumeNo = ProductionSupport.Clean(input.VolumeNo);
        p.DirectionCode = input.Direction;
        p.PartyName = ProductionSupport.Clean(input.PartyName);
        p.ProductionSpecId = input.ProductionSpecId;
        p.BatesBegin = ProductionSupport.Clean(input.BatesBegin);
        p.BatesEnd = ProductionSupport.Clean(input.BatesEnd);
        p.DocCount = input.DocCount;
        p.PageCount = input.PageCount;
        p.DeliveredOrDueOn = input.DeliveredOrDueOn;
        p.Notes = ProductionSupport.Clean(input.Notes);
    }

    /// <summary>The spec must exist in the same matter and, when it is new on this production, be active. A retired spec that was already set may stay.</summary>
    private async Task<Result> CheckSpecAsync(Production production, int? previousSpecId, CancellationToken ct)
    {
        if (production.ProductionSpecId is not { } specId)
            return Result.Success();

        var spec = await db.Set<ProductionSpec>().AsNoTracking().Where(s => s.Id == specId && s.MatterId == production.MatterId)
            .Select(s => new { s.StatusCode }).SingleOrDefaultAsync(ct);
        if (spec is null)
            return Error.Validation("productionSpecId", "NOT_FOUND", "Choose a production spec of this matter.");
        if (!ProductionSpecRules.MayUse(spec.StatusCode, specId, previousSpecId))
            return Error.Conflict("SPEC_RETIRED", "That production spec is retired. Choose an active one.");
        return Result.Success();
    }

    private static Dictionary<string, string?> Snapshot(Production p) => new()
    {
        [nameof(Production.Name)] = p.Name,
        [nameof(Production.VolumeNo)] = p.VolumeNo,
        ["Direction"] = p.DirectionCode,
        [nameof(Production.PartyName)] = p.PartyName,
        [nameof(Production.BatesBegin)] = p.BatesBegin,
        [nameof(Production.BatesEnd)] = p.BatesEnd,
        [nameof(Production.DocCount)] = p.DocCount?.ToString(CultureInfo.InvariantCulture),
        [nameof(Production.PageCount)] = p.PageCount?.ToString(CultureInfo.InvariantCulture),
        [nameof(Production.DeliveredOrDueOn)] = p.DeliveredOrDueOn?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        [nameof(Production.Notes)] = p.Notes,
    };

    private async Task<Result> SaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return Result.Success();
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return ProductionSupport.ConcurrencyError();
        }
    }

    private async Task<IReadOnlyList<ProductionResponse>> ToResponsesAsync(IReadOnlyList<Production> rows, CancellationToken ct)
    {
        if (rows.Count == 0)
            return [];

        var specIds = rows.Select(r => r.ProductionSpecId).OfType<int>().Distinct().ToList();
        var specs = specIds.Count == 0
            ? []
            : await db.Set<ProductionSpec>().AsNoTracking().Where(s => specIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => (s.Name, s.StatusCode), ct);
        var ids = rows.Select(r => r.Id).ToList();
        var comments = await db.Set<ProductionComment>().AsNoTracking().Where(c => ids.Contains(c.ProductionId))
            .GroupBy(c => c.ProductionId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        var names = await access.NamesAsync(rows.SelectMany(r => new[] { r.CreatedByUserId, r.ModifiedByUserId }), ct);
        string? Name(int? userId) => userId is { } u && names.TryGetValue(u, out var n) ? n : null;

        return [.. rows.Select(r =>
        {
            (string Name, string Status)? spec = r.ProductionSpecId is { } s && specs.TryGetValue(s, out var found) ? found : null;
            return new ProductionResponse(
                r.Id,
                r.MatterId,
                r.Name,
                r.VolumeNo,
                r.DirectionCode,
                r.PartyName,
                r.ProductionSpecId,
                spec?.Name,
                spec?.Status,
                r.BatesBegin,
                r.BatesEnd,
                r.DocCount,
                r.PageCount,
                r.DeliveredOrDueOn,
                r.Notes,
                comments.GetValueOrDefault(r.Id),
                ProductionSupport.Encode(r.RowVersion),
                ProductionSupport.Utc(r.CreatedAtUtc),
                r.CreatedByUserId,
                Name(r.CreatedByUserId),
                ProductionSupport.Utc(r.ModifiedAtUtc),
                r.ModifiedByUserId,
                Name(r.ModifiedByUserId));
        })];
    }

    private async Task<IReadOnlyList<ProductionCommentResponse>> ToCommentResponsesAsync(IReadOnlyList<ProductionComment> rows, CancellationToken ct)
    {
        var names = await access.NamesAsync(rows.Select(r => r.CreatedByUserId), ct);
        return [.. rows.Select(c => new ProductionCommentResponse(
            c.Id,
            c.ProductionId,
            c.Body,
            ProductionSupport.Utc(c.CreatedAtUtc),
            c.CreatedByUserId,
            c.CreatedByUserId is { } u && names.TryGetValue(u, out var n) ? n : null,
            ProductionSupport.Utc(c.ModifiedAtUtc),
            IsAuthor(c),
            ProductionSupport.Encode(c.RowVersion)))];
    }
}
