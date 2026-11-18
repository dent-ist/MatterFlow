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

    /// <summary>Carries no task data; the reason says why.</summary>
    NotTaskData,
}

/// <summary>How a WRITE endpoint relates to the Task Type access rule (issue #1401, design README section 15.10).</summary>
public enum TypeWriteHandling
{
    /// <summary>Changes a task (or creates one): a hidden task is 404 and changes nothing, a task the caller may see but not edit is 403 <c>TASK_TYPE_READ_ONLY</c> and changes nothing; an assignee must be in Can Be Assigned.</summary>
    EditGated,

    /// <summary>Changes no task; the reason says what it changes.</summary>
    NotTaskData,
}

/// <summary>One classified write endpoint: the handling, the inventory row of design README section 15.10, and why.</summary>
public sealed record TypeWriteEntry(TypeWriteHandling Handling, string Area, string Reason);

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
        ["GET api/v1/matters/{matterId:int}/note-folders"] = new(TypeHandling.NotTaskData, "X1", "notes: no task data"),
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
        ["GET api/v1/task-types"] = new(TypeHandling.Port, "O4,P", "a person without TaskType.Manage gets only the types they may see (no name, no count of a hidden one); a manager gets all unless visibleOnly; creatableOnly lists the types the caller may create tasks of"),
        ["GET api/v1/task-types/{id:int}"] = new(TypeHandling.ById, "O4,P", "a type the caller may not see is the same 404 as a missing id, for everybody without TaskType.Manage"),
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
        ["GET api/v1/users/lookup"] = new(TypeHandling.Port, "S5", "counts over visible tasks; with taskTypeId only the people the type's Can Be Assigned list allows (empty list: whoever may see the type), nobody for a hidden type"),
        ["GET api/v1/users/{userId:int}"] = new(TypeHandling.Port, "O6", "open-task count over visible tasks"),
        ["GET api/v1/vendors/{vendorId:int}/matters"] = new(TypeHandling.NotTaskData, "X2", "matters of a vendor: no task data"),
        ["GET api/v1/workflows"] = new(TypeHandling.Port, "O5", "workflow version counts over visible tasks"),
        ["GET api/v1/workflows/published"] = new(TypeHandling.Port, "O5", "workflow version counts over visible tasks"),
        ["GET api/v1/workflows/{id:int}"] = new(TypeHandling.Port, "O5", "workflow version counts over visible tasks"),
        ["GET api/v1/workflows/{id:int}/published"] = new(TypeHandling.Port, "O5", "workflow version counts over visible tasks"),
        ["GET api/v1/workflows/{id:int}/versions/{versionId:int}"] = new(TypeHandling.Port, "O5", "workflow version counts over visible tasks"),
        ["POST api/v1/asset-reports/run"] = new(TypeHandling.Port, "M5", "asset report counts through the link reader"),
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>
    /// EVERY write endpoint of <see cref="SensitiveAccessCatalog"/> (<see cref="AccessKind.Write"/>), classified against the edit and assign rules (issue #1401): a new write path cannot ship until somebody decides whether it
    /// changes a task. <c>TaskTypeWriteGuardTests</c> fails for an unlisted or stale key, and walks every <see cref="TypeWriteHandling.EditGated"/> entry as a person who may see the task but not edit it.
    /// </summary>
    public static readonly FrozenDictionary<string, TypeWriteEntry> Writes = new Dictionary<string, TypeWriteEntry>
    {
        ["DELETE api/v1/matter-events/{eventId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["DELETE api/v1/matters/{matterId:int}/team/{memberId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["DELETE api/v1/matters/{matterId:int}/vendors/{vendorId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["DELETE api/v1/note-templates/{templateId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["DELETE api/v1/note-folders/{folderId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["DELETE api/v1/notes/{noteId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["DELETE api/v1/production-comments/{commentId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["DELETE api/v1/productions/{productionId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["DELETE api/v1/tasks/{taskId:long}/assets/{assetId:int}"] = new(TypeWriteHandling.EditGated, "E9", "asset link: edit gate"),
        ["DELETE api/v1/tasks/{taskId:long}/comments/{commentId:long}"] = new(TypeWriteHandling.EditGated, "E7", "comment (Edit covers comments): edit gate after the visible-task load"),
        ["POST api/v1/assets"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/assets/disposition"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/assets/{assetId:int}/active"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/assets/{assetId:int}/assign-number"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/clients"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/matters"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/matters/{matterId:int}/active"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/matters/{matterId:int}/events"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/matters/{matterId:int}/tasks/bulk"] = new(TypeWriteHandling.EditGated, "E10", "bulk reassign / re-prioritise: every task is its own command through the edit gate; per row a hidden task is NOT_FOUND, a read-only one TASK_TYPE_READ_ONLY, an assignee outside Can Be Assigned USER_CANNOT_ASSIGN_TYPE"),
        ["POST api/v1/matters/{matterId:int}/tasks/project"] = new(TypeWriteHandling.EditGated, "E11", "bulk set project: every task is its own command through the edit gate; per row hidden = NOT_FOUND, read-only = TASK_TYPE_READ_ONLY"),
        ["POST api/v1/matters/{matterId:int}/team"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/matters/{matterId:int}/vendors"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/me/notifications/read-all"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/me/notifications/{id:long}/read"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/my-matters/activity/seen"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/note-folders"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/note-templates"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/note-templates/{templateId:int}/duplicate"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/note-templates/{templateId:int}/use"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/notes"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/notes/resolve-references"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/notes/{noteId:int}/lock"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/notes/{noteId:int}/unlock"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/production-specs"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/production-specs/{specId:int}/duplicate"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/production-specs/{specId:int}/retire"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/production-specs/{specId:int}/unretire"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/productions"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/productions/{productionId:int}/comments"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/projects"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/projects/{projectId:int}/active"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["POST api/v1/tasks"] = new(TypeWriteHandling.EditGated, "E1", "create: the caller must see and edit the type (hidden = NOT_FOUND on taskTypeId, read-only = TASK_TYPE_READ_ONLY on taskTypeId); the assignee must be in Can Be Assigned"),
        ["POST api/v1/tasks/assign-batch"] = new(TypeWriteHandling.EditGated, "E4", "batch assign: per task the edit gate and the assignee check; hidden = NOT_FOUND per row"),
        ["POST api/v1/tasks/{taskId:long}/assets"] = new(TypeWriteHandling.EditGated, "E9", "asset link: edit gate"),
        ["POST api/v1/tasks/{taskId:long}/assignment"] = new(TypeWriteHandling.EditGated, "E3", "assign / unassign: edit gate, and the assignee must be in Can Be Assigned (USER_CANNOT_ASSIGN_TYPE)"),
        ["POST api/v1/tasks/{taskId:long}/cancel"] = new(TypeWriteHandling.EditGated, "E6", "status change: edit gate"),
        ["POST api/v1/tasks/{taskId:long}/comments"] = new(TypeWriteHandling.EditGated, "E7", "comment (Edit covers comments): edit gate after the visible-task load"),
        ["POST api/v1/tasks/{taskId:long}/complete"] = new(TypeWriteHandling.EditGated, "E6", "status change: edit gate"),
        ["POST api/v1/tasks/{taskId:long}/priority"] = new(TypeWriteHandling.EditGated, "E5", "priority: edit gate"),
        ["POST api/v1/tasks/{taskId:long}/reopen"] = new(TypeWriteHandling.EditGated, "E6", "status change: edit gate"),
        ["POST api/v1/tasks/{taskId:long}/status"] = new(TypeWriteHandling.EditGated, "E6", "status change: edit gate"),
        ["POST api/v1/tasks/{taskId:long}/workflow/steps/{stepInstanceId:int}/complete"] = new(TypeWriteHandling.EditGated, "E6", "status change: edit gate"),
        ["POST api/v1/tasks/{taskId:long}/workflow/steps/{stepInstanceId:int}/reopen"] = new(TypeWriteHandling.EditGated, "E6", "status change: edit gate"),
        ["POST api/v1/tasks/{taskId:long}/workflow/steps/{stepInstanceId:int}/skip"] = new(TypeWriteHandling.EditGated, "E8", "workflow step: edit gate"),
        ["POST api/v1/tasks/{taskId:long}/workflow/steps/{stepInstanceId:int}/start"] = new(TypeWriteHandling.EditGated, "E8", "workflow step: edit gate"),
        ["POST api/v1/tasks/{taskId:long}/workflow/steps/{stepInstanceId:int}/values"] = new(TypeWriteHandling.EditGated, "E8", "workflow step: edit gate"),
        ["PUT api/v1/asset-types/{assetTypeId:int}/numbering/counters/{matterId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/assets/{assetId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/assets/{assetId:int}/disposition"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/clients/{clientId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/clients/{clientId:int}/number"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/matter-events/{eventId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/matters/{matterId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/matters/{matterId:int}/managers"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/matters/{matterId:int}/number"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/matters/{matterId:int}/team/{memberId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/note-folders/{folderId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/note-folders/{folderId:int}/parent"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/note-templates/{templateId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/notes/{noteId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/notes/{noteId:int}/folder"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/notes/{noteId:int}/pinned"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/production-comments/{commentId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/production-specs/{specId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/productions/{productionId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/projects/{projectId:int}"] = new(TypeWriteHandling.NotTaskData, "-", "writes no task: matter, asset, project, note, production or notification data"),
        ["PUT api/v1/tasks/{taskId:long}"] = new(TypeWriteHandling.EditGated, "E2", "edit fields: TaskTransactions.LockForEditAsync"),
        ["PUT api/v1/tasks/{taskId:long}/assets/{assetId:int}"] = new(TypeWriteHandling.EditGated, "E9", "asset link: edit gate"),
        ["PUT api/v1/tasks/{taskId:long}/comments/{commentId:long}"] = new(TypeWriteHandling.EditGated, "E7", "comment (Edit covers comments): edit gate after the visible-task load"),
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>The write endpoints the guard requires an entry for: every <see cref="AccessKind.Write"/> endpoint of the sensitive catalogue.</summary>
    public static IEnumerable<string> RequiredWrites() => SensitiveAccessCatalog.All.Where(kv => kv.Value.Kind == AccessKind.Write).Select(kv => kv.Key);

    /// <summary>The endpoints of <see cref="SensitiveAccessCatalog"/> the guard requires an entry for: lists, resources by id and aggregates (not neutral, not writes, not Reports).</summary>
    public static IEnumerable<string> Required() =>
        SensitiveAccessCatalog.All.Where(kv => kv.Value.Kind is AccessKind.Gated or AccessKind.List or AccessKind.Aggregate).Select(kv => kv.Key);
}
