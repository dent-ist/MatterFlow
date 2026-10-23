using System.Globalization;
using System.Linq.Expressions;
using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Notifications.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.ValueObjects;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

public sealed class MatterService(
    DbContext db,
    IAuditWriter audit,
    IMatterTaskGuard taskGuard,
    CustomFieldValues custom,
    IOrganizationTaskCounts taskCounts,
    IMatterAssetCounts assetCounts,
    IPermissionChecker permissions,
    ICurrentUser currentUser,
    IUserDirectory users,
    IMatterManagerEligibility eligibility,
    INotificationPublisher notifications,
    IManagedMatterScope managed)
{
    public const string SortPrimaryManager = "primaryManager";
    public const string SortSecondaryManager = "secondaryManager";

    public static readonly string[] SortFields = ["matterRef", "name", "clientNumber", "createdAt", OrganizationSupport.SortOpenTasks, OrganizationSupport.SortOverdue, SortPrimaryManager, SortSecondaryManager];

    private bool CanCountTasks => permissions.Has(Permissions.Task.View);

    private static readonly Dictionary<string, Func<IQueryable<MatterRow>, bool, bool, IOrderedQueryable<MatterRow>>> Orderings = new()
    {
        ["matterRef"] = OrganizationSupport.By<MatterRow, string>(r => r.Matter.MatterRef),
        ["name"] = OrganizationSupport.By<MatterRow, string>(r => r.Matter.Name),
        ["clientNumber"] = OrganizationSupport.By<MatterRow, BusinessNumber>(r => r.Matter.ClientNumber),
        ["createdAt"] = OrganizationSupport.By<MatterRow, DateTime>(r => r.Matter.CreatedAtUtc),
        [OrganizationSupport.SortOpenTasks] = OrganizationSupport.By<MatterRow, int>(r => r.Open),
        [OrganizationSupport.SortOverdue] = OrganizationSupport.By<MatterRow, int>(r => r.Overdue),
        [SortPrimaryManager] = ByName(r => r.PrimaryManagerName == null, r => r.PrimaryManagerName),
        [SortSecondaryManager] = ByName(r => r.SecondaryManagerName == null, r => r.SecondaryManagerName),
    };

    /// <summary>Orders by a manager's name with the matters that have none last, whichever way the name sorts.</summary>
    private static Func<IQueryable<MatterRow>, bool, bool, IOrderedQueryable<MatterRow>> ByName(
        Expression<Func<MatterRow, bool>> isEmpty,
        Expression<Func<MatterRow, string?>> name) =>
        (query, descending, then) =>
        {
            var ordered = then ? ((IOrderedQueryable<MatterRow>)query).ThenBy(isEmpty) : query.OrderBy(isEmpty);
            return descending ? ordered.ThenByDescending(name) : ordered.ThenBy(name);
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

        rows = ApplyManagerFilters(rows, query);

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

        // Sorting by a manager's name needs the names inside the statement (a left join on the user names the Identity module offers).
        if (sort.Any(f => f.Field is SortPrimaryManager or SortSecondaryManager))
        {
            rows = from r in rows
                   join p in users.NameKeys() on r.Matter.PrimaryManagerId equals (int?)p.UserId into primary
                   from p in primary.DefaultIfEmpty()
                   join sc in users.NameKeys() on r.Matter.SecondaryManagerId equals (int?)sc.UserId into secondary
                   from sc in secondary.DefaultIfEmpty()
                   select new MatterRow
                   {
                       Matter = r.Matter,
                       ClientName = r.ClientName,
                       ClientIsActive = r.ClientIsActive,
                       ProjectCount = r.ProjectCount,
                       Open = r.Open,
                       Overdue = r.Overdue,
                       PrimaryManagerName = p.DisplayName,
                       SecondaryManagerName = sc.DisplayName,
                   };
        }

        // The count sorts need the counts inside the statement (one grouped left join); without Task.View they are constants, so the order falls back to the default.
        var canCount = CanCountTasks;
        var joinCounts = canCount && sort.Any(f => OrganizationSupport.IsCountSort(f.Field));
        if (joinCounts)
        {
            rows = from r in rows
                   join g in taskCounts.Grouped(TaskCountScope.Matter) on r.Matter.Id equals g.Key into joined
                   from g in joined.DefaultIfEmpty()
                   select new MatterRow
                   {
                       Matter = r.Matter,
                       ClientName = r.ClientName,
                       ClientIsActive = r.ClientIsActive,
                       ProjectCount = r.ProjectCount,
                       Open = (int?)g.Open ?? 0,
                       Overdue = (int?)g.Overdue ?? 0,
                       PrimaryManagerName = r.PrimaryManagerName,
                       SecondaryManagerName = r.SecondaryManagerName,
                   };
        }

        var items = await OrganizationSupport.ApplySort(rows, OrganizationSupport.WithDefaultTail(sort, new SortField("matterRef", false)), Orderings, r => r.Matter.Id)
            .Skip(page.Skip)
            .Take(page.PageSize)
            .ToListAsync(ct);

        IReadOnlyDictionary<int, TaskCountRow> byMatter = canCount && !joinCounts
            ? await taskCounts.ForKeysAsync(TaskCountScope.Matter, [.. items.Select(r => r.Matter.Id)], ct)
            : new Dictionary<int, TaskCountRow>();
        var people = await ManagersAsync(items.Select(r => r.Matter), ct);
        return OrganizationSupport.Page(
            items.Select(r => ToResponse(
                r,
                !canCount ? null : joinCounts ? r.Open : byMatter.GetValueOrDefault(r.Matter.Id)?.Open ?? 0,
                !canCount ? null : joinCounts ? r.Overdue : byMatter.GetValueOrDefault(r.Matter.Id)?.Overdue ?? 0,
                people)).ToList(),
            total,
            page);
    }

    /// <summary>Counts for the Matter overview strip (#259): the five Task numbers over the Matter's Tasks (project Tasks included), the Project count and the Asset count.</summary>
    public async Task<Result<MatterSummaryResponse>> SummaryAsync(int id, CancellationToken ct)
    {
        if (!await db.Set<Matter>().AsNoTracking().AnyAsync(m => m.Id == id, ct))
            return OrganizationSupport.NotFound("Matter");

        var projects = await db.Set<Project>().AsNoTracking().CountAsync(p => p.MatterId == id, ct);
        var assets = await assetCounts.CountAsync(id, ct);
        if (!CanCountTasks)
            return new MatterSummaryResponse(id, null, null, null, null, null, null, projects, assets);

        var strip = await taskCounts.StripAsync(TaskCountScope.Matter, id, ct);
        return new MatterSummaryResponse(id, strip.Open, strip.Overdue, strip.Asap, strip.OnHold, strip.DueSoon, strip.Unassigned, projects, assets);
    }

    private async Task<(int? Open, int? Overdue)> CountsOfAsync(int matterId, CancellationToken ct)
    {
        if (!CanCountTasks)
            return (null, null);

        var counts = await taskCounts.ForKeysAsync(TaskCountScope.Matter, [matterId], ct);
        return (counts.GetValueOrDefault(matterId)?.Open ?? 0, counts.GetValueOrDefault(matterId)?.Overdue ?? 0);
    }

    public async Task<Result<MatterResponse>> GetAsync(int id, CancellationToken ct) => await GetAsync(id, [], ct);

    private async Task<Result<MatterResponse>> GetAsync(int id, IReadOnlyList<string> dropped, CancellationToken ct)
    {
        var row = await Rows().Where(r => r.Matter.Id == id).SingleOrDefaultAsync(ct);
        if (row is null)
            return OrganizationSupport.NotFound("Matter");

        var (open, overdue) = await CountsOfAsync(id, ct);
        return ToResponse(row, open, overdue, await ManagersAsync([row.Matter], ct), await custom.ReadAsync(CustomFieldTarget.Matter, id, ct), dropped);
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
        if (row is null)
            return OrganizationSupport.NotFound("Matter");

        var (open, overdue) = await CountsOfAsync(row.Matter.Id, ct);
        return ToResponse(row, open, overdue, await ManagersAsync([row.Matter], ct), await custom.ReadAsync(CustomFieldTarget.Matter, row.Matter.Id, ct), []);
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

        var wantsManagers = request.PrimaryManagerId is not null || request.SecondaryManagerId is not null;
        if (wantsManagers)
        {
            var allowed = permissions.Require(Permissions.Matter.AssignManagers);
            if (allowed.IsFailure)
                return allowed.Error!;

            var valid = await ValidateManagersAsync(request.PrimaryManagerId, request.SecondaryManagerId, null, ct);
            if (valid.IsFailure)
                return valid.Error!;
        }

        var matter = new Matter
        {
            ClientId = client.Id,
            ClientNumber = client.ClientNumber,
            MatterNumber = number.Value,
            Name = request.Name.Trim(),
            IsSensitive = request.IsSensitive,
        };
        db.Set<Matter>().Add(matter);
        var newManagers = wantsManagers ? NewlySet(matter, request.PrimaryManagerId, request.SecondaryManagerId) : [];
        if (wantsManagers)
            await ApplyManagersAsync(matter, request.PrimaryManagerId, request.SecondaryManagerId, ct);
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

            if (newManagers.Count > 0)
            {
                // Event 7: the matter has its id now; the rows commit with the matter.
                await NotifyManagersSetAsync(matter, newManagers, ct);
                await db.SaveChangesAsync(ct);
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

        IReadOnlyList<(int UserId, bool Primary)> updatedManagers = [];
        if (request.PrimaryManagerId is not null || request.SecondaryManagerId is not null)
        {
            var allowed = permissions.Require(Permissions.Matter.AssignManagers);
            if (allowed.IsFailure)
                return allowed.Error!;

            var primary = request.PrimaryManagerId ?? matter.PrimaryManagerId;
            var secondary = request.SecondaryManagerId ?? matter.SecondaryManagerId;
            var valid = await ValidateManagersAsync(primary, secondary, matter, ct);
            if (valid.IsFailure)
                return valid.Error!;

            updatedManagers = NewlySet(matter, primary, secondary);
            await ApplyManagersAsync(matter, primary, secondary, ct);
        }

        matter.Name = request.Name.Trim();
        matter.IsSensitive = request.IsSensitive;
        if (updatedManagers.Count > 0)
            await NotifyManagersSetAsync(matter, updatedManagers, ct); // event 7, in the same save
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

    /// <summary>
    /// Sets or clears both project managers (needs <c>Matter.AssignManagers</c> at the API). Both values are replaced; an unchanged value is always
    /// accepted. One <c>MATTER_MANAGER_CHANGED</c> event per changed place, in one correlation. Saving the values already stored is a no-op.
    /// </summary>
    public async Task<Result<MatterResponse>> SetManagersAsync(int id, SetMatterManagersRequest request, CancellationToken ct)
    {
        var matter = await db.Set<Matter>().SingleOrDefaultAsync(m => m.Id == id, ct);
        if (matter is null)
            return OrganizationSupport.NotFound("Matter");

        var version = OrganizationSupport.CheckRowVersion(matter.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var valid = await ValidateManagersAsync(request.PrimaryManagerId, request.SecondaryManagerId, matter, ct);
        if (valid.IsFailure)
            return valid.Error!;

        var newly = NewlySet(matter, request.PrimaryManagerId, request.SecondaryManagerId);
        if (!await ApplyManagersAsync(matter, request.PrimaryManagerId, request.SecondaryManagerId, ct))
            return await GetAsync(id, ct);

        await NotifyManagersSetAsync(matter, newly, ct); // event 7, saved with the change

        OrganizationSupport.TrackOriginalRowVersion(db, matter, request.RowVersion);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return OrganizationSupport.ConcurrencyError();
        }

        return await GetAsync(id, ct);
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
        select new MatterRow { Matter = m, ClientName = c.Name, ClientIsActive = c.IsActive, ProjectCount = db.Set<Project>().Count(p => p.MatterId == m.Id), Open = 0, Overdue = 0 };

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

    private static MatterResponse ToResponse(
        MatterRow r,
        int? openTaskCount,
        int? overdueTaskCount,
        IReadOnlyDictionary<int, MatterManagerResponse> people,
        CustomFieldView? view = null,
        IReadOnlyList<string>? dropped = null) => new(
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
        PersonOf(people, r.Matter.PrimaryManagerId),
        PersonOf(people, r.Matter.SecondaryManagerId),
        r.ProjectCount,
        openTaskCount,
        overdueTaskCount,
        view?.FormVersionId,
        view?.PublishedFormVersionId,
        view?.Values,
        dropped ?? [],
        OrganizationSupport.Encode(r.Matter.RowVersion),
        OrganizationSupport.Utc(r.Matter.CreatedAtUtc),
        OrganizationSupport.Utc(r.Matter.ModifiedAtUtc));

    private static MatterManagerResponse? PersonOf(IReadOnlyDictionary<int, MatterManagerResponse> people, int? userId) =>
        userId is { } id ? people.GetValueOrDefault(id) : null;

    /// <summary>The managers of the given matters as the DTOs show them, one lookup for all of them.</summary>
    private async Task<IReadOnlyDictionary<int, MatterManagerResponse>> ManagersAsync(IEnumerable<Matter> matters, CancellationToken ct)
    {
        var ids = matters.SelectMany(m => new[] { m.PrimaryManagerId, m.SecondaryManagerId }).OfType<int>().Distinct().ToList();
        if (ids.Count == 0)
            return new Dictionary<int, MatterManagerResponse>();

        var found = await users.FindManyAsync(ids, ct);
        return found.ToDictionary(kv => kv.Key, kv => new MatterManagerResponse(kv.Value.UserId, kv.Value.DisplayName, kv.Value.IsActive));
    }

    private IQueryable<MatterRow> ApplyManagerFilters(IQueryable<MatterRow> rows, MatterListQuery query)
    {
        // "Managed by X" is one rule for every list (IManagedMatterScope), which also applies the sensitive-matter visibility hook.
        IQueryable<MatterRow> ManagedBy(IQueryable<MatterRow> source, int manager, ManagerPlace place) =>
            managed.WhereManagedBy(source, r => r.Matter.PrimaryManagerId, r => r.Matter.SecondaryManagerId, r => r.Matter.Id, manager, place);

        if (query.PrimaryManagerId is { } primary)
            rows = ManagedBy(rows, primary, ManagerPlace.Primary);
        if (query.SecondaryManagerId is { } secondary)
            rows = ManagedBy(rows, secondary, ManagerPlace.Secondary);
        if (query.ManagerId is { } either)
            rows = ManagedBy(rows, either, ManagerPlace.Either);
        if (query.ManagedByMe == true)
            rows = ManagedBy(rows, managed.CurrentUserId ?? 0, ManagerPlace.Either); // no user, no matters (0 is never a user id)

        if (query.HasNoManager is { } none)
        {
            rows = none
                ? rows.Where(r => r.Matter.PrimaryManagerId == null && r.Matter.SecondaryManagerId == null)
                : rows.Where(r => r.Matter.PrimaryManagerId != null || r.Matter.SecondaryManagerId != null);
        }

        if (query.HasPrimaryManager is { } hasPrimary)
            rows = hasPrimary ? rows.Where(r => r.Matter.PrimaryManagerId != null) : rows.Where(r => r.Matter.PrimaryManagerId == null);
        if (query.HasSecondaryManager is { } hasSecondary)
            rows = hasSecondary ? rows.Where(r => r.Matter.SecondaryManagerId != null) : rows.Where(r => r.Matter.SecondaryManagerId == null);
        return rows;
    }

    /// <summary>
    /// Checks a new pair of managers: not the same person twice, and every person who is not already on this matter must be an active user holding
    /// <c>Matter.BeManager</c>. A person already on the matter (in either place) is always accepted, so someone who lost the role stays.
    /// </summary>
    private async Task<Result> ValidateManagersAsync(int? primary, int? secondary, Matter? current, CancellationToken ct)
    {
        if (primary is not null && primary == secondary)
        {
            return Error.Validation("secondaryManagerId", ErrorCodes.ManagerDuplicate, "The Primary and the Secondary project manager must be different people.", ErrorCodes.ManagerDuplicate);
        }

        var staying = new[] { current?.PrimaryManagerId, current?.SecondaryManagerId };
        var candidates = new[] { primary, secondary }.OfType<int>().Where(id => !staying.Contains(id)).ToList();
        if (candidates.Count == 0)
            return Result.Success();

        var eligible = await eligibility.EligibleAsync(candidates, ct);
        var errors = new Dictionary<string, IReadOnlyList<FieldError>>();
        if (primary is { } p && candidates.Contains(p) && !eligible.Contains(p))
            errors["primaryManagerId"] = [new FieldError(ErrorCodes.ManagerNotEligible, "Choose an active user who can be a project manager.")];
        if (secondary is { } s && candidates.Contains(s) && !eligible.Contains(s))
            errors["secondaryManagerId"] = [new FieldError(ErrorCodes.ManagerNotEligible, "Choose an active user who can be a project manager.")];
        return errors.Count == 0
            ? Result.Success()
            : Error.Validation("Choose active users who can be project managers.", errors, ErrorCodes.ManagerNotEligible);
    }

    /// <summary>The people who are about to hold a manager place they did not hold in that place before (a person moving from Secondary to Primary counts).</summary>
    private static List<(int UserId, bool Primary)> NewlySet(Matter matter, int? primary, int? secondary)
    {
        var list = new List<(int UserId, bool Primary)>();
        if (primary is { } p && p != matter.PrimaryManagerId)
            list.Add((p, true));
        if (secondary is { } s && s != matter.SecondaryManagerId)
            list.Add((s, false));
        return list;
    }

    /// <summary>
    /// Event 7 (<c>MatterManagerSet</c>, epic #753): tells each newly set manager, except the person who set them, "Ann Lee made you Primary manager of
    /// Acme v. Smith.". The rows join the caller's unit of work and commit with the change.
    /// </summary>
    private async Task NotifyManagersSetAsync(Matter matter, IReadOnlyList<(int UserId, bool Primary)> newly, CancellationToken ct)
    {
        var actorId = currentUser.UserId;
        var recipients = newly.Where(n => n.UserId != actorId).ToList();
        if (recipients.Count == 0)
            return;

        var actorName = !string.IsNullOrWhiteSpace(currentUser.DisplayName)
            ? currentUser.DisplayName
            : actorId is { } id ? (await users.FindAsync(id, ct))?.DisplayName ?? "Someone" : "Someone";
        var stamp = DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture);
        await notifications.PublishAsync(
            [.. recipients.Select(n => new NotificationRequest(
                NotificationEventType.MatterManagerSet,
                NotificationObjectKinds.Matter,
                matter.Id,
                matter.Id,
                actorId,
                NotificationMessages.MatterManagerSet(actorName, n.Primary, matter.Name),
                $"mgr:{matter.Id.ToString(CultureInfo.InvariantCulture)}:{(n.Primary ? "Primary" : "Secondary")}:{stamp}",
                [n.UserId]))],
            ct);
    }

    /// <summary>Sets the two managers on a tracked matter and queues one audit event per changed place (names as old and new value). Returns false when nothing changed.</summary>
    private async Task<bool> ApplyManagersAsync(Matter matter, int? primary, int? secondary, CancellationToken ct)
    {
        var primaryChanged = matter.PrimaryManagerId != primary;
        var secondaryChanged = matter.SecondaryManagerId != secondary;
        if (!primaryChanged && !secondaryChanged)
            return false;

        var ids = new[] { matter.PrimaryManagerId, matter.SecondaryManagerId, primary, secondary }.OfType<int>().Distinct().ToList();
        var names = await users.FindManyAsync(ids, ct);
        string? NameOf(int? id) => id is { } v ? names.GetValueOrDefault(v)?.DisplayName ?? $"User {v}" : null;

        void Audit(string place, int? before, int? after)
        {
            var oldName = NameOf(before);
            var newName = NameOf(after);
            audit.Write(new AuditEntry
            {
                EventType = OrganizationAuditEvents.MatterManagerChanged,
                ObjectType = nameof(Matter),
                ObjectIdFactory = () => matter.Id.ToString(CultureInfo.InvariantCulture), // a matter created in the same request has no id yet
                MatterId = matter.Id == 0 ? null : matter.Id,
                FieldKey = place + "Manager",
                OldValue = oldName,
                NewValue = newName,
                Summary = (oldName, newName) switch
                {
                    (null, not null) => $"{place} project manager set to {newName}.",
                    (not null, null) => $"{place} project manager {oldName} removed.",
                    _ => $"{place} project manager changed from {oldName} to {newName}.",
                },
            });
        }

        if (primaryChanged)
        {
            Audit("Primary", matter.PrimaryManagerId, primary);
            matter.PrimaryManagerId = primary;
        }

        if (secondaryChanged)
        {
            Audit("Secondary", matter.SecondaryManagerId, secondary);
            matter.SecondaryManagerId = secondary;
        }

        return true;
    }

    internal sealed class MatterRow
    {
        public Matter Matter { get; init; } = null!;

        public string ClientName { get; init; } = string.Empty;

        public bool ClientIsActive { get; init; }

        public int ProjectCount { get; init; }

        public int Open { get; init; }

        public int Overdue { get; init; }

        /// <summary>Filled only while the list sorts by a manager's name.</summary>
        public string? PrimaryManagerName { get; init; }

        public string? SecondaryManagerName { get; init; }
    }
}
