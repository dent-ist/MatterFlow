using System.Data;
using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.ValueObjects;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

public sealed class ClientService(DbContext db, IAuditWriter audit, CustomFieldValues custom, IOrganizationTaskCounts taskCounts, IPermissionChecker permissions, IMatterVisibility visibility, IManagedMatterScope managed)
{
    /// <summary>The matters the caller may see: matter counts and the "matters with most open tasks" list never include a hidden matter (mode M).</summary>
    private IQueryable<Matter> MatterSet() =>
        visibility.WhereMatterRowVisible(db.Set<Matter>(), m => m.IsSensitive, m => m.PrimaryManagerId, m => m.SecondaryManagerId);

    public static readonly string[] SortFields = ["clientNumber", "name", "createdAt", OrganizationSupport.SortOpenTasks, OrganizationSupport.SortOverdue];

    private static readonly Dictionary<string, Func<IQueryable<ClientRow>, bool, bool, IOrderedQueryable<ClientRow>>> Orderings = new()
    {
        ["clientNumber"] = OrganizationSupport.By<ClientRow, BusinessNumber>(r => r.Client.ClientNumber),
        ["name"] = OrganizationSupport.By<ClientRow, string>(r => r.Client.Name),
        ["createdAt"] = OrganizationSupport.By<ClientRow, DateTime>(r => r.Client.CreatedAtUtc),
        [OrganizationSupport.SortOpenTasks] = OrganizationSupport.By<ClientRow, int>(r => r.Open),
        [OrganizationSupport.SortOverdue] = OrganizationSupport.By<ClientRow, int>(r => r.Overdue),
    };

    private bool CanCountTasks => permissions.Has(Permissions.Task.View);

    private bool CanBeManager => permissions.Has(Permissions.Matter.BeManager);

    /// <summary>The visible Matters the caller manages (the same rule as <c>managedByMe</c> on the Matters list); empty without a person.</summary>
    private IQueryable<Matter> MyMatterSet(ManagerPlace place) =>
        managed.WhereManagedBy(db.Set<Matter>().AsNoTracking(), m => m.PrimaryManagerId, m => m.SecondaryManagerId, m => m.Id, managed.CurrentUserId ?? 0, place);

    public async Task<Result<PagedResult<ClientResponse>>> ListAsync(ClientListQuery query, CancellationToken ct)
    {
        var paging = OrganizationSupport.PagingOf(query, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        var (page, sort) = paging.Value;
        var managedBy = managed.ResolveFilter(query.MatterManagedByMe, query.Role);
        if (managedBy.IsFailure)
            return managedBy.Error!;

        var clients = db.Set<Client>().AsNoTracking();
        if (managedBy.Value is { } mine)
        {
            // A client is "mine" when at least one of its matters is (an EXISTS, so a client with several of my matters is one row and the total is right).
            var mineMatters = managed.WhereManagedBy(db.Set<Matter>().AsNoTracking(), m => m.PrimaryManagerId, m => m.SecondaryManagerId, m => m.Id, mine.Manager, mine.Place);
            clients = clients.Where(c => mineMatters.Any(m => m.ClientId == c.Id));
        }

        if (query.IsActive is { } active)
            clients = clients.Where(c => c.IsActive == active);

        var q = query.Q?.Trim();
        if (!string.IsNullOrEmpty(q))
        {
            clients = BusinessNumber.TryParse(q, out var number)
                ? clients.Where(c => c.ClientNumber == number || c.Name.Contains(q))
                : clients.Where(c => c.Name.Contains(q));
        }

        // Column filters (each box searches its own column, parameterised; % and _ are literal).
        if (query.Name?.Trim() is { Length: > 0 } name)
            clients = clients.Where(c => c.Name.Contains(name));
        if (query.ClientNumber?.Trim() is { Length: > 0 } numberText)
        {
            // The number column is a value-converted type that LINQ cannot search by fragment: digits only, so the LIKE pattern needs no escaping.
            var pattern = "%" + numberText + "%";
            if (MatterService.IsDigits(numberText))
            {
                // A named parameter (not the interpolated form): EF's own @p0 numbering would collide inside the composed query.
                var ids = db.Database.SqlQueryRaw<int>(
                    "SELECT ClientId AS Value FROM dbo.Client WHERE ClientNumber LIKE @numberPattern",
                    new SqlParameter("numberPattern", SqlDbType.VarChar, 8) { Value = pattern });
                clients = clients.Where(c => ids.Contains(c.Id));
            }
            else
            {
                clients = clients.Where(_ => false);
            }
        }

        var total = await clients.CountAsync(ct);

        // The count sorts need the counts inside the statement (one grouped left join); without Task.View they are constants, so the order falls back to the default.
        var canCount = CanCountTasks;
        var joinCounts = canCount && sort.Any(f => OrganizationSupport.IsCountSort(f.Field));
        var visibleMatters = MatterSet();
        var canBeManager = CanBeManager;
        var myMatters = MyMatterSet(managedBy.Value?.Place ?? ManagerPlace.Either);
        var counted = joinCounts
            ? from c in clients
              join g in taskCounts.Grouped(TaskCountScope.Client) on c.Id equals g.Key into joined
              from g in joined.DefaultIfEmpty()
              select new ClientRow { Client = c, Open = (int?)g.Open ?? 0, Overdue = (int?)g.Overdue ?? 0 }
            : clients.Select(c => new ClientRow { Client = c, Open = 0, Overdue = 0 });
        var rows = await OrganizationSupport.ApplySort(counted, OrganizationSupport.WithDefaultTail(sort, new SortField("clientNumber", false)), Orderings, r => r.Client.Id)
            .Skip(page.Skip)
            .Take(page.PageSize)
            .Select(r => new
            {
                r.Client,
                MatterCount = visibleMatters.Count(m => m.ClientId == r.Client.Id),
                MyMatterCount = canBeManager ? myMatters.Count(m => m.ClientId == r.Client.Id) : 0,
                r.Open,
                r.Overdue,
            })
            .ToListAsync(ct);

        IReadOnlyDictionary<int, TaskCountRow> byClient = canCount && !joinCounts
            ? await taskCounts.ForKeysAsync(TaskCountScope.Client, [.. rows.Select(r => r.Client.Id)], ct)
            : new Dictionary<int, TaskCountRow>();
        return OrganizationSupport.Page(
            rows.Select(r => ToResponse(
                r.Client,
                r.MatterCount,
                !canCount ? null : joinCounts ? r.Open : byClient.GetValueOrDefault(r.Client.Id)?.Open ?? 0,
                !canCount ? null : joinCounts ? r.Overdue : byClient.GetValueOrDefault(r.Client.Id)?.Overdue ?? 0,
                myMatterCount: canBeManager ? r.MyMatterCount : null)).ToList(),
            total,
            page);
    }

    /// <summary>Counts for the Client overview strip (#259): the five Task numbers over all the Client's Matters, the Matter counts and the Matters with the most open Tasks.</summary>
    public async Task<Result<ClientSummaryResponse>> SummaryAsync(int id, CancellationToken ct)
    {
        var matters = await MatterSet().AsNoTracking().Where(m => m.ClientId == id)
            .GroupBy(_ => 1).Select(g => new { Total = g.Count(), Active = g.Count(m => m.IsActive) }).FirstOrDefaultAsync(ct);
        if (matters is null && !await db.Set<Client>().AsNoTracking().AnyAsync(c => c.Id == id, ct))
            return OrganizationSupport.NotFound("Client");

        if (!CanCountTasks)
            return new ClientSummaryResponse(id, null, null, null, null, null, matters?.Total ?? 0, matters?.Active ?? 0, null);

        var strip = await taskCounts.StripAsync(TaskCountScope.Client, id, ct);
        IReadOnlyList<TopMatterResponse>? top = null;
        if (permissions.Has(Permissions.Matter.View))
        {
            var counts = await taskCounts.TopMattersAsync(id, 5, ct);
            var ids = counts.Select(c => c.MatterId).ToList();
            var named = await MatterSet().AsNoTracking().Where(m => ids.Contains(m.Id))
                .Select(m => new { m.Id, m.MatterRef, m.Name, m.IsActive }).ToDictionaryAsync(m => m.Id, ct);
            top = [.. counts.Select(c => new TopMatterResponse(c.MatterId, named[c.MatterId].MatterRef, named[c.MatterId].Name, named[c.MatterId].IsActive, c.Open, c.Overdue))];
        }

        return new ClientSummaryResponse(id, strip.Open, strip.Overdue, strip.Asap, strip.OnHold, strip.DueSoon, matters?.Total ?? 0, matters?.Active ?? 0, top);
    }

    public async Task<Result<ClientResponse>> GetAsync(int id, CancellationToken ct) => await GetAsync(id, [], ct);

    private async Task<Result<ClientResponse>> GetAsync(int id, IReadOnlyList<string> dropped, CancellationToken ct)
    {
        var visibleMatters = MatterSet();
        var canBeManager = CanBeManager;
        var myMatters = MyMatterSet(ManagerPlace.Either);
        var row = await db.Set<Client>().AsNoTracking()
            .Where(c => c.Id == id)
            .Select(c => new { Client = c, MatterCount = visibleMatters.Count(m => m.ClientId == c.Id), MyMatterCount = canBeManager ? myMatters.Count(m => m.ClientId == c.Id) : 0 })
            .SingleOrDefaultAsync(ct);
        if (row is null)
            return OrganizationSupport.NotFound("Client");

        int? open = null, overdue = null;
        if (CanCountTasks)
        {
            var counts = await taskCounts.ForKeysAsync(TaskCountScope.Client, [id], ct);
            open = counts.GetValueOrDefault(id)?.Open ?? 0;
            overdue = counts.GetValueOrDefault(id)?.Overdue ?? 0;
        }

        return ToResponse(row.Client, row.MatterCount, open, overdue, await custom.ReadAsync(CustomFieldTarget.Client, id, ct), dropped, canBeManager ? row.MyMatterCount : null);
    }

    public async Task<Result<ClientResponse>> CreateAsync(CreateClientRequest request, CancellationToken ct)
    {
        var number = OrganizationSupport.ParseNumber(request.ClientNumber, "clientNumber");
        if (number.IsFailure)
            return number.Error!;

        var existing = await FindIdByNumberAsync(number.Value, null, ct);
        if (existing is not null)
            return DuplicateNumber(number.Value, existing);

        var plan = await custom.PlanCreateAsync(CustomFieldTarget.Client, request.FormValues, ct);
        if (plan.IsFailure)
            return plan.Error!;

        var client = new Client { ClientNumber = number.Value, Name = request.Name.Trim() };
        db.Set<Client>().Add(client);
        audit.Write(new AuditEntry
        {
            EventType = OrganizationAuditEvents.ClientCreated,
            ObjectType = nameof(Client),
            ObjectIdFactory = () => client.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            NewValue = number.Value.Value,
            Summary = $"Client {number.Value} created.",
        });

        IReadOnlyList<string> dropped = [];
        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (OrganizationSupport.IsUniqueViolation(ex, OrganizationSupport.ClientNumberUnique))
            {
                db.ChangeTracker.Clear();
                return DuplicateNumber(number.Value, await FindIdByNumberAsync(number.Value, null, ct));
            }

            if (plan.Value is { } formPlan)
            {
                var saved = await custom.SaveAsync(CustomFieldTarget.Client, client.Id, null, formPlan, ct);
                if (saved.IsFailure)
                {
                    db.ChangeTracker.Clear();
                    return saved.Error!;
                }

                dropped = saved.Value;
            }

            await transaction.CommitAsync(ct);
        }

        return await GetAsync(client.Id, dropped, ct);
    }

    public async Task<Result<ClientResponse>> UpdateAsync(int id, UpdateClientRequest request, CancellationToken ct)
    {
        var client = await db.Set<Client>().SingleOrDefaultAsync(c => c.Id == id, ct);
        if (client is null)
            return OrganizationSupport.NotFound("Client");

        var version = OrganizationSupport.CheckRowVersion(client.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var plan = await custom.PlanUpdateAsync(CustomFieldTarget.Client, id, request.FormValues, ct);
        if (plan.IsFailure)
            return plan.Error!;

        client.Name = request.Name.Trim();
        client.IsActive = request.IsActive;
        OrganizationSupport.TrackOriginalRowVersion(db, client, request.RowVersion);

        IReadOnlyList<string> dropped = [];
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            if (plan.Value is { } formPlan)
            {
                var saved = await custom.SaveAsync(CustomFieldTarget.Client, id, null, formPlan, ct);
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

    /// <summary>Changes the Client number (needs Client.EditNumber at the API). Writes CLIENT_NUMBER_CHANGED; the database cascades the copy held by the Client's Matters.</summary>
    public async Task<Result<ClientResponse>> ChangeNumberAsync(int id, ChangeNumberRequest request, CancellationToken ct)
    {
        var number = OrganizationSupport.ParseNumber(request.Number, "number");
        if (number.IsFailure)
            return number.Error!;

        var client = await db.Set<Client>().SingleOrDefaultAsync(c => c.Id == id, ct);
        if (client is null)
            return OrganizationSupport.NotFound("Client");

        var version = OrganizationSupport.CheckRowVersion(client.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        if (client.ClientNumber == number.Value)
            return await GetAsync(id, ct);

        var existing = await FindIdByNumberAsync(number.Value, id, ct);
        if (existing is not null)
            return DuplicateNumber(number.Value, existing, "number");

        var old = client.ClientNumber;
        client.ClientNumber = number.Value;
        OrganizationSupport.TrackOriginalRowVersion(db, client, request.RowVersion);
        audit.Write(new AuditEntry
        {
            EventType = OrganizationAuditEvents.ClientNumberChanged,
            ObjectType = nameof(Client),
            ObjectId = id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            FieldKey = nameof(Client.ClientNumber),
            OldValue = old.Value,
            NewValue = number.Value.Value,
            Summary = $"Client number changed from {old} to {number.Value}.",
        });

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (OrganizationSupport.IsUniqueViolation(ex, OrganizationSupport.ClientNumberUnique))
        {
            db.ChangeTracker.Clear();
            return DuplicateNumber(number.Value, await FindIdByNumberAsync(number.Value, id, ct), "number");
        }

        return await GetAsync(id, ct);
    }

    private async Task<int?> FindIdByNumberAsync(BusinessNumber number, int? exceptId, CancellationToken ct)
    {
        var id = await db.Set<Client>().AsNoTracking()
            .Where(c => c.ClientNumber == number && (exceptId == null || c.Id != exceptId))
            .Select(c => (int?)c.Id)
            .FirstOrDefaultAsync(ct);
        return id;
    }

    private static Error DuplicateNumber(BusinessNumber number, int? existingId, string field = "clientNumber") =>
        OrganizationSupport.Duplicate(ErrorCodes.DuplicateNumber, field, $"Client {number} already exists.", existingId);

    private static ClientResponse ToResponse(Client c, int matterCount, int? openTaskCount, int? overdueTaskCount, CustomFieldView? view = null, IReadOnlyList<string>? dropped = null, int? myMatterCount = null) => new(
        c.Id,
        c.ClientNumber.Value,
        c.Name,
        c.IsActive,
        matterCount,
        openTaskCount,
        overdueTaskCount,
        view?.FormVersionId,
        view?.PublishedFormVersionId,
        view?.Values,
        dropped ?? [],
        OrganizationSupport.Encode(c.RowVersion),
        OrganizationSupport.Utc(c.CreatedAtUtc),
        OrganizationSupport.Utc(c.ModifiedAtUtc),
        myMatterCount);

    private sealed class ClientRow
    {
        public Client Client { get; init; } = null!;

        public int Open { get; init; }

        public int Overdue { get; init; }
    }
}
