using System.Globalization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

/// <summary>
/// Calendar items of matters (UI-05, #958). Read: everything the caller may see of the matter (the sensitive-matter rule; a hidden matter's events do not exist for the caller).
/// Write: the matter's Primary and Secondary PM and holders of <c>Matter.Edit</c> (owner decision of 2026-10-31; no new permission). No reminders.
/// </summary>
public sealed class MatterEventService(DbContext db, IPermissionChecker permissions, ICurrentUser currentUser, IMatterVisibility visibility, IUserDirectory users)
{
    public const int MaxRangeDays = 100;
    public const int MaxEvents = 500;
    public const int DefaultAheadDays = 90;

    /// <summary>The matter row of an event with the names the answer needs.</summary>
    public sealed class EventRow
    {
        public required MatterEvent Event { get; init; }

        public required string MatterRef { get; init; }

        public required string MatterName { get; init; }

        public required bool IsSensitive { get; init; }

        public required bool MatterIsActive { get; init; }

        public int? PrimaryManagerId { get; init; }

        public int? SecondaryManagerId { get; init; }

        public required int ClientId { get; init; }

        public required string ClientName { get; init; }
    }

    private int Me => currentUser.UserId ?? 0;

    /// <summary>Events of the given matters (an id subquery the caller already restricted, for example a My Matters scope) in a date range, optionally of some types.</summary>
    public IQueryable<EventRow> InRange(IQueryable<int> matterIds, DateOnly from, DateOnly to, IReadOnlyCollection<string>? types = null)
    {
        var rows = Rows().Where(r => matterIds.Contains(r.Event.MatterId) && r.Event.EventDate >= from && r.Event.EventDate <= to);
        if (types is { Count: > 0 })
            rows = rows.Where(r => types.Contains(r.Event.EventTypeCode));
        return rows;
    }

    /// <summary>Sorts a range: date, all-day first, time, title, id.</summary>
    public static IOrderedQueryable<EventRow> Ordered(IQueryable<EventRow> rows) =>
        rows.OrderBy(r => r.Event.EventDate).ThenBy(r => r.Event.EventTime == null ? 0 : 1).ThenBy(r => r.Event.EventTime).ThenBy(r => r.Event.Title).ThenBy(r => r.Event.Id);

    public async Task<IReadOnlyList<MatterEventResponse>> ToResponsesAsync(IReadOnlyList<EventRow> rows, CancellationToken ct)
    {
        var names = await NamesAsync(rows, ct);
        var canEditAll = permissions.Has(Permissions.Matter.Edit);
        return [.. rows.Select(r => ToResponse(r, names, CanEdit(r, canEditAll)))];
    }

    public async Task<Result<MatterEventList>> ListForMatterAsync(int matterId, MatterEventListQuery query, CancellationToken ct)
    {
        if (!await VisibleMatters().AnyAsync(m => m.Id == matterId, ct))
            return OrganizationSupport.NotFound("Matter");

        var from = query.From ?? DateOnly.FromDateTime(DateTime.UtcNow.Date);
        var to = query.To ?? from.AddDays(DefaultAheadDays);
        var range = ValidateRange(from, to);
        if (range.IsFailure)
            return range.Error!;

        var rows = Ordered(Rows().Where(r => r.Event.MatterId == matterId && r.Event.EventDate >= from && r.Event.EventDate <= to));
        var items = await rows.Take(MaxEvents + 1).ToListAsync(ct);
        if (items.Count > MaxEvents)
            return Error.Validation("to", "RANGE_TOO_LARGE", $"More than {MaxEvents} events in that range. Choose a shorter range.");

        return new MatterEventList(from, to, items.Count, await ToResponsesAsync(items, ct));
    }

    public static Result ValidateRange(DateOnly from, DateOnly to)
    {
        if (from > to)
            return Error.Validation("from", "INVALID_RANGE", "from must not be after to.");
        if (to.DayNumber - from.DayNumber > MaxRangeDays)
            return Error.Validation("to", "RANGE_TOO_LARGE", $"The range may be at most {MaxRangeDays} days.");
        return Result.Success();
    }

    public async Task<Result<MatterEventResponse>> CreateAsync(int matterId, MatterEventRequest request, CancellationToken ct)
    {
        var matter = await VisibleMatters().SingleOrDefaultAsync(m => m.Id == matterId, ct);
        if (matter is null)
            return OrganizationSupport.NotFound("Matter");

        var allowed = RequireManager(matter.PrimaryManagerId, matter.SecondaryManagerId);
        if (allowed.IsFailure)
            return allowed.Error!;
        if (!matter.IsActive)
            return Error.Validation("matterId", "MATTER_INACTIVE", "This matter is archived; it cannot get new events.");

        var checkedRequest = Validate(request);
        if (checkedRequest.IsFailure)
            return checkedRequest.Error!;

        var (type, title, date, time, note) = checkedRequest.Value;
        var entity = new MatterEvent { MatterId = matterId, EventTypeCode = type, Title = title, EventDate = date, EventTime = time, Note = note };
        db.Set<MatterEvent>().Add(entity);
        await db.SaveChangesAsync(ct);
        return await GetAsync(entity.Id, ct);
    }

    public async Task<Result<MatterEventResponse>> UpdateAsync(int eventId, UpdateMatterEventRequest request, CancellationToken ct)
    {
        var row = await Rows().Where(r => r.Event.Id == eventId).SingleOrDefaultAsync(ct);
        if (row is null)
            return OrganizationSupport.NotFound("Event");

        var allowed = RequireManager(row.PrimaryManagerId, row.SecondaryManagerId);
        if (allowed.IsFailure)
            return allowed.Error!;

        var checkedRequest = Validate(request);
        if (checkedRequest.IsFailure)
            return checkedRequest.Error!;

        // The query above read the row without tracking it; load the tracked entity to change it.
        var entity = await db.Set<MatterEvent>().SingleAsync(e => e.Id == eventId, ct);
        var version = OrganizationSupport.CheckRowVersion(entity.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var (type, title, date, time, note) = checkedRequest.Value;
        entity.EventTypeCode = type;
        entity.Title = title;
        entity.EventDate = date;
        entity.EventTime = time;
        entity.Note = note;
        OrganizationSupport.TrackOriginalRowVersion(db, entity, request.RowVersion);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return OrganizationSupport.ConcurrencyError();
        }

        return await GetAsync(eventId, ct);
    }

    public async Task<Result> DeleteAsync(int eventId, string? rowVersion, CancellationToken ct)
    {
        var row = await Rows().Where(r => r.Event.Id == eventId).SingleOrDefaultAsync(ct);
        if (row is null)
            return OrganizationSupport.NotFound("Event");

        var allowed = RequireManager(row.PrimaryManagerId, row.SecondaryManagerId);
        if (allowed.IsFailure)
            return allowed.Error!;
        if (string.IsNullOrWhiteSpace(rowVersion))
            return Error.Validation("rowVersion", "REQUIRED", "rowVersion is required.");

        var entity = await db.Set<MatterEvent>().SingleAsync(e => e.Id == eventId, ct);
        var version = OrganizationSupport.CheckRowVersion(entity.RowVersion, rowVersion);
        if (version.IsFailure)
            return version.Error!;

        OrganizationSupport.TrackOriginalRowVersion(db, entity, rowVersion);
        db.Set<MatterEvent>().Remove(entity);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return OrganizationSupport.ConcurrencyError();
        }

        return Result.Success();
    }

    private async Task<Result<MatterEventResponse>> GetAsync(int eventId, CancellationToken ct)
    {
        var row = await Rows().Where(r => r.Event.Id == eventId).SingleOrDefaultAsync(ct);
        return row is null ? OrganizationSupport.NotFound("Event") : (await ToResponsesAsync([row], ct))[0];
    }

    /// <summary>Success for the matter's Primary or Secondary PM and for holders of <c>Matter.Edit</c>; otherwise 403 <c>NOT_MATTER_MANAGER</c>.</summary>
    private Result RequireManager(int? primary, int? secondary)
    {
        var me = Me;
        if (permissions.Has(Permissions.Matter.Edit) || (me != 0 && (primary == me || secondary == me)))
            return Result.Success();
        return Error.Forbidden("Only the matter's project managers and people who may edit matters can change its events.", "NOT_MATTER_MANAGER");
    }

    private bool CanEdit(EventRow row, bool canEditAll) => canEditAll || (Me != 0 && (row.PrimaryManagerId == Me || row.SecondaryManagerId == Me));

    private static Result<(string Type, string Title, DateOnly Date, TimeOnly? Time, string? Note)> Validate(MatterEventRequest request)
    {
        var type = MatterEventTypes.Find(request.TypeCode);
        if (type is null)
            return Error.Validation("typeCode", "UNKNOWN_EVENT_TYPE", "Choose one of the event types.");
        var title = request.Title.Trim();
        if (title.Length == 0)
            return Error.Validation("title", "REQUIRED", "Enter a title.");
        if (request.Date is not { } date)
            return Error.Validation("date", "REQUIRED", "Enter a date.");
        if (!MatterEventTime.TryParse(request.Time, out var time))
            return Error.Validation("time", "INVALID", "Enter the time as HH:mm (24 hours), or leave it empty for an all-day event.");
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        return (type.Code, title, date, time, note);
    }

    private IQueryable<Matter> VisibleMatters() =>
        visibility.WhereMatterRowVisible(db.Set<Matter>(), m => m.IsSensitive, m => m.PrimaryManagerId, m => m.SecondaryManagerId);

    private IQueryable<EventRow> Rows() =>
        from e in db.Set<MatterEvent>().AsNoTracking()
        join m in VisibleMatters().AsNoTracking() on e.MatterId equals m.Id
        join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
        select new EventRow
        {
            Event = e,
            MatterRef = m.MatterRef,
            MatterName = m.Name,
            IsSensitive = m.IsSensitive,
            MatterIsActive = m.IsActive,
            PrimaryManagerId = m.PrimaryManagerId,
            SecondaryManagerId = m.SecondaryManagerId,
            ClientId = c.Id,
            ClientName = c.Name,
        };

    private async Task<IReadOnlyDictionary<int, UserInfo>> NamesAsync(IReadOnlyList<EventRow> rows, CancellationToken ct)
    {
        var ids = rows.SelectMany(r => new[] { r.Event.CreatedByUserId, r.Event.ModifiedByUserId }).OfType<int>().Distinct().ToList();
        return ids.Count == 0 ? new Dictionary<int, UserInfo>() : await users.FindManyAsync(ids, ct);
    }

    private static MatterEventResponse ToResponse(EventRow r, IReadOnlyDictionary<int, UserInfo> names, bool canEdit)
    {
        var e = r.Event;
        var type = MatterEventTypes.Find(e.EventTypeCode) ?? MatterEventTypes.All[^1];
        return new MatterEventResponse(
            e.Id,
            e.MatterId,
            r.MatterRef,
            r.MatterName,
            r.ClientId,
            r.ClientName,
            r.IsSensitive,
            type.Code,
            type.Label,
            type.IconKey,
            type.ColourKey,
            e.Title,
            e.EventDate,
            MatterEventTime.Format(e.EventTime),
            e.Note,
            canEdit,
            OrganizationSupport.Utc(e.CreatedAtUtc),
            e.CreatedByUserId is { } c && names.TryGetValue(c, out var cu) ? cu.DisplayName : null,
            OrganizationSupport.Utc(e.ModifiedAtUtc),
            e.ModifiedByUserId is { } m && names.TryGetValue(m, out var mu) ? mu.DisplayName : null,
            OrganizationSupport.Encode(e.RowVersion));
    }
}
