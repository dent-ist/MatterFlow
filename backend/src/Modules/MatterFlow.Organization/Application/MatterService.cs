using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.ValueObjects;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

public sealed class MatterService(DbContext db, IAuditWriter audit, IMatterTaskGuard taskGuard, CustomFieldValues custom)
{
    public static readonly string[] SortFields = ["matterRef", "name", "clientNumber", "createdAt"];

    private static readonly Dictionary<string, Func<IQueryable<MatterRow>, bool, bool, IOrderedQueryable<MatterRow>>> Orderings = new()
    {
        ["matterRef"] = OrganizationSupport.By<MatterRow, string>(r => r.Matter.MatterRef),
        ["name"] = OrganizationSupport.By<MatterRow, string>(r => r.Matter.Name),
        ["clientNumber"] = OrganizationSupport.By<MatterRow, BusinessNumber>(r => r.Matter.ClientNumber),
        ["createdAt"] = OrganizationSupport.By<MatterRow, DateTime>(r => r.Matter.CreatedAtUtc),
    };

    public async Task<Result<PagedResult<MatterResponse>>> ListAsync(MatterListQuery query, CancellationToken ct)
    {
        var paging = OrganizationSupport.PagingOf(query, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        var (page, sort) = paging.Value;
        var rows = Rows();
        if (query.ClientId is { } clientId)
            rows = rows.Where(r => r.Matter.ClientId == clientId);
        if (query.IsActive is { } active)
            rows = rows.Where(r => r.Matter.IsActive == active);
        if (query.IsSensitive is { } sensitive)
            rows = rows.Where(r => r.Matter.IsSensitive == sensitive);

        var q = query.Q?.Trim();
        if (!string.IsNullOrEmpty(q))
        {
            if (TryParsePair(q, out _, out _))
            {
                rows = ApplyMatterRef(rows, q);
            }
            else if (BusinessNumber.TryParse(q, out var number))
            {
                rows = rows.Where(r => r.Matter.ClientNumber == number || r.Matter.MatterNumber == number
                    || r.Matter.Name.Contains(q) || r.ClientName.Contains(q));
            }
            else
            {
                rows = rows.Where(r => r.Matter.Name.Contains(q) || r.ClientName.Contains(q));
            }
        }

        // Column filters (each box searches its own column, parameterised Contains; % and _ are literal).
        if (query.MatterRef?.Trim() is { Length: > 0 } matterRef)
            rows = ApplyMatterRef(rows, matterRef);
        if (query.Name?.Trim() is { Length: > 0 } name)
            rows = rows.Where(r => r.Matter.Name.Contains(name));
        if (query.Client?.Trim() is { Length: > 0 } client)
        {
            // The Client number is a value-converted column; the first 5 characters of the computed Matter reference are the same text.
            rows = IsDigits(client)
                ? rows.Where(r => r.ClientName.Contains(client) || r.Matter.MatterRef.Substring(0, BusinessNumber.Length).Contains(client))
                : rows.Where(r => r.ClientName.Contains(client));
        }

        var total = await rows.CountAsync(ct);
        var items = await OrganizationSupport.ApplySort(rows, sort.Count == 0 ? [new SortField("matterRef", false)] : sort, Orderings, r => r.Matter.Id)
            .Skip(page.Skip)
            .Take(page.PageSize)
            .ToListAsync(ct);

        return OrganizationSupport.Page(items.Select(r => ToResponse(r, null)).ToList(), total, page);
    }

    public async Task<Result<MatterResponse>> GetAsync(int id, CancellationToken ct) => await GetAsync(id, [], ct);

    private async Task<Result<MatterResponse>> GetAsync(int id, IReadOnlyList<string> dropped, CancellationToken ct)
    {
        var row = await Rows().Where(r => r.Matter.Id == id).SingleOrDefaultAsync(ct);
        if (row is null)
            return OrganizationSupport.NotFound("Matter");

        return ToResponse(row, await taskGuard.CountOpenTasksAsync(id, ct), await custom.ReadAsync(CustomFieldTarget.Matter, id, ct), dropped);
    }

    /// <summary>
    /// The Matter reference column filter. A typed pair (<c>343-12</c>) finds the exact reference and, as you type, references whose unpadded
    /// number starts with what was typed (<c>343-99</c> also finds 00343-99999); anything else is a fragment of the reference.
    /// </summary>
    private static IQueryable<MatterRow> ApplyMatterRef(IQueryable<MatterRow> rows, string text)
    {
        if (!TryParsePair(text, out var clientNumber, out var matterNumber))
            return rows.Where(r => r.Matter.MatterRef.Contains(text));

        var second = text[(text.IndexOf('-', StringComparison.Ordinal) + 1)..].Trim();
        if (second.Length == BusinessNumber.Length)
            return rows.Where(r => r.Matter.ClientNumber == clientNumber && r.Matter.MatterNumber == matterNumber); // a full padded reference is exact

        var typed = second.TrimStart('0');
        var prefixes = Enumerable.Range(0, BusinessNumber.Length - typed.Length + 1)
            .Select(zeros => clientNumber.Value + "-" + new string('0', zeros) + typed)
            .Concat(Enumerable.Repeat("#", BusinessNumber.Length))
            .Take(BusinessNumber.Length)
            .ToArray(); // "#" never matches; fixed arity keeps the query translatable
        return rows.Where(r => (r.Matter.ClientNumber == clientNumber && r.Matter.MatterNumber == matterNumber)
            || (typed.Length > 0 && (r.Matter.MatterRef.StartsWith(prefixes[0]) || r.Matter.MatterRef.StartsWith(prefixes[1])
                || r.Matter.MatterRef.StartsWith(prefixes[2]) || r.Matter.MatterRef.StartsWith(prefixes[3]) || r.Matter.MatterRef.StartsWith(prefixes[4]))));
    }

    internal static bool IsDigits(string text) => text.Length > 0 && text.All(c => c is >= '0' and <= '9');

    /// <summary>Resolves <c>343-12</c> / <c>00343-00012</c> to the Matter.</summary>
    public async Task<Result<MatterResponse>> LookupAsync(string? reference, CancellationToken ct)
    {
        if (!TryParsePair(reference, out var clientNumber, out var matterNumber))
            return Error.Validation("ref", "INVALID_REFERENCE", "Use a matter reference like 343-12 or 00343-00012.", ErrorCodes.InvalidNumberFormat);

        var row = await Rows().Where(r => r.Matter.ClientNumber == clientNumber && r.Matter.MatterNumber == matterNumber).SingleOrDefaultAsync(ct);
        return row is null
            ? OrganizationSupport.NotFound("Matter")
            : ToResponse(row, await taskGuard.CountOpenTasksAsync(row.Matter.Id, ct), await custom.ReadAsync(CustomFieldTarget.Matter, row.Matter.Id, ct), []);
    }

    public async Task<Result<MatterResponse>> CreateAsync(CreateMatterRequest request, CancellationToken ct)
    {
        var number = OrganizationSupport.ParseNumber(request.MatterNumber, "matterNumber");
        if (number.IsFailure)
            return number.Error!;

        var client = await db.Set<Client>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == request.ClientId, ct);
        if (client is null)
            return Error.Validation("clientId", "NOT_FOUND", "Select a client.");
        if (!client.IsActive)
        {
            return new Error(
                ErrorType.Conflict,
                ErrorCodes.ClientInactive,
                $"Client {client.ClientNumber} is inactive. Choose an active client.",
                new Dictionary<string, IReadOnlyList<FieldError>>
                {
                    ["clientId"] = [new FieldError(ErrorCodes.ClientInactive, $"Client {client.ClientNumber} is inactive. Choose an active client.")],
                });
        }

        var existing = await FindIdAsync(client.Id, number.Value, null, ct);
        if (existing is not null)
            return DuplicateNumber(client.ClientNumber, number.Value, existing);

        var plan = await custom.PlanCreateAsync(CustomFieldTarget.Matter, request.FormValues, ct);
        if (plan.IsFailure)
            return plan.Error!;

        var matter = new Matter
        {
            ClientId = client.Id,
            ClientNumber = client.ClientNumber,
            MatterNumber = number.Value,
            Name = request.Name.Trim(),
            IsSensitive = request.IsSensitive,
        };
        db.Set<Matter>().Add(matter);
        audit.Write(new AuditEntry
        {
            EventType = OrganizationAuditEvents.MatterCreated,
            ObjectType = nameof(Matter),
            ObjectIdFactory = () => matter.Id.ToString(CultureInfo.InvariantCulture),
            NewValue = $"{client.ClientNumber}-{number.Value}",
            Summary = $"Matter {client.ClientNumber}-{number.Value} created.",
        });

        IReadOnlyList<string> dropped = [];
        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (OrganizationSupport.IsUniqueViolation(ex, OrganizationSupport.MatterNumberUnique))
            {
                db.ChangeTracker.Clear();
                return DuplicateNumber(client.ClientNumber, number.Value, await FindIdAsync(client.Id, number.Value, null, ct));
            }
            catch (DbUpdateException ex) when (OrganizationSupport.IsForeignKeyViolation(ex))
            {
                db.ChangeTracker.Clear();
                return OrganizationSupport.ConcurrencyError(); // the Client's number changed between the read and the insert
            }

            if (plan.Value is { } formPlan)
            {
                var saved = await custom.SaveAsync(CustomFieldTarget.Matter, matter.Id, matter.Id, formPlan, ct);
                if (saved.IsFailure)
                {
                    db.ChangeTracker.Clear();
                    return saved.Error!;
                }

                dropped = saved.Value;
            }

            await transaction.CommitAsync(ct);
        }

        return await GetAsync(matter.Id, dropped, ct);
    }

    public async Task<Result<MatterResponse>> UpdateAsync(int id, UpdateMatterRequest request, CancellationToken ct)
    {
        var matter = await db.Set<Matter>().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (matter is null)
            return OrganizationSupport.NotFound("Matter");

        var version = OrganizationSupport.CheckRowVersion(matter.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var plan = await custom.PlanUpdateAsync(CustomFieldTarget.Matter, id, request.FormValues, ct);
        if (plan.IsFailure)
            return plan.Error!;

        matter.Name = request.Name.Trim();
        matter.IsSensitive = request.IsSensitive;
        OrganizationSupport.TrackOriginalRowVersion(db, matter, request.RowVersion);

        IReadOnlyList<string> dropped = [];
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            if (plan.Value is { } formPlan)
            {
                var saved = await custom.SaveAsync(CustomFieldTarget.Matter, id, id, formPlan, ct);
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
            return OrganizationSupport.ConcurrencyError();
        }

        return await GetAsync(id, dropped, ct);
    }

    /// <summary>Changes the Matter number (needs Matter.EditNumber at the API). Writes MATTER_NUMBER_CHANGED.</summary>
    public async Task<Result<MatterResponse>> ChangeNumberAsync(int id, ChangeNumberRequest request, CancellationToken ct)
    {
        var number = OrganizationSupport.ParseNumber(request.Number, "number");
        if (number.IsFailure)
            return number.Error!;

        var matter = await db.Set<Matter>().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (matter is null)
            return OrganizationSupport.NotFound("Matter");

        var version = OrganizationSupport.CheckRowVersion(matter.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        if (matter.MatterNumber == number.Value)
            return await GetAsync(id, ct);

        var existing = await FindIdAsync(matter.ClientId, number.Value, id, ct);
        if (existing is not null)
            return DuplicateNumber(matter.ClientNumber, number.Value, existing, "number");

        var old = matter.MatterNumber;
        matter.MatterNumber = number.Value;
        OrganizationSupport.TrackOriginalRowVersion(db, matter, request.RowVersion);
        audit.Write(new AuditEntry
        {
            EventType = OrganizationAuditEvents.MatterNumberChanged,
            ObjectType = nameof(Matter),
            ObjectId = id.ToString(CultureInfo.InvariantCulture),
            MatterId = id,
            FieldKey = nameof(Matter.MatterNumber),
            OldValue = old.Value,
            NewValue = number.Value.Value,
            Summary = $"Matter number changed from {matter.ClientNumber}-{old} to {matter.ClientNumber}-{number.Value}.",
        });

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (OrganizationSupport.IsUniqueViolation(ex, OrganizationSupport.MatterNumberUnique))
        {
            db.ChangeTracker.Clear();
            return DuplicateNumber(matter.ClientNumber, number.Value, await FindIdAsync(matter.ClientId, number.Value, id, ct), "number");
        }

        return await GetAsync(id, ct);
    }

    /// <summary>
    /// Activates or deactivates. Deactivation is refused while any Task is not Completed or Cancelled (addendum B). The Matter row is
    /// locked for the duration so a concurrent Task create/reopen that takes the same lock cannot slip in (architecture 10, rule 3).
    /// </summary>
    public async Task<Result<MatterResponse>> SetActiveAsync(int id, SetActiveRequest request, CancellationToken ct)
    {
        await using var transaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;

        var matter = await db.Set<Matter>()
            .FromSql($"SELECT * FROM dbo.Matter WITH (UPDLOCK, ROWLOCK) WHERE MatterId = {id}")
            .SingleOrDefaultAsync(ct);
        if (matter is null)
            return OrganizationSupport.NotFound("Matter");

        var version = OrganizationSupport.CheckRowVersion(matter.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        if (matter.IsActive == request.IsActive)
            return await GetAsync(id, ct);

        if (!request.IsActive)
        {
            var open = await taskGuard.CountOpenTasksAsync(id, ct);
            if (open > 0)
            {
                return Error.Conflict(
                    ErrorCodes.MatterHasOpenTasks,
                    $"This matter has {open} tasks that aren't Completed or Cancelled. Finish or cancel them first.",
                    new Dictionary<string, object?> { ["openTaskCount"] = open });
            }
        }

        matter.IsActive = request.IsActive;
        OrganizationSupport.TrackOriginalRowVersion(db, matter, request.RowVersion);
        await db.SaveChangesAsync(ct);
        if (transaction is not null)
            await transaction.CommitAsync(ct);

        return await GetAsync(id, ct);
    }

    private IQueryable<MatterRow> Rows() =>
        from m in db.Set<Matter>().AsNoTracking()
        join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
        select new MatterRow { Matter = m, ClientName = c.Name, ClientIsActive = c.IsActive, ProjectCount = db.Set<Project>().Count(p => p.MatterId == m.Id) };

    private async Task<int?> FindIdAsync(int clientId, BusinessNumber number, int? exceptId, CancellationToken ct) =>
        await db.Set<Matter>().AsNoTracking()
            .Where(m => m.ClientId == clientId && m.MatterNumber == number && (exceptId == null || m.Id != exceptId))
            .Select(m => (int?)m.Id)
            .FirstOrDefaultAsync(ct);

    private static Error DuplicateNumber(BusinessNumber clientNumber, BusinessNumber number, int? existingId, string field = "matterNumber") =>
        OrganizationSupport.Duplicate(ErrorCodes.DuplicateNumber, field, $"Matter {number} already exists for client {clientNumber}.", existingId);

    /// <summary>Parses <c>343-12</c> or <c>00343-00012</c> into normalized numbers.</summary>
    internal static bool TryParsePair(string? text, out BusinessNumber clientNumber, out BusinessNumber matterNumber)
    {
        clientNumber = default;
        matterNumber = default;
        var parts = text?.Split('-', StringSplitOptions.TrimEntries);
        return parts is { Length: 2 }
            && BusinessNumber.TryParse(parts[0], out clientNumber)
            && BusinessNumber.TryParse(parts[1], out matterNumber);
    }

    private static MatterResponse ToResponse(MatterRow r, int? openTaskCount, CustomFieldView? view = null, IReadOnlyList<string>? dropped = null) => new(
        r.Matter.Id,
        r.Matter.ClientId,
        r.Matter.ClientNumber.Value,
        r.ClientName,
        r.ClientIsActive,
        r.Matter.MatterNumber.Value,
        r.Matter.MatterRef,
        r.Matter.Name,
        r.Matter.IsActive,
        r.Matter.IsSensitive,
        r.ProjectCount,
        openTaskCount,
        view?.FormVersionId,
        view?.PublishedFormVersionId,
        view?.Values,
        dropped ?? [],
        OrganizationSupport.Encode(r.Matter.RowVersion),
        OrganizationSupport.Utc(r.Matter.CreatedAtUtc),
        OrganizationSupport.Utc(r.Matter.ModifiedAtUtc));

    internal sealed class MatterRow
    {
        public Matter Matter { get; init; } = null!;

        public string ClientName { get; init; } = string.Empty;

        public bool ClientIsActive { get; init; }

        public int ProjectCount { get; init; }
    }
}
