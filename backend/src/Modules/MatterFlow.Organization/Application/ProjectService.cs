using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.ValueObjects;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

public sealed class ProjectService(DbContext db, IAuditWriter audit, CustomFieldValues custom, IOrganizationTaskCounts taskCounts, IPermissionChecker permissions, IMatterVisibility visibility)
{
    public static readonly string[] SortFields = ["name", "matterRef", "createdAt", OrganizationSupport.SortOpenTasks, OrganizationSupport.SortOverdue];

    private bool CanCountTasks => permissions.Has(Permissions.Task.View);

    private static readonly Dictionary<string, Func<IQueryable<ProjectRow>, bool, bool, IOrderedQueryable<ProjectRow>>> Orderings = new()
    {
        ["name"] = OrganizationSupport.By<ProjectRow, string>(r => r.Project.Name),
        ["matterRef"] = OrganizationSupport.By<ProjectRow, string>(r => r.MatterRef),
        ["createdAt"] = OrganizationSupport.By<ProjectRow, DateTime>(r => r.Project.CreatedAtUtc),
        [OrganizationSupport.SortOpenTasks] = OrganizationSupport.By<ProjectRow, int>(r => r.Open),
        [OrganizationSupport.SortOverdue] = OrganizationSupport.By<ProjectRow, int>(r => r.Overdue),
    };

    public async Task<Result<PagedResult<ProjectResponse>>> ListAsync(ProjectListQuery query, CancellationToken ct)
    {
        var paging = OrganizationSupport.PagingOf(query, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        var (page, sort) = paging.Value;
        var rows = Rows();
        if (query.MatterId is { } matterId)
            rows = rows.Where(r => r.Project.MatterId == matterId);
        if (query.IsActive is { } active)
            rows = rows.Where(r => r.Project.IsActive == active);

        var q = query.Q?.Trim();
        if (!string.IsNullOrEmpty(q))
        {
            if (MatterService.TryParsePair(q, out var clientNumber, out var matterNumber))
            {
                var reference = $"{clientNumber}-{matterNumber}";
                rows = rows.Where(r => r.MatterRef == reference);
            }
            else
            {
                rows = rows.Where(r => r.Project.Name.Contains(q) || r.MatterName.Contains(q));
            }
        }

        // Column filters (each box searches its own column, parameterised Contains; % and _ are literal).
        if (query.Name?.Trim() is { Length: > 0 } name)
            rows = rows.Where(r => r.Project.Name.Contains(name));
        if (query.Matter?.Trim() is { Length: > 0 } matter)
        {
            rows = MatterService.TryParsePair(matter, out var pairClient, out var pairMatter)
                ? rows.Where(r => r.MatterRef == $"{pairClient}-{pairMatter}" || r.MatterRef.Contains(matter) || r.MatterName.Contains(matter))
                : rows.Where(r => r.MatterRef.Contains(matter) || r.MatterName.Contains(matter));
        }

        var total = await rows.CountAsync(ct);

        // The count sorts need the counts inside the statement (one grouped left join); without Task.View they are constants, so the order falls back to the default.
        var canCount = CanCountTasks;
        var joinCounts = canCount && sort.Any(f => OrganizationSupport.IsCountSort(f.Field));
        if (joinCounts)
        {
            rows = from r in rows
                   join g in taskCounts.Grouped(TaskCountScope.Project) on r.Project.Id equals g.Key into joined
                   from g in joined.DefaultIfEmpty()
                   select new ProjectRow
                   {
                       Project = r.Project,
                       ClientNumber = r.ClientNumber,
                       ClientName = r.ClientName,
                       MatterRef = r.MatterRef,
                       MatterName = r.MatterName,
                       MatterIsActive = r.MatterIsActive,
                       Open = (int?)g.Open ?? 0,
                       Overdue = (int?)g.Overdue ?? 0,
                   };
        }

        var items = await OrganizationSupport.ApplySort(rows, OrganizationSupport.WithDefaultTail(sort, new SortField("name", false)), Orderings, r => r.Project.Id)
            .Skip(page.Skip)
            .Take(page.PageSize)
            .ToListAsync(ct);

        IReadOnlyDictionary<int, TaskCountRow> byProject = canCount && !joinCounts
            ? await taskCounts.ForKeysAsync(TaskCountScope.Project, [.. items.Select(r => r.Project.Id)], ct)
            : new Dictionary<int, TaskCountRow>();
        return OrganizationSupport.Page(
            items.Select(r => ToResponse(
                r,
                !canCount ? null : joinCounts ? r.Open : byProject.GetValueOrDefault(r.Project.Id)?.Open ?? 0,
                !canCount ? null : joinCounts ? r.Overdue : byProject.GetValueOrDefault(r.Project.Id)?.Overdue ?? 0)).ToList(),
            total,
            page);
    }

    /// <summary>Counts for the Project overview strip (#259): the five Task numbers over the Project's Tasks.</summary>
    public async Task<Result<ProjectSummaryResponse>> SummaryAsync(int id, CancellationToken ct)
    {
        if (!await ProjectSet().AsNoTracking().AnyAsync(p => p.Id == id, ct))
            return OrganizationSupport.NotFound("Project");

        if (!CanCountTasks)
            return new ProjectSummaryResponse(id, null, null, null, null, null);

        var strip = await taskCounts.StripAsync(TaskCountScope.Project, id, ct);
        return new ProjectSummaryResponse(id, strip.Open, strip.Overdue, strip.Asap, strip.OnHold, strip.DueSoon);
    }

    public async Task<Result<ProjectResponse>> GetAsync(int id, CancellationToken ct) => await GetAsync(id, [], true, ct);

    /// <summary><paramref name="restricted"/> false is the answer right after a successful write (the actor just changed the project).</summary>
    private async Task<Result<ProjectResponse>> GetAsync(int id, IReadOnlyList<string> dropped, bool restricted, CancellationToken ct)
    {
        var row = await Rows(restricted).Where(r => r.Project.Id == id).SingleOrDefaultAsync(ct);
        if (row is null)
            return OrganizationSupport.NotFound("Project");

        int? open = null, overdue = null;
        if (CanCountTasks)
        {
            var counts = await taskCounts.ForKeysAsync(TaskCountScope.Project, [id], ct);
            open = counts.GetValueOrDefault(id)?.Open ?? 0;
            overdue = counts.GetValueOrDefault(id)?.Overdue ?? 0;
        }

        return ToResponse(row, open, overdue, await custom.ReadAsync(CustomFieldTarget.Project, id, ct), dropped);
    }

    public async Task<Result<ProjectResponse>> CreateAsync(CreateProjectRequest request, CancellationToken ct)
    {
        if (!await MatterSet().AnyAsync(m => m.Id == request.MatterId, ct))
            return Error.Validation("matterId", "NOT_FOUND", "Select a matter.");

        var name = request.Name.Trim();
        var existing = await FindIdByNameAsync(request.MatterId, name, null, ct);
        if (existing is not null)
            return DuplicateName(name, existing);

        var plan = await custom.PlanCreateAsync(CustomFieldTarget.Project, request.FormValues, ct);
        if (plan.IsFailure)
            return plan.Error!;

        var project = new Project
        {
            MatterId = request.MatterId,
            Name = name,
            Description = Clean(request.Description),
        };
        db.Set<Project>().Add(project);
        audit.Write(new AuditEntry
        {
            EventType = OrganizationAuditEvents.ProjectCreated,
            ObjectType = nameof(Project),
            ObjectIdFactory = () => project.Id.ToString(CultureInfo.InvariantCulture),
            MatterId = request.MatterId,
            NewValue = name,
            Summary = $"Project '{name}' created.",
        });

        IReadOnlyList<string> dropped = [];
        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (OrganizationSupport.IsUniqueViolation(ex, OrganizationSupport.ProjectNameUnique))
            {
                db.ChangeTracker.Clear();
                return DuplicateName(name, await FindIdByNameAsync(request.MatterId, name, null, ct));
            }

            if (plan.Value is { } formPlan)
            {
                var saved = await custom.SaveAsync(CustomFieldTarget.Project, project.Id, request.MatterId, formPlan, ct);
                if (saved.IsFailure)
                {
                    db.ChangeTracker.Clear();
                    return saved.Error!;
                }

                dropped = saved.Value;
            }

            await transaction.CommitAsync(ct);
        }

        return await GetAsync(project.Id, dropped, false, ct);
    }

    public async Task<Result<ProjectResponse>> UpdateAsync(int id, UpdateProjectRequest request, CancellationToken ct)
    {
        var project = await ProjectSet().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (project is null)
            return OrganizationSupport.NotFound("Project");

        var version = OrganizationSupport.CheckRowVersion(project.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var name = request.Name.Trim();
        if (!string.Equals(name, project.Name, StringComparison.OrdinalIgnoreCase))
        {
            var existing = await FindIdByNameAsync(project.MatterId, name, id, ct);
            if (existing is not null)
                return DuplicateName(name, existing);
        }

        var plan = await custom.PlanUpdateAsync(CustomFieldTarget.Project, id, request.FormValues, ct);
        if (plan.IsFailure)
            return plan.Error!;

        var matterId = project.MatterId;
        project.Name = name;
        project.Description = Clean(request.Description);
        OrganizationSupport.TrackOriginalRowVersion(db, project, request.RowVersion);

        IReadOnlyList<string> dropped = [];
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            if (plan.Value is { } formPlan)
            {
                var saved = await custom.SaveAsync(CustomFieldTarget.Project, id, matterId, formPlan, ct);
                if (saved.IsFailure)
                {
                    db.ChangeTracker.Clear();
                    return saved.Error!;
                }

                dropped = saved.Value;
            }

            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (OrganizationSupport.IsUniqueViolation(ex, OrganizationSupport.ProjectNameUnique))
        {
            db.ChangeTracker.Clear();
            return DuplicateName(name, await FindIdByNameAsync(matterId, name, id, ct));
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return OrganizationSupport.ConcurrencyError();
        }

        return await GetAsync(id, dropped, false, ct);
    }

    /// <summary>Archives (inactive) or restores a Project. Existing Tasks keep it; new Tasks cannot select an inactive Project.</summary>
    public async Task<Result<ProjectResponse>> SetActiveAsync(int id, SetActiveRequest request, CancellationToken ct)
    {
        var project = await ProjectSet().SingleOrDefaultAsync(p => p.Id == id, ct);
        if (project is null)
            return OrganizationSupport.NotFound("Project");

        var version = OrganizationSupport.CheckRowVersion(project.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        if (project.IsActive != request.IsActive)
        {
            project.IsActive = request.IsActive;
            OrganizationSupport.TrackOriginalRowVersion(db, project, request.RowVersion);
            await db.SaveChangesAsync(ct);
        }

        return await GetAsync(id, [], false, ct);
    }

    /// <summary>The matters the caller may see (the sensitive-matter rule; everything while it is off); projects follow their matter (mode M).</summary>
    private IQueryable<Matter> MatterSet() =>
        visibility.WhereMatterRowVisible(db.Set<Matter>(), m => m.IsSensitive, m => m.PrimaryManagerId, m => m.SecondaryManagerId);

    /// <summary>The projects of matters the caller may see.</summary>
    private IQueryable<Project> ProjectSet() => visibility.WhereMatterVisible(db.Set<Project>(), p => p.MatterId);

    private IQueryable<ProjectRow> Rows(bool restricted = true) =>
        from p in db.Set<Project>().AsNoTracking()
        join m in (restricted ? MatterSet() : db.Set<Matter>()).AsNoTracking() on p.MatterId equals m.Id
        join c in db.Set<Client>().AsNoTracking() on m.ClientId equals c.Id
        select new ProjectRow { Project = p, ClientNumber = m.ClientNumber, ClientName = c.Name, MatterRef = m.MatterRef, MatterName = m.Name, MatterIsActive = m.IsActive, Open = 0, Overdue = 0 };

    private async Task<int?> FindIdByNameAsync(int matterId, string name, int? exceptId, CancellationToken ct) =>
        await db.Set<Project>().AsNoTracking()
            .Where(p => p.MatterId == matterId && p.Name == name && (exceptId == null || p.Id != exceptId))
            .Select(p => (int?)p.Id)
            .FirstOrDefaultAsync(ct);

    private static Error DuplicateName(string name, int? existingId) =>
        OrganizationSupport.Duplicate(ErrorCodes.DuplicateName, "name", $"A project named '{name}' already exists in this matter.", existingId);

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static ProjectResponse ToResponse(ProjectRow r, int? openTaskCount, int? overdueTaskCount, CustomFieldView? view = null, IReadOnlyList<string>? dropped = null) => new(
        r.Project.Id,
        r.Project.MatterId,
        r.ClientNumber.Value,
        r.ClientName,
        r.MatterRef,
        r.MatterName,
        r.MatterIsActive,
        r.Project.Name,
        r.Project.Description,
        r.Project.IsActive,
        openTaskCount,
        overdueTaskCount,
        view?.FormVersionId,
        view?.PublishedFormVersionId,
        view?.Values,
        dropped ?? [],
        OrganizationSupport.Encode(r.Project.RowVersion),
        OrganizationSupport.Utc(r.Project.CreatedAtUtc),
        OrganizationSupport.Utc(r.Project.ModifiedAtUtc));

    internal sealed class ProjectRow
    {
        public Project Project { get; init; } = null!;

        public string MatterRef { get; init; } = string.Empty;

        public string MatterName { get; init; } = string.Empty;

        public bool MatterIsActive { get; init; }

        public BusinessNumber ClientNumber { get; init; }

        public string ClientName { get; init; } = string.Empty;

        public int Open { get; init; }

        public int Overdue { get; init; }
    }
}
