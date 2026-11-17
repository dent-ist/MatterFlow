using System.Text;
using LptHub.Audit.Domain;
using LptHub.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Audit.Application;

/// <summary>
/// The sensitive-matter rule for audit events (epic #788, README section 8, inventory R53 to R56). An event is shown to the caller when
/// <list type="bullet">
/// <item>it has no matter and no task (users, roles, configuration: no matter data), or</item>
/// <item>its matter is not hidden from the caller (a sensitive matter the caller may not see is hidden, with everything written about it before it was marked), and
/// it is not stamped <c>IsSensitiveScope</c> unless the caller may see all sensitive matters or manages that matter (history written while the matter was sensitive
/// stays restricted after un-marking), or</item>
/// <item>it belongs to a task that is currently assigned to the caller (only those events, never the matter's).</item>
/// </list>
/// Written as small "hidden" and "mine" subqueries (the sensitive set is small by design) so a page read stays an index walk. No-op while the go-live switch is off
/// or for a see-all viewer.
/// </summary>
public sealed class AuditVisibility(IMatterVisibility visibility, IMatterAccessSource matters, ITaskAccessSource tasks, IManagedMatterScope managed)
{
    /// <summary>True when events are filtered for the current caller by the sensitive-matter rule.</summary>
    public bool Restricts => visibility.Enabled && !visibility.Current.SeeAll;

    /// <summary>True when events of tasks of a restricted Task Type are filtered for the current caller (Task Type access rule, epic #1397).</summary>
    public bool RestrictsTaskTypes => visibility.TaskTypeRuleApplies;

    /// <summary>
    /// The events the current caller may see. The Task Type rule is applied on the outside, to the task's CURRENT type: an event of a task whose type the caller may not see is hidden, even from the
    /// task's assignee (no assignee exception); events without a task, and the Task Type access-change events, are unchanged.
    /// </summary>
    public IQueryable<AuditEvent> Apply(IQueryable<AuditEvent> events)
    {
        if (Restricts)
        {
            var viewer = visibility.Current;
            var (hidden, access, mine) = Sets(viewer);
            events = events.Where(e =>
                ((e.MatterId == null || !hidden.Contains(e.MatterId.Value))
                    && !(e.IsSensitiveScope && e.MatterId != null && !access.Contains(e.MatterId.Value)))
                || (e.TaskId != null && mine.Contains(e.TaskId.Value)));
        }

        return visibility.WhereTaskEventVisible(events, e => e.TaskId);
    }

    /// <summary>The matters hidden from the viewer, the matters whose sensitive history the viewer may read, and the tasks currently assigned to the viewer.</summary>
    private (IQueryable<int> Hidden, IQueryable<int> Access, IQueryable<long> Mine) Sets(Viewer viewer)
    {
        var visible = visibility.VisibleMatters(viewer).Select(m => m.MatterId);
        var hidden = matters.Rows().Where(m => m.IsSensitive && !visible.Contains(m.MatterId)).Select(m => m.MatterId);
        var access = viewer.UserId is { } user ? managed.ManagedMatterIds(user) : matters.Rows().Where(_ => false).Select(m => m.MatterId);
        var mine = viewer.UserId is { } who
            ? tasks.Rows().Where(t => t.AssignedUserId == who).Select(t => t.TaskId)
            : tasks.Rows().Where(_ => false).Select(t => t.TaskId);
        return (hidden, access, mine);
    }

    /// <summary>
    /// The SQL fragment (starting with <c>AND</c>, over table alias <c>a</c>) and the table variables it needs, for the facet skip scan that cannot use LINQ.
    /// Empty for a caller who is not restricted. The lists are small by design (hidden sensitive matters, the caller's managed matters, their assigned tasks, the hidden task types).
    /// </summary>
    public async Task<(string Declarations, string Predicate)> FacetFilterAsync(CancellationToken cancellationToken)
    {
        var sql = new StringBuilder();
        var predicate = new StringBuilder();
        if (Restricts)
        {
            var (hidden, access, mine) = Sets(visibility.Current);
            var hiddenIds = await hidden.ToListAsync(cancellationToken);
            var accessIds = await access.ToListAsync(cancellationToken);
            var mineIds = await mine.Take(10_000).ToListAsync(cancellationToken);
            AppendTable(sql, "@hidden", "INT", hiddenIds.Select(i => (long)i));
            AppendTable(sql, "@access", "INT", accessIds.Select(i => (long)i));
            AppendTable(sql, "@mine", "BIGINT", mineIds);
            predicate.Append(
                " AND (((a.MatterId IS NULL OR a.MatterId NOT IN (SELECT Id FROM @hidden)) AND NOT (a.IsSensitiveScope = 1 AND a.MatterId IS NOT NULL AND a.MatterId NOT IN (SELECT Id FROM @access)))"
                + " OR (a.TaskId IS NOT NULL AND a.TaskId IN (SELECT Id FROM @mine)))");
        }

        // The task types the caller may not see (a handful of ids; none, and no clause at all, while nothing is restricted for them): an event of a task of such a type is not a facet value.
        if (RestrictsTaskTypes && await visibility.HiddenTaskTypeIdsAsync(cancellationToken) is { Count: > 0 } hiddenTypes)
        {
            AppendTable(sql, "@hiddenTypes", "INT", hiddenTypes.Select(i => (long)i));
            predicate.Append(" AND NOT (a.TaskId IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.Task tk WHERE tk.TaskId = a.TaskId AND tk.TaskTypeId IN (SELECT Id FROM @hiddenTypes)))");
        }

        return (sql.ToString(), predicate.ToString());
    }

    private static void AppendTable(StringBuilder sql, string name, string type, IEnumerable<long> ids)
    {
        sql.Append("DECLARE ").Append(name).Append(" TABLE (Id ").Append(type).AppendLine(" PRIMARY KEY);");
        foreach (var chunk in ids.Distinct().Chunk(500))
        {
            // Plain integers formatted by the runtime: nothing user-supplied reaches this text.
            sql.Append("INSERT ").Append(name).Append(" (Id) VALUES ")
                .Append(string.Join(',', chunk.Select(id => "(" + id.ToString(System.Globalization.CultureInfo.InvariantCulture) + ")")))
                .AppendLine(";");
        }
    }
}
