using System.Globalization;
using LptHub.Audit.Contracts;
using LptHub.Configuration.Contracts;
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
/// A matter's team (epic #1298): typed-in contacts (name, e-mail, title), not user accounts. Add, edit, remove and a paged, sortable list. The e-mail is unique within the
/// matter without regard to case (409 <c>DUPLICATE_TEAM_EMAIL</c>). Every add, change and removal is written to the audit log. The Team never affects
/// visibility, My Matters or permissions. A matter the caller may not see (sensitive-matter rule) is reported as not found.
/// </summary>
public sealed class MatterTeamService(DbContext db, IAuditWriter audit, IMatterListCatalog lists, IMatterVisibility visibility)
{
    private IQueryable<Matter> VisibleMatters() =>
        visibility.WhereMatterRowVisible(db.Set<Matter>().AsNoTracking(), m => m.IsSensitive, m => m.PrimaryManagerId, m => m.SecondaryManagerId);

    private Task<bool> CanSeeAsync(int matterId, CancellationToken ct) => VisibleMatters().AnyAsync(m => m.Id == matterId, ct);

    public const string SortName = "name";
    public const string SortEmail = "email";
    public const string SortTitle = "title";

    public static readonly string[] SortFields = [SortName, SortEmail, SortTitle];

    private static readonly Dictionary<string, Func<IQueryable<TeamRow>, bool, bool, IOrderedQueryable<TeamRow>>> Orderings = new()
    {
        [SortName] = OrganizationSupport.By<TeamRow, string>(r => r.Member.Name),
        [SortEmail] = OrganizationSupport.By<TeamRow, string>(r => r.Member.Email),
        [SortTitle] = OrganizationSupport.By<TeamRow, string>(r => r.TitleName),
    };

    /// <summary>One page of the team, sorted by name (default), email or title (a minus sign sorts the other way). Ties keep the order the people were added.</summary>
    public async Task<Result<PagedResult<MatterTeamMemberResponse>>> ListAsync(int matterId, TeamListQuery query, CancellationToken ct)
    {
        if (!await CanSeeAsync(matterId, ct))
            return OrganizationSupport.NotFound("Matter");

        var paging = OrganizationSupport.PagingOf(query, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        var (page, sort) = paging.Value;
        var members = db.Set<MatterTeamMember>().AsNoTracking().Where(t => t.MatterId == matterId);
        var total = await members.CountAsync(ct);

        // The title names are sorted inside the statement (a join on the list keys the Configuration module offers).
        var rows = from t in members
                   join k in lists.Keys(MatterListKind.TeamTitle) on t.TeamTitleId equals k.Id into joined
                   from k in joined.DefaultIfEmpty()
                   select new TeamRow { Member = t, TitleName = k.Name };
        var items = await OrganizationSupport.ApplySort(rows, OrganizationSupport.WithDefaultTail(sort, new SortField(SortName, false)), Orderings, r => r.Member.Id)
            .Skip(page.Skip)
            .Take(page.PageSize)
            .ToListAsync(ct);
        var titles = await MatterListNames.LoadAsync(lists, MatterListKind.TeamTitle, ct);
        return OrganizationSupport.Page(items.Select(r => ToResponse(r.Member, titles)).ToList(), total, page);
    }

    private sealed class TeamRow
    {
        public MatterTeamMember Member { get; init; } = null!;

        public string TitleName { get; init; } = string.Empty;
    }

    public async Task<Result<MatterTeamMemberResponse>> AddAsync(int matterId, AddTeamMemberRequest request, CancellationToken ct)
    {
        if (!await CanSeeAsync(matterId, ct))
            return OrganizationSupport.NotFound("Matter");

        var clean = Clean(request.Name, request.Email);
        if (clean.IsFailure)
            return clean.Error!;

        var titles = await MatterListNames.LoadAsync(lists, MatterListKind.TeamTitle, ct);
        var title = CheckTitle(titles, request.TeamTitleId, null);
        if (title.IsFailure)
            return title.Error!;

        if (await EmailTakenAsync(matterId, clean.Value.Email, null, ct) is { } existing)
            return DuplicateEmail(clean.Value.Email, existing);

        var max = await db.Set<MatterTeamMember>().Where(t => t.MatterId == matterId).MaxAsync(t => (int?)t.SortOrder, ct) ?? 0;
        var member = new MatterTeamMember
        {
            MatterId = matterId,
            Name = clean.Value.Name,
            Email = clean.Value.Email,
            TeamTitleId = request.TeamTitleId,
            SortOrder = max + 1,
        };
        db.Set<MatterTeamMember>().Add(member);
        Audit(OrganizationAuditEvents.MatterTeamMemberAdded, matterId, null, Describe(member, titles), $"Team member added: {member.Name} ({title.Value.Name}).");
        var failure = await SaveAsync(matterId, clean.Value.Email, ct);
        return failure is not null ? failure : ToResponse(member, titles);
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

        var clean = Clean(request.Name, request.Email);
        if (clean.IsFailure)
            return clean.Error!;

        var titles = await MatterListNames.LoadAsync(lists, MatterListKind.TeamTitle, ct);
        var title = CheckTitle(titles, request.TeamTitleId, member.TeamTitleId);
        if (title.IsFailure)
            return title.Error!;

        if (await EmailTakenAsync(matterId, clean.Value.Email, memberId, ct) is { } existing)
            return DuplicateEmail(clean.Value.Email, existing);

        var before = Describe(member, titles);
        var changed = member.Name != clean.Value.Name || member.Email != clean.Value.Email || member.TeamTitleId != request.TeamTitleId;
        member.Name = clean.Value.Name;
        member.Email = clean.Value.Email;
        member.TeamTitleId = request.TeamTitleId;
        if (changed)
            Audit(OrganizationAuditEvents.MatterTeamMemberChanged, matterId, before, Describe(member, titles), $"Team member updated: {member.Name}.");

        OrganizationSupport.TrackOriginalRowVersion(db, member, request.RowVersion);
        var failure = await SaveAsync(matterId, clean.Value.Email, ct);
        return failure is not null ? failure : ToResponse(member, titles);
    }

    public async Task<Result> RemoveAsync(int matterId, int memberId, CancellationToken ct)
    {
        if (!await CanSeeAsync(matterId, ct))
            return OrganizationSupport.NotFound("Matter");

        var member = await db.Set<MatterTeamMember>().SingleOrDefaultAsync(t => t.Id == memberId && t.MatterId == matterId, ct);
        if (member is null)
            return Result.Success(); // already gone: the goal is reached

        var titles = await MatterListNames.LoadAsync(lists, MatterListKind.TeamTitle, ct);
        db.Set<MatterTeamMember>().Remove(member);
        Audit(OrganizationAuditEvents.MatterTeamMemberRemoved, matterId, Describe(member, titles), null, $"Team member removed: {member.Name}.");
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

    private static Result<(string Name, string Email)> Clean(string? name, string? email)
    {
        var n = MatterFieldRules.CleanName(name);
        if (n.IsFailure)
            return n.Error!;

        var e = MatterFieldRules.CleanEmail(email);
        if (e.IsFailure)
            return e.Error!;

        return (n.Value, e.Value);
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

    /// <summary>The id of the member who already has the e-mail on this matter (the column compares without regard to case), or null.</summary>
    private Task<int?> EmailTakenAsync(int matterId, string email, int? exceptId, CancellationToken ct) =>
        db.Set<MatterTeamMember>().AsNoTracking()
            .Where(t => t.MatterId == matterId && t.Email == email && (exceptId == null || t.Id != exceptId))
            .Select(t => (int?)t.Id)
            .FirstOrDefaultAsync(ct);

    private static Error DuplicateEmail(string email, int existingMemberId) =>
        new(
            ErrorType.Conflict,
            ErrorCodes.DuplicateTeamEmail,
            $"{email} is already on this matter's team.",
            new Dictionary<string, IReadOnlyList<FieldError>> { ["email"] = [new FieldError(ErrorCodes.DuplicateTeamEmail, $"{email} is already on this matter's team.")] },
            new Dictionary<string, object?> { ["existingId"] = existingMemberId });

    private async Task<Error?> SaveAsync(int matterId, string email, CancellationToken ct)
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
        catch (DbUpdateException ex) when (OrganizationSupport.IsUniqueViolation(ex, OrganizationSupport.TeamEmailUnique))
        {
            db.ChangeTracker.Clear(); // a concurrent request added the same e-mail between the check and the insert
            return DuplicateEmail(email, await EmailTakenAsync(matterId, email, null, ct) ?? 0);
        }
        catch (DbUpdateException ex) when (OrganizationSupport.IsForeignKeyViolation(ex))
        {
            db.ChangeTracker.Clear();
            return OrganizationSupport.NotFound("Matter");
        }
    }

    private static string Describe(MatterTeamMember m, IReadOnlyDictionary<int, MatterListItemInfo> titles) =>
        $"{m.Name} <{m.Email}> ({(titles.TryGetValue(m.TeamTitleId, out var t) ? t.Name : "Title " + m.TeamTitleId.ToString(CultureInfo.InvariantCulture))})";

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

    private static MatterTeamMemberResponse ToResponse(MatterTeamMember m, IReadOnlyDictionary<int, MatterListItemInfo> titles) => new(
        m.Id,
        m.MatterId,
        m.Name,
        m.Email,
        MatterListNames.RefOf(titles, m.TeamTitleId) ?? new MatterListRef(m.TeamTitleId, "Title " + m.TeamTitleId.ToString(CultureInfo.InvariantCulture), false),
        m.SortOrder,
        OrganizationSupport.Encode(m.RowVersion));
}

/// <summary>How many matters carry each Matter Type / Current State, and how many team members carry each Team Title (the admin lists' In Use column; delete only at 0).</summary>
public sealed class MatterListUsage(DbContext db) : IMatterListUsage
{
    public async Task<IReadOnlyDictionary<int, int>> CountsAsync(MatterListKind kind, CancellationToken cancellationToken = default)
    {
        var rows = kind switch
        {
            MatterListKind.MatterType => await db.Set<Matter>().AsNoTracking().Where(m => m.MatterTypeId != null)
                .GroupBy(m => m.MatterTypeId!.Value).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync(cancellationToken),
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
