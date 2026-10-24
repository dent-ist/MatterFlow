using System.Globalization;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The matters one My Matters call is about and the helpers that read their tasks. Matters are a SQL subquery (never a client-side id list), so the
/// number of statements does not depend on the number of matters and the tasks are read through <c>IX_Task_Matter</c>.
/// </summary>
public sealed class MyMattersScope
{
    /// <summary>The largest number of matters the All matters scope serves; a bigger set must be narrowed by client or project manager.</summary>
    public const int MaxMatters = 5000;

    internal MyMattersScope(DbContext db, int me, QueueClock clock, IQueryable<Matter> matters, string role, MyMattersQuery query, bool all)
    {
        Db = db;
        Me = me;
        Clock = clock;
        Matters = matters;
        Role = role;
        All = all;
        ClientId = query.ClientId;
        ManagerId = query.ManagerId;
        From = query.From;
        To = query.To;
        Key = string.Join('|', all ? "all" : "mine", role, ClientId, ManagerId, From?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), To?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }

    public DbContext Db { get; }

    /// <summary>The caller.</summary>
    public int Me { get; }

    /// <summary>"Now" for the viewer: overdue and "due in N days" are decided in their time zone, like My Work.</summary>
    public QueueClock Clock { get; }

    /// <summary>The active matters of the scope.</summary>
    public IQueryable<Matter> Matters { get; }

    public string Role { get; }

    public bool All { get; }

    public int? ClientId { get; }

    public int? ManagerId { get; }

    public DateOnly? From { get; }

    public DateOnly? To { get; }

    /// <summary>Identifies the scope inside a cache key.</summary>
    public string Key { get; }

    /// <summary>All tasks of the scope's matters inside the date range (a range keeps only tasks with an explicit due date in it).</summary>
    public IQueryable<WorkTask> Tasks()
    {
        var ids = Matters.Select(m => m.Id);
        var tasks = Db.Set<WorkTask>().AsNoTracking().Where(t => ids.Contains(t.MatterId));
        if (From is { } from)
            tasks = tasks.Where(t => t.DueDate != null && t.DueDate >= from);
        if (To is { } to)
            tasks = tasks.Where(t => t.DueDate != null && t.DueDate <= to);
        return tasks;
    }

    /// <summary>The open tasks of the scope.</summary>
    public IQueryable<WorkTask> OpenTasks() => Tasks().Where(TaskQueueRules.Open);

    /// <summary>
    /// The Task Queue query string that lists the scope's tasks (no leading <c>?</c>), plus <paramref name="extra"/> parameters: the same matters,
    /// the same client and the same date range, so a count and the grid it opens always agree.
    /// </summary>
    public string Queue(params string[] extra) => DashboardRules.Join([.. ScopeParts(), .. extra]);

    /// <summary>The open tasks of the scope: <see cref="Queue"/> with the three open statuses.</summary>
    public string QueueOpen(params string[] extra) => DashboardRules.Open([.. ScopeParts(), .. extra]);

    /// <summary>The tasks of the scope in one status: <see cref="Queue"/> with that status.</summary>
    public string QueueStatus(MatterFlow.SharedKernel.Tasks.TaskStatusCode status, params string[] extra) => DashboardRules.Status(status, [.. ScopeParts(), .. extra]);

    /// <summary>The Matters list query string for the scope (active matters of the same managers and client).</summary>
    public string MattersQuery()
    {
        var parts = new List<string> { "isActive=true" };
        if (ClientId is { } client)
            parts.Add("clientId=" + client.ToString(CultureInfo.InvariantCulture));
        if ((All ? ManagerId : Me) is { } who)
        {
            var id = who.ToString(CultureInfo.InvariantCulture);
            parts.Add(Role switch
            {
                TaskQueueFilter.RolePrimary => "primaryManagerId=" + id,
                TaskQueueFilter.RoleSecondary => "secondaryManagerId=" + id,
                _ => All ? "managerId=" + id : "managedByMe=true",
            });
        }

        return DashboardRules.Join(parts);
    }

    /// <summary>The date-range parameters of the Task Queue (<c>dueFrom</c>, <c>dueTo</c>) for this scope; empty without a range.</summary>
    public List<string> RangeParts()
    {
        var parts = new List<string>();
        if (From is { } from)
            parts.Add("dueFrom=" + DashboardRules.Date(from));
        if (To is { } to)
            parts.Add("dueTo=" + DashboardRules.Date(to));
        return parts;
    }

    /// <summary>The open tasks of the scope without the scope's own date range (a bucket that names its own <c>dueFrom</c> / <c>dueTo</c> must not repeat the key).</summary>
    public string QueueOpenInWindow(params string[] extra) => DashboardRules.Open([.. ScopeParts(withRange: false), .. extra]);

    private List<string> ScopeParts(bool withRange = true)
    {
        var parts = new List<string>();
        if (!All)
            parts.Add("managedByMe=true");
        else if (ManagerId is { } manager)
            parts.Add("managerId=" + manager.ToString(CultureInfo.InvariantCulture));
        if ((!All || ManagerId is not null) && Role != TaskQueueFilter.RoleBoth)
            parts.Add("role=" + Role);
        if (ClientId is { } client)
            parts.Add("client=" + client.ToString(CultureInfo.InvariantCulture));
        if (withRange)
            parts.AddRange(RangeParts());
        return parts;
    }
}

/// <summary>
/// Validates the common My Matters parameters and builds the <see cref="MyMattersScope"/>. Access: <c>Matter.BeManager</c> or
/// <c>Matter.AssignManagers</c> and <c>Task.View</c> are checked by the controller's policies; the All matters scope and a named manager need
/// <c>Matter.AssignManagers</c> here (403). A matter with no manager is in no "mine" scope, ever.
/// </summary>
public sealed class MyMattersScopeResolver(DbContext db, IClock clock, IUserTimeZone timeZone, ICurrentUser currentUser, IManagedMatterScope managed, IMatterVisibility visibility)
{
    public const string ScopeMine = "mine";
    public const string ScopeAll = "all";

    public async Task<Result<MyMattersScope>> ResolveAsync(MyMattersQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (currentUser.UserId is not { } me)
            return Error.Unauthenticated("Sign in to see My Matters.");

        var scope = string.IsNullOrWhiteSpace(query.Scope) ? ScopeMine : query.Scope.Trim().ToLowerInvariant();
        if (scope is not (ScopeMine or ScopeAll))
            return Error.Validation("scope", "UNKNOWN_SCOPE", $"Unknown scope '{query.Scope}'. Allowed: mine, all.");

        var role = TaskQueueFilter.RoleBoth;
        if (!string.IsNullOrWhiteSpace(query.Role))
        {
            role = query.Role.Trim().ToLowerInvariant();
            if (role is not (TaskQueueFilter.RolePrimary or TaskQueueFilter.RoleSecondary or TaskQueueFilter.RoleBoth))
                return Error.Validation("role", "UNKNOWN_ROLE", $"Unknown role '{query.Role}'. Allowed: primary, secondary, both.");
        }

        if (query.From is { } from && query.To is { } to && from > to)
            return Error.Validation("from", "INVALID_RANGE", "from must not be after to.");

        var all = scope == ScopeAll;
        if (!all && query.ManagerId is not null)
            return Error.Validation("managerId", "SCOPE_REQUIRED", "managerId needs scope=all.");
        if (all)
        {
            var allowed = managed.RequireAllScope();
            if (allowed.IsFailure)
                return allowed.Error!;
        }

        var matters = db.Set<Matter>().AsNoTracking().Where(m => m.IsActive);
        if (query.ClientId is { } clientId)
            matters = matters.Where(m => m.ClientId == clientId);

        int? manager = all ? query.ManagerId : me;
        if (manager is { } who)
        {
            var place = role switch
            {
                TaskQueueFilter.RolePrimary => ManagerPlace.Primary,
                TaskQueueFilter.RoleSecondary => ManagerPlace.Secondary,
                _ => ManagerPlace.Either,
            };
            matters = managed.WhereManagedBy(matters, m => m.PrimaryManagerId, m => m.SecondaryManagerId, m => m.Id, who, place);
        }
        else
        {
            // The All scope without a named manager: every matter the caller may see (the sensitive-matter hook; a no-op until it is enabled).
            matters = visibility.WhereMatterVisible(matters, m => m.Id);
        }

        if (all && await matters.CountAsync(ct) > MyMattersScope.MaxMatters)
            return Error.Validation("scope", "SCOPE_TOO_LARGE", $"More than {MyMattersScope.MaxMatters} matters match. Choose a client or a project manager first.");

        return new MyMattersScope(db, me, QueueClock.Create(clock.UtcNow, timeZone), matters, role, query, all);
    }
}
