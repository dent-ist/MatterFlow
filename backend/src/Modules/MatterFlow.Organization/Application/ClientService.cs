using MatterFlow.Audit.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.ValueObjects;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

public sealed class ClientService(DbContext db, IAuditWriter audit, CustomFieldValues custom)
{
    public static readonly string[] SortFields = ["clientNumber", "name", "createdAt"];

    private static readonly Dictionary<string, Func<IQueryable<Client>, bool, bool, IOrderedQueryable<Client>>> Orderings = new()
    {
        ["clientNumber"] = OrganizationSupport.By<Client, BusinessNumber>(c => c.ClientNumber),
        ["name"] = OrganizationSupport.By<Client, string>(c => c.Name),
        ["createdAt"] = OrganizationSupport.By<Client, DateTime>(c => c.CreatedAtUtc),
    };

    public async Task<Result<PagedResult<ClientResponse>>> ListAsync(ClientListQuery query, CancellationToken ct)
    {
        var paging = OrganizationSupport.PagingOf(query, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        var (page, sort) = paging.Value;
        var clients = db.Set<Client>().AsNoTracking();
        if (query.IsActive is { } active)
            clients = clients.Where(c => c.IsActive == active);

        var q = query.Q?.Trim();
        if (!string.IsNullOrEmpty(q))
        {
            clients = BusinessNumber.TryParse(q, out var number)
                ? clients.Where(c => c.ClientNumber == number || c.Name.Contains(q))
                : clients.Where(c => c.Name.Contains(q));
        }

        var total = await clients.CountAsync(ct);
        var rows = await OrganizationSupport.ApplySort(clients, sort.Count == 0 ? [new SortField("clientNumber", false)] : sort, Orderings, c => c.Id)
            .Skip(page.Skip)
            .Take(page.PageSize)
            .Select(c => new { Client = c, MatterCount = db.Set<Matter>().Count(m => m.ClientId == c.Id) })
            .ToListAsync(ct);

        return OrganizationSupport.Page(rows.Select(r => ToResponse(r.Client, r.MatterCount)).ToList(), total, page);
    }

    public async Task<Result<ClientResponse>> GetAsync(int id, CancellationToken ct) => await GetAsync(id, [], ct);

    private async Task<Result<ClientResponse>> GetAsync(int id, IReadOnlyList<string> dropped, CancellationToken ct)
    {
        var row = await db.Set<Client>().AsNoTracking()
            .Where(c => c.Id == id)
            .Select(c => new { Client = c, MatterCount = db.Set<Matter>().Count(m => m.ClientId == c.Id) })
            .SingleOrDefaultAsync(ct);
        return row is null
            ? OrganizationSupport.NotFound("Client")
            : ToResponse(row.Client, row.MatterCount, await custom.ReadAsync(CustomFieldTarget.Client, id, ct), dropped);
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

    private static ClientResponse ToResponse(Client c, int matterCount, CustomFieldView? view = null, IReadOnlyList<string>? dropped = null) => new(
        c.Id,
        c.ClientNumber.Value,
        c.Name,
        c.IsActive,
        matterCount,
        view?.FormVersionId,
        view?.PublishedFormVersionId,
        view?.Values,
        dropped ?? [],
        OrganizationSupport.Encode(c.RowVersion),
        OrganizationSupport.Utc(c.CreatedAtUtc),
        OrganizationSupport.Utc(c.ModifiedAtUtc));
}
