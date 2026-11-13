using System.Globalization;
using LptHub.Audit.Contracts;
using LptHub.Configuration.Contracts;
using LptHub.Identity.Contracts;
using LptHub.Organization.Domain;
using LptHub.SharedKernel.Paging;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Organization.Application;

/// <summary>Names of the items of the matter pick lists, for the answers and the audit texts.</summary>
internal static class MatterListNames
{
    public static async Task<IReadOnlyDictionary<int, MatterListItemInfo>> LoadAsync(IMatterListCatalog lists, MatterListKind kind, CancellationToken ct) =>
        (await lists.ListAsync(kind, true, ct)).ToDictionary(i => i.Id);

    public static MatterListRef? RefOf(IReadOnlyDictionary<int, MatterListItemInfo> items, int? id) =>
        id is { } v && items.TryGetValue(v, out var item) ? new MatterListRef(item.Id, item.Name, item.IsActive) : null;
}

/// <summary>
/// A matter's team (epic #1298, People #1376): people of the shared People list with the title they have on this matter. Add (a person and a title), change the title,
/// remove and a paged, sortable list. The people are read through <see cref="IPersonDirectory"/> (the Identity module owns them), so the list is sorted and paged here,
/// after the read: a team is a handful of rows. A person is on a matter once (409 <c>DUPLICATE_TEAM_PERSON</c>); a deactivated person cannot be added but stays on the
/// matters that already have them. Every add, change and removal is written to the audit log. The Team never affects visibility, My Matters or permissions. A matter the
/// caller may not see (sensitive-matter rule) is reported as not found.
/// </summary>
public sealed class MatterTeamService(DbContext db, IAuditWriter audit, IMatterListCatalog lists, IMatterVisibility visibility, IPersonDirectory people)
{
    private IQueryable<Matter> VisibleMatters() =>
        visibility.WhereMatterRowVisible(db.Set<Matter>().AsNoTracking(), m => m.IsSensitive, m => m.PrimaryManagerId, m => m.SecondaryManagerId);

    private Task<bool> CanSeeAsync(int matterId, CancellationToken ct) => VisibleMatters().AnyAsync(m => m.Id == matterId, ct);

    public const string SortName = "name";
    public const string SortEmail = "email";
    public const string SortTitle = "title";

    public static readonly string[] SortFields = [SortName, SortEmail, SortTitle];

    /// <summary>One page of the team, sorted by name (default), email or the title on the matter (a minus sign sorts the other way). Ties keep the order the people were added.</summary>
    public async Task<Result<PagedResult<MatterTeamMemberResponse>>> ListAsync(int matterId, TeamListQuery query, CancellationToken ct)
    {
        if (!await CanSeeAsync(matterId, ct))
            return OrganizationSupport.NotFound("Matter");

        var paging = OrganizationSupport.PagingOf(query, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        var (page, sort) = paging.Value;
        var members = await db.Set<MatterTeamMember>().AsNoTracking().Where(t => t.MatterId == matterId).OrderBy(t => t.Id).ToListAsync(ct);
        var titles = await MatterListNames.LoadAsync(lists, MatterListKind.TeamTitle, ct);
        var persons = await people.FindManyAsync(members.Select(m => m.PersonId).ToList(), ct);
        var rows = members.Select(m => ToResponse(m, persons, titles)).ToList();

        var ordered = rows.AsEnumerable();
        var first = true;
        IReadOnlyList<SortField> fields = sort.Count == 0 ? [new SortField(SortName, false)] : sort;
        foreach (var field in fields)
        {
            Func<MatterTeamMemberResponse, string> key = field.Field switch
            {
                SortEmail => r => r.Email ?? string.Empty,
                SortTitle => r => r.Title.Name,
                _ => r => r.Name,
            };
            var comparer = StringComparer.OrdinalIgnoreCase;
            ordered = first
                ? (field.Descending ? ordered.OrderByDescending(key, comparer) : ordered.OrderBy(key, comparer))
                : (field.Descending ? ((IOrderedEnumerable<MatterTeamMemberResponse>)ordered).ThenByDescending(key, comparer) : ((IOrderedEnumerable<MatterTeamMemberResponse>)ordered).ThenBy(key, comparer));
            first = false;
        }

        var items = ((IOrderedEnumerable<MatterTeamMemberResponse>)ordered).ThenBy(r => r.Id).Skip(page.Skip).Take(page.PageSize).ToList();
        return OrganizationSupport.Page(items, rows.Count, page);
    }

    public async Task<Result<MatterTeamMemberResponse>> AddAsync(int matterId, AddTeamMemberRequest request, CancellationToken ct)
    {
        if (!await CanSeeAsync(matterId, ct))
            return OrganizationSupport.NotFound("Matter");

        var persons = await people.FindManyAsync([request.PersonId], ct);
        var person = CheckPerson(persons, request.PersonId);
        if (person.IsFailure)
            return person.Error!;

        var titles = await MatterListNames.LoadAsync(lists, MatterListKind.TeamTitle, ct);
        var title = CheckTitle(titles, request.TeamTitleId, null);
        if (title.IsFailure)
            return title.Error!;

        if (await PersonTakenAsync(matterId, request.PersonId, null, ct) is { } existing)
            return DuplicatePerson(person.Value.DisplayName, existing);

        var max = await db.Set<MatterTeamMember>().Where(t => t.MatterId == matterId).MaxAsync(t => (int?)t.SortOrder, ct) ?? 0;
        var member = new MatterTeamMember
        {
            MatterId = matterId,
            PersonId = request.PersonId,
            TeamTitleId = request.TeamTitleId,
            SortOrder = max + 1,
        };
        db.Set<MatterTeamMember>().Add(member);
        Audit(OrganizationAuditEvents.MatterTeamMemberAdded, matterId, null, Describe(member, persons, titles), $"Team member added: {person.Value.DisplayName} ({title.Value.Name}).");
        var failure = await SaveAsync(matterId, member.PersonId, person.Value.DisplayName, ct);
        return failure is not null ? failure : ToResponse(member, persons, titles);
    }

    public async Task<Result<MatterTeamMemberResponse>> UpdateAsync(int matterId, int memberId, UpdateTeamMemberRequest request, CancellationToken ct)
    {
        if (!await CanSeeAsync(matterId, ct))
            return OrganizationSupport.NotFound("Matter");

        var member = await db.Set<MatterTeamMember>().SingleOrDefaultAsync(t => t.Id == memberId && t.MatterId == matterId, ct);
        if (member is null)
            return OrganizationSupport.NotFound("Team member");

        var version = OrganizationSupport.CheckRowVersion(member.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var titles = await MatterListNames.LoadAsync(lists, MatterListKind.TeamTitle, ct);
        var title = CheckTitle(titles, request.TeamTitleId, member.TeamTitleId);
        if (title.IsFailure)
            return title.Error!;

        var persons = await people.FindManyAsync([member.PersonId], ct);
        var before = Describe(member, persons, titles);
        var changed = member.TeamTitleId != request.TeamTitleId;
        member.TeamTitleId = request.TeamTitleId;
        if (changed)
            Audit(OrganizationAuditEvents.MatterTeamMemberChanged, matterId, before, Describe(member, persons, titles), $"Team member updated: {NameOf(persons, member.PersonId)}.");

        OrganizationSupport.TrackOriginalRowVersion(db, member, request.RowVersion);
        var failure = await SaveAsync(matterId, member.PersonId, NameOf(persons, member.PersonId), ct);
        return failure is not null ? failure : ToResponse(member, persons, titles);
    }

    public async Task<Result> RemoveAsync(int matterId, int memberId, CancellationToken ct)
    {
        if (!await CanSeeAsync(matterId, ct))
            return OrganizationSupport.NotFound("Matter");

        var member = await db.Set<MatterTeamMember>().SingleOrDefaultAsync(t => t.Id == memberId && t.MatterId == matterId, ct);
        if (member is null)
            return Result.Success(); // already gone: the goal is reached

        var titles = await MatterListNames.LoadAsync(lists, MatterListKind.TeamTitle, ct);
        var persons = await people.FindManyAsync([member.PersonId], ct);
        db.Set<MatterTeamMember>().Remove(member);
        Audit(OrganizationAuditEvents.MatterTeamMemberRemoved, matterId, Describe(member, persons, titles), null, $"Team member removed: {NameOf(persons, member.PersonId)}.");
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear(); // already removed by someone else: the goal is reached
        }

        return Result.Success();
    }

    /// <summary>The person must exist and be active (a deactivated person stays on the matters that have them but is not added again).</summary>
    private static Result<PersonSummary> CheckPerson(IReadOnlyDictionary<int, PersonSummary> persons, int id)
    {
        if (!persons.TryGetValue(id, out var person))
            return Error.Validation("personId", "NOT_FOUND", "Choose a person from the list.");
        if (!person.IsActive)
            return Error.Validation("personId", "INACTIVE", $"{person.DisplayName} is deactivated in People. Reactivate them there first.");
        if (person.PersonType != "INTERNAL")
            return Error.Validation("personId", "NOT_INTERNAL", $"{person.DisplayName} is an external person. Only Internal people can be on a matter team.");
        return person;
    }

    /// <summary>The title must exist, and be active unless it is the member's current one.</summary>
    private static Result<MatterListItemInfo> CheckTitle(IReadOnlyDictionary<int, MatterListItemInfo> titles, int id, int? current)
    {
        if (!titles.TryGetValue(id, out var title))
            return Error.Validation("teamTitleId", "NOT_FOUND", "Choose a title from the list.");
        if (!title.IsActive && id != current)
            return Error.Validation("teamTitleId", "INACTIVE", $"The title '{title.Name}' is no longer offered. Choose another.");
        return title;
    }

    /// <summary>The id of the member who already is this person on this matter, or null.</summary>
    private Task<int?> PersonTakenAsync(int matterId, int personId, int? exceptId, CancellationToken ct) =>
        db.Set<MatterTeamMember>().AsNoTracking()
            .Where(t => t.MatterId == matterId && t.PersonId == personId && (exceptId == null || t.Id != exceptId))
            .Select(t => (int?)t.Id)
            .FirstOrDefaultAsync(ct);

    private static Error DuplicatePerson(string name, int existingMemberId) =>
        new(
            ErrorType.Conflict,
            ErrorCodes.DuplicateTeamPerson,
            $"{name} is already on this matter's team.",
            new Dictionary<string, IReadOnlyList<FieldError>> { ["personId"] = [new FieldError(ErrorCodes.DuplicateTeamPerson, $"{name} is already on this matter's team.")] },
            new Dictionary<string, object?> { ["existingId"] = existingMemberId });

    private async Task<Error?> SaveAsync(int matterId, int personId, string name, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return OrganizationSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (OrganizationSupport.IsUniqueViolation(ex, OrganizationSupport.TeamPersonUnique))
        {
            db.ChangeTracker.Clear(); // a concurrent request added the same person between the check and the insert
            return DuplicatePerson(name, await PersonTakenAsync(matterId, personId, null, ct) ?? 0);
        }
        catch (DbUpdateException ex) when (OrganizationSupport.IsForeignKeyViolation(ex))
        {
            db.ChangeTracker.Clear();
            return OrganizationSupport.NotFound("Matter");
        }
    }

    private static string NameOf(IReadOnlyDictionary<int, PersonSummary> persons, int personId) =>
        persons.TryGetValue(personId, out var p) ? p.DisplayName : "Person " + personId.ToString(CultureInfo.InvariantCulture);

    private static string Describe(MatterTeamMember m, IReadOnlyDictionary<int, PersonSummary> persons, IReadOnlyDictionary<int, MatterListItemInfo> titles) =>
        $"{NameOf(persons, m.PersonId)} ({(titles.TryGetValue(m.TeamTitleId, out var t) ? t.Name : "Title " + m.TeamTitleId.ToString(CultureInfo.InvariantCulture))})";

    private void Audit(string eventType, int matterId, string? oldValue, string? newValue, string summary) =>
        audit.Write(new AuditEntry
        {
            EventType = eventType,
            ObjectType = nameof(Matter),
            ObjectId = matterId.ToString(CultureInfo.InvariantCulture),
            MatterId = matterId,
            FieldKey = "Team",
            OldValue = oldValue,
            NewValue = newValue,
            Summary = summary,
        });

    private static MatterTeamMemberResponse ToResponse(
        MatterTeamMember m,
        IReadOnlyDictionary<int, PersonSummary> persons,
        IReadOnlyDictionary<int, MatterListItemInfo> titles)
    {
        persons.TryGetValue(m.PersonId, out var p);
        return new MatterTeamMemberResponse(
            m.Id,
            m.MatterId,
            m.PersonId,
            NameOf(persons, m.PersonId),
            p?.PersonType ?? "EXTERNAL",
            p?.UserId is not null,
            p?.Title,
            p?.Email,
            p?.CompanyName,
            MatterListNames.RefOf(titles, m.TeamTitleId) ?? new MatterListRef(m.TeamTitleId, "Title " + m.TeamTitleId.ToString(CultureInfo.InvariantCulture), false),
            m.SortOrder,
            OrganizationSupport.Encode(m.RowVersion));
    }
}

/// <summary>How many matters carry each Matter Type / Current State, and how many team members carry each Team Title (the admin lists' In Use column; delete only at 0).</summary>
public sealed class MatterListUsage(DbContext db) : IMatterListUsage
{
    public async Task<IReadOnlyDictionary<int, int>> CountsAsync(MatterListKind kind, CancellationToken cancellationToken = default)
    {
        var rows = kind switch
        {
            MatterListKind.MatterType => await db.Set<MatterMatterType>().AsNoTracking()
                .GroupBy(t => t.MatterTypeId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(cancellationToken),
            MatterListKind.MatterCategory => await db.Set<Matter>().AsNoTracking().Where(m => m.MatterCategoryId != null)
                .GroupBy(m => m.MatterCategoryId!.Value).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(cancellationToken),
            MatterListKind.CurrentState => await db.Set<Matter>().AsNoTracking().Where(m => m.CurrentStateId != null)
                .GroupBy(m => m.CurrentStateId!.Value).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(cancellationToken),
            MatterListKind.TeamTitle => await db.Set<MatterTeamMember>().AsNoTracking()
                .GroupBy(t => t.TeamTitleId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        return rows.ToDictionary(r => r.Id, r => r.Count);
    }
}
