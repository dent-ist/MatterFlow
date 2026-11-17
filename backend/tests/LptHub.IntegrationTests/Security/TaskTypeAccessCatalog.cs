using System.Collections.Frozen;

namespace LptHub.IntegrationTests.Security;

/// <summary>How an endpoint that serves tasks, task counts or task-derived data relates to the Task Type access rule (epic #1397, issue #1400, design README 12.2).</summary>
public enum TypeHandling
{
    /// <summary>Serves task rows, counts or derived data: they come from the visible set, so a task of a type the caller may not see is absent, and nothing counts it.</summary>
    Port,

    /// <summary>A task (or task child) by id: a hidden one answers 404, byte for byte like a missing id.</summary>
    ById,

    /// <summary>A deliberate exception named by the owner (bare integers in capacity and calendar loads; reports stay as they are). Swept, not asserted.</summary>
    Exception,

    /// <summary>Not covered by issue #1400 on purpose: the Task Type pickers and the assignee lookup belong to issue #1401 (design README section 16).</summary>
    Deferred,

    /// <summary>Carries no task data; the reason says why.</summary>
    NotTaskData,
}

/// <summary>One classified endpoint: the handling, the inventory rows it implements (design README section 15), and why.</summary>
public sealed record TypeEntry(TypeHandling Handling, string Area, string Reason);

/// <summary>
/// The classification of EVERY endpoint of <see cref="SensitiveAccessCatalog"/> that is not neutral and not a write, against the Task Type access rule (README 12.2, extending the
/// sensitive-matter guards): <c>TaskTypeAccessCatalogTests</c> fails for an endpoint of that kind that is not listed here, and for a listed key that no longer exists, so a new endpoint that
/// reads tasks cannot ship without somebody deciding how the type rule applies. The walk (<c>TaskTypeReadPersonaWalkTests</c>) sends every <see cref="TypeHandling.Port"/>,
/// <see cref="TypeHandling.ById"/> and <see cref="TypeHandling.Exception"/> call of the sensitive catalogue as personas with and without the Can View role.
/// </summary>
public static class TaskTypeAccessCatalog
{
    public static readonly FrozenDictionary<string, TypeEntry> All = new Dictionary<string, TypeEntry>
    {
        ["GET api/v1/asset-link-roles"] = new(TypeHandling.Port, "O5", "link counts over tasks of viewable types"),
        ["GET api/v1/asset-reports/{assetReportId:int}/run"] = new(TypeHandling.Port, "M5", "asset report counts through the link reader"),
        ["GET api/v1/asset-types"] = new(TypeHandling.NotTaskData, "S4", "asset counts per asset type: no task data"),
        ["GET api/v1/asset-types/{assetTypeId:int}"] = new(TypeHandling.NotTaskData, "S4", "asset counts: no task data"),
        ["GET api/v1/asset-types/{assetTypeId:int}/numbering/counters"] = new(TypeHandling.NotTaskData, "S4", "numbering counters: no task data"),
        ["GET api/v1/asset-types/{assetTypeId:int}/numbering/counters/{matterId:int}"] = new(TypeHandling.NotTaskData, "S4", "numbering counters: no task data"),
        ["GET api/v1/assets"] = new(TypeHandling.Port, "S4,K11", "asset rows: linked and open task counts over visible tasks; reach through an assigned task needs a viewable type"),
        ["GET api/v1/assets/counts-by-type"] = new(TypeHandling.Port, "S4,K11", "asset counts of one matter: reach through an assigned task needs a viewable type"),
        ["GET api/v1/assets/lookup"] = new(TypeHandling.Port, "S4,K11", "asset pick list: reach through an assigned task needs a viewable type"),
        ["GET api/v1/assets/{assetId:int}"] = new(TypeHandling.Port, "S4,K11", "asset by id: reach through an assigned task needs a viewable type"),
        ["GET api/v1/assets/{assetId:int}/disposition-history"] = new(TypeHandling.Port, "S4,K11", "asset by id: reach through an assigned task needs a viewable type"),
        ["GET api/v1/assets/{assetId:int}/linked-tasks"] = new(TypeHandling.Port, "K12", "linked task rows through TaskAccess.Visible"),
        ["GET api/v1/audit/events"] = new(TypeHandling.Port, "F1", "events of a task whose current type the caller may not see are hidden"),
        ["GET api/v1/audit/facets"] = new(TypeHandling.Port, "F1", "facet values recomputed without events of hidden task types"),
        ["GET api/v1/audit/search"] = new(TypeHandling.Port, "F1", "events of a task whose current type the caller may not see are hidden"),
        ["GET api/v1/clients"] = new(TypeHandling.Port, "O1", "client list: task counts and top matters over visible tasks"),
        ["GET api/v1/clients/{clientId:int}"] = new(TypeHandling.Port, "O1", "client detail: task counts over visible tasks"),
        ["GET api/v1/clients/{clientId:int}/summary"] = new(TypeHandling.Port, "O1", "client strip over visible tasks"),
        ["GET api/v1/dashboard"] = new(TypeHandling.Port, "D1,D2", "KPIs, breakdowns, gauge and the Technician \"mine\" counts from the visible set"),
        ["GET api/v1/dashboard/calendar/day"] = new(TypeHandling.Exception, "D10", "DELIBERATE (owner decision): per-person load as a bare integer"),
        ["GET api/v1/dashboard/calendar/days"] = new(TypeHandling.Exception, "D10", "DELIBERATE (owner decision): per-person load as a bare integer"),
        ["GET api/v1/dashboard/calendar/summary"] = new(TypeHandling.Exception, "D10", "DELIBERATE (owner decision): forecast totals as bare integers"),
        ["GET api/v1/dashboard/capacity"] = new(TypeHandling.Exception, "D6", "DELIBERATE (owner decision, AS item 12 extended): a person's open tasks, hidden types included, as a bare integer; the unassigned number is from the visible set"),
        ["GET api/v1/dashboard/capacity/people"] = new(TypeHandling.Exception, "D6", "DELIBERATE (owner decision): per-person load as a bare integer"),
        ["GET api/v1/dashboard/coverage"] = new(TypeHandling.Port, "D9", "coverage by type: visible tasks, viewable types only"),
        ["GET api/v1/dashboard/swimlane"] = new(TypeHandling.Port, "Q7", "cards and lane counts from the queue base"),
        ["GET api/v1/dashboard/trend"] = new(TypeHandling.Port, "D4", "trend series from VisibleTasks.Of, cached by the access stamp (hidden types included); the type catalogue lists viewable types only"),
        ["GET api/v1/dashboard/users/skills"] = new(TypeHandling.Port, "D8", "skills matrix: visible tasks, viewable types only"),
        ["GET api/v1/dashboard/users/{userId:int}/history"] = new(TypeHandling.Port, "D7", "completed tasks of a person over visible tasks"),
        ["GET api/v1/dashboard/workload"] = new(TypeHandling.Port, "D5", "per-person load over visible tasks"),
        ["GET api/v1/matters"] = new(TypeHandling.Port, "O2,O3", "matter list: task counts and state badges over tasks of viewable types"),
        ["GET api/v1/matters/lookup"] = new(TypeHandling.NotTaskData, "-", "resolves one matter by reference: no task data"),
        ["GET api/v1/matters/{matterId:int}"] = new(TypeHandling.Port, "O2", "matter detail: task counts over tasks of viewable types"),
        ["GET api/v1/matters/{matterId:int}/events"] = new(TypeHandling.NotTaskData, "X2", "matter calendar events: no task data"),
        ["GET api/v1/matters/{matterId:int}/notes/summary"] = new(TypeHandling.NotTaskData, "X1", "notes: no task data"),
        ["GET api/v1/matters/{matterId:int}/overview"] = new(TypeHandling.Port, "D12", "matter overview over VisibleTasks"),
        ["GET api/v1/matters/{matterId:int}/productions/summary"] = new(TypeHandling.NotTaskData, "X2", "productions: no task data"),
        ["GET api/v1/matters/{matterId:int}/summary"] = new(TypeHandling.Port, "O2", "matter strip over tasks of viewable types"),
        ["GET api/v1/matters/{matterId:int}/team"] = new(TypeHandling.NotTaskData, "X2", "matter team: no task data"),
        ["GET api/v1/matters/{matterId:int}/vendors"] = new(TypeHandling.NotTaskData, "X2", "matter vendors: no task data"),
        ["GET api/v1/me/notifications"] = new(TypeHandling.Port, "N1", "notifications of a task are filtered by the task's visibility at read time"),
        ["GET api/v1/me/notifications/poll"] = new(TypeHandling.Port, "N1", "unread count and items filtered by the task's visibility at read time"),
        ["GET api/v1/my-matters/activity"] = new(TypeHandling.Port, "M3", "audit-derived events of tasks of viewable types only"),
        ["GET api/v1/my-matters/assets"] = new(TypeHandling.Port, "M4", "asset linked and open-linked task counts over tasks of viewable types"),
        ["GET api/v1/my-matters/assets/{assetId:int}"] = new(TypeHandling.Port, "M4", "asset detail: linked tasks through VisibleTasks, counts over viewable types"),
        ["GET api/v1/my-matters/attention"] = new(TypeHandling.Port, "M1,M2", "My Matters scope tasks carry the type term; rows loaded by id after that"),
        ["GET api/v1/my-matters/breakdown"] = new(TypeHandling.Port, "M1", "My Matters scope tasks carry the type term; only viewable types are named"),
        ["GET api/v1/my-matters/calendar"] = new(TypeHandling.Port, "M1", "My Matters scope tasks carry the type term"),
        ["GET api/v1/my-matters/data"] = new(TypeHandling.NotTaskData, "M4", "asset counts, sizes and warnings: no task data"),
        ["GET api/v1/my-matters/data/volume"] = new(TypeHandling.NotTaskData, "M4", "monthly asset size: no task data"),
        ["GET api/v1/my-matters/deadlines"] = new(TypeHandling.Port, "M1", "My Matters scope tasks carry the type term"),
        ["GET api/v1/my-matters/events"] = new(TypeHandling.NotTaskData, "M3", "matter calendar events (MatterEvent): no task data"),
        ["GET api/v1/my-matters/events/upcoming"] = new(TypeHandling.NotTaskData, "M3", "matter calendar events (MatterEvent): no task data"),
        ["GET api/v1/my-matters/feed"] = new(TypeHandling.Port, "M1,M3", "scope tasks and audit-derived events with the type term"),
        ["GET api/v1/my-matters/since-last-visit"] = new(TypeHandling.Port, "M1,M3", "scope tasks and audit-derived events with the type term"),
        ["GET api/v1/my-matters/summary"] = new(TypeHandling.Port, "M1", "My Matters scope tasks carry the type term"),
        ["GET api/v1/my-matters/task-counts"] = new(TypeHandling.Port, "M1", "My Matters scope tasks carry the type term"),
        ["GET api/v1/my-matters/tree"] = new(TypeHandling.Port, "M1", "My Matters scope tasks carry the type term"),
        ["GET api/v1/my-matters/workload"] = new(TypeHandling.Port, "M1", "My Matters scope tasks carry the type term"),
        ["GET api/v1/my-work"] = new(TypeHandling.Port, "Q4", "own list through the queue; the needs-attention strip applies the type term (no \"own tasks\" shortcut)"),
        ["GET api/v1/note-tags"] = new(TypeHandling.NotTaskData, "X1", "tag names and note counts: no task data"),
        ["GET api/v1/note-templates"] = new(TypeHandling.NotTaskData, "X1", "notes: no task data"),
        ["GET api/v1/note-templates/{templateId:int}"] = new(TypeHandling.NotTaskData, "X1", "notes: no task data"),
        ["GET api/v1/notes"] = new(TypeHandling.NotTaskData, "X1", "notes: no task data"),
        ["GET api/v1/notes/{noteId:int}"] = new(TypeHandling.NotTaskData, "X1", "notes: no task data"),
        ["GET api/v1/notes/{noteId:int}/history"] = new(TypeHandling.NotTaskData, "X1", "notes: no task data"),
        ["GET api/v1/pod-work"] = new(TypeHandling.Port, "Q5", "pod tabs, summary and member loads from VisibleTasks.Of"),
        ["GET api/v1/priorities"] = new(TypeHandling.Port, "O5", "open-task counts over visible tasks"),
        ["GET api/v1/production-specs"] = new(TypeHandling.NotTaskData, "X2", "productions: no task data"),
        ["GET api/v1/production-specs/{specId:int}"] = new(TypeHandling.NotTaskData, "X2", "productions: no task data"),
        ["GET api/v1/production-specs/{specId:int}/history"] = new(TypeHandling.NotTaskData, "X2", "productions: no task data"),
        ["GET api/v1/productions"] = new(TypeHandling.NotTaskData, "X2", "productions: no task data"),
        ["GET api/v1/productions/{productionId:int}"] = new(TypeHandling.NotTaskData, "X2", "productions: no task data"),
        ["GET api/v1/productions/{productionId:int}/comments"] = new(TypeHandling.NotTaskData, "X2", "productions: no task data"),
        ["GET api/v1/productions/{productionId:int}/history"] = new(TypeHandling.NotTaskData, "X2", "productions: no task data"),
        ["GET api/v1/projects"] = new(TypeHandling.Port, "O2", "project list: task counts over tasks of viewable types"),
        ["GET api/v1/projects/{projectId:int}"] = new(TypeHandling.Port, "O2", "project detail: task counts over tasks of viewable types"),
        ["GET api/v1/projects/{projectId:int}/summary"] = new(TypeHandling.Port, "O2", "project strip over tasks of viewable types"),
        ["GET api/v1/reports/{id:int}/lookups/{parameter}"] = new(TypeHandling.Exception, "R3", "Reports stay as they are (owner decision, accepted limitation, design section 14)"),
        ["GET api/v1/search"] = new(TypeHandling.Port, "S1", "task hits and counts through WhereTaskFlagVisible"),
        ["GET api/v1/search/advanced"] = new(TypeHandling.Port, "S2", "task hits, counts and filters through WhereTaskFlagVisible"),
        ["GET api/v1/status-labels"] = new(TypeHandling.Port, "O5", "open-task counts over visible tasks"),
        ["GET api/v1/task-queue"] = new(TypeHandling.Port, "Q1", "Task Queue rows, totals, badges and filters from VisibleTasks.Of"),
        ["GET api/v1/task-queue/export"] = new(TypeHandling.Port, "Q2", "CSV and text export of the same rows as the queue"),
        ["GET api/v1/task-types"] = new(TypeHandling.Deferred, "O4", "open-task counts are over visible tasks; the LIST of types (names) is filtered in issue #1401 (pickers)"),
        ["GET api/v1/task-types/{id:int}"] = new(TypeHandling.Deferred, "O4", "open-task count is over visible tasks; a hidden type's detail is filtered in issue #1401 (pickers)"),
        ["GET api/v1/tasks"] = new(TypeHandling.Port, "K1", "task list and total through TaskAccess.Visible"),
        ["GET api/v1/tasks/{taskId:long}"] = new(TypeHandling.ById, "K2", "a task by id: through TaskAccess.Visible / CanSeeTaskAsync, so a task of a type the caller may not see is the same 404 as a missing id"),
        ["GET api/v1/tasks/{taskId:long}/activity"] = new(TypeHandling.ById, "K7", "a task by id: through TaskAccess.Visible / CanSeeTaskAsync, so a task of a type the caller may not see is the same 404 as a missing id"),
        ["GET api/v1/tasks/{taskId:long}/assets"] = new(TypeHandling.ById, "K6", "a task by id: through TaskAccess.Visible / CanSeeTaskAsync, so a task of a type the caller may not see is the same 404 as a missing id"),
        ["GET api/v1/tasks/{taskId:long}/comments"] = new(TypeHandling.ById, "K5", "a task by id: through TaskAccess.Visible / CanSeeTaskAsync, so a task of a type the caller may not see is the same 404 as a missing id"),
        ["GET api/v1/tasks/{taskId:long}/comments/{commentId:long}/revisions"] = new(TypeHandling.ById, "K5", "a task by id: through TaskAccess.Visible / CanSeeTaskAsync, so a task of a type the caller may not see is the same 404 as a missing id"),
        ["GET api/v1/tasks/{taskId:long}/completion"] = new(TypeHandling.ById, "K3", "a task by id: through TaskAccess.Visible / CanSeeTaskAsync, so a task of a type the caller may not see is the same 404 as a missing id"),
        ["GET api/v1/tasks/{taskId:long}/workflow"] = new(TypeHandling.ById, "K4", "a task by id: through TaskAccess.Visible / CanSeeTaskAsync, so a task of a type the caller may not see is the same 404 as a missing id"),
        ["GET api/v1/users"] = new(TypeHandling.Port, "O6", "open-task counts over visible tasks"),
        ["GET api/v1/users/counts"] = new(TypeHandling.Port, "O6", "open-task counts over visible tasks"),
        ["GET api/v1/users/lookup"] = new(TypeHandling.Deferred, "S5", "counts over visible tasks; the TypeAssignable candidate filter is issue #1401"),
        ["GET api/v1/users/{userId:int}"] = new(TypeHandling.Port, "O6", "open-task count over visible tasks"),
        ["GET api/v1/vendors/{vendorId:int}/matters"] = new(TypeHandling.NotTaskData, "X2", "matters of a vendor: no task data"),
        ["GET api/v1/workflows"] = new(TypeHandling.Port, "O5", "workflow version counts over visible tasks"),
        ["GET api/v1/workflows/published"] = new(TypeHandling.Port, "O5", "workflow version counts over visible tasks"),
        ["GET api/v1/workflows/{id:int}"] = new(TypeHandling.Port, "O5", "workflow version counts over visible tasks"),
        ["GET api/v1/workflows/{id:int}/published"] = new(TypeHandling.Port, "O5", "workflow version counts over visible tasks"),
        ["GET api/v1/workflows/{id:int}/versions/{versionId:int}"] = new(TypeHandling.Port, "O5", "workflow version counts over visible tasks"),
        ["POST api/v1/asset-reports/run"] = new(TypeHandling.Port, "M5", "asset report counts through the link reader"),
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>The endpoints of <see cref="SensitiveAccessCatalog"/> the guard requires an entry for: lists, resources by id and aggregates (not neutral, not writes, not Reports).</summary>
    public static IEnumerable<string> Required() =>
        SensitiveAccessCatalog.All.Where(kv => kv.Value.Kind is AccessKind.Gated or AccessKind.List or AccessKind.Aggregate).Select(kv => kv.Key);
}
