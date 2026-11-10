using System.Globalization;
using System.Text.Json;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkflowEngine.Contracts;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>What a write adds to the Task response: warnings, dropped hidden values and bulk-completed steps.</summary>
public sealed record CommandNotes(IReadOnlyList<string> Warnings, IReadOnlyList<string> Dropped, IReadOnlyList<int> BulkCompleted)
{
    public static CommandNotes None { get; } = new([], [], []);
}

/// <summary>Builds the API views of Tasks from the entity and the other modules' read contracts. Read-only.</summary>
public sealed class TaskPresenter(
    DbContext db,
    IMatterDirectory matters,
    IProjectDirectory projects,
    ITaskTypeCatalog taskTypes,
    IPriorityCatalog priorities,
    IOnHoldReasonCatalog onHoldReasons,
    IStatusLabelCatalog labels,
    IPodDirectory pods,
    IUserDirectory users,
    IFormDefinitionResolver forms,
    IFormValueStore valueStore,
    IWorkflowInstanceService workflows,
    IWorkflowCatalog workflowCatalog,
    IPermissionChecker permissions,
    IUserTimeZone timeZone,
    IClock clock,
    IAuditReader auditReader,
    TaskAccess access)
{
    private static readonly IReadOnlyDictionary<string, JsonElement> NoValues = new Dictionary<string, JsonElement>();

    /// <summary>
    /// The Task as the caller may see it; a hidden Task is "not found". <paramref name="afterWrite"/> is the answer to a command that has just succeeded: the
    /// caller changed the Task (an assignee who reassigns their own task ends their own access), so it is read once without the rule, as the Organization
    /// module does for matters.
    /// </summary>
    public async Task<Result<TaskResponse>> GetAsync(long taskId, CommandNotes? notes, CancellationToken ct, bool afterWrite = false)
    {
        var rows = afterWrite ? db.Set<WorkTask>().AsNoTracking() : access.Visible();
        var task = await rows.SingleOrDefaultAsync(t => t.Id == taskId, ct);
        return task is null ? TaskSupport.NotFound() : await BuildAsync(task, notes ?? CommandNotes.None, ct);
    }

    public async Task<Result<TaskResponse>> BuildAsync(WorkTask t, CommandNotes notes, CancellationToken ct)
    {
        var matter = await matters.FindAsync(t.MatterId, ct);
        var project = t.ProjectId is { } projectId ? await projects.FindAsync(projectId, ct) : null;
        var type = await taskTypes.GetAsync(t.TaskTypeId, ct);
        var priority = await priorities.GetAsync(t.PriorityId, ct);
        var statusLabel = await labels.GetLabelAsync(t.Status.ToCode(), ct);
        var pod = t.AssignedPodId is { } podId ? await pods.FindAsync(podId, ct) : null;
        // Who made the status change the page shows as a note (Completed, Cancelled, On Hold): the actor of the newest status event.
        var statusActorId = t.Status is TaskStatusCode.Completed or TaskStatusCode.Cancelled or TaskStatusCode.OnHold
            ? (await auditReader.LatestForTaskAsync(t.Id, AuditEventTypes.TaskStatusChanged, ct))?.ActorUserId
            : null;
        var userIds = new[] { t.AssignedUserId, t.CreatedByUserId, statusActorId }.OfType<int>().Distinct().ToList();
        var userMap = await users.FindManyAsync(userIds, ct);

        IReadOnlyDictionary<string, JsonElement> formValues = NoValues;
        int? formVersionNo = null;
        if (t.FormVersionId is { } formVersionId)
        {
            var version = await forms.GetVersionAsync(formVersionId, ct);
            if (version.IsSuccess)
            {
                formVersionNo = version.Value.VersionNo;
                var stored = await valueStore.GetAsync(FormValueOwnerKind.Task, t.Id, version.Value.FormDefinitionId, ct);
                formValues = stored?.Values ?? NoValues;
            }
        }

        var workflow = await WorkflowAsync(t.WorkflowInstanceId, ct);
        if (workflow.IsFailure)
            return Result<TaskResponse>.Failure(workflow.Error!);

        var due = TaskDue.FromStored(t.DueDate, t.DueAtUtc);
        var now = clock.UtcNow;
        var matterActive = matter?.IsActive ?? true;

        return new TaskResponse(
            t.Id,
            t.Number,
            MatterRef(matter, t.MatterId, matter is null || !matter.IsSensitive || await access.CanSeeMatterAsync(t.MatterId, ct)),
            project is null ? null : new TaskProjectRef(project.ProjectId, project.Name, project.IsActive),
            new TaskTypeRef(t.TaskTypeId, type?.Name ?? string.Empty, type?.IconKey ?? TaskTypeIcons.DefaultKey),
            t.Title,
            t.Description,
            t.DescriptionFormat.ToCode(),
            t.RequestorName,
            t.RequestorEmail,
            TaskSupport.Utc(t.RequestedAtUtc),
            PriorityRef(priority, t.PriorityId),
            t.Status.ToCode(),
            statusLabel,
            pod is null ? null : new TaskPodRef(pod.PodId, pod.Name, pod.IsActive),
            UserRef(userMap, t.AssignedUserId),
            t.DueDate,
            DueTimeText(t.DueAtUtc),
            TaskSupport.Utc(t.DueAtUtc),
            due.IsAsap,
            due.IsOverdue(t.Status, now, timeZone.Zone),
            timeZone.Id,
            UserRef(userMap, t.CreatedByUserId),
            TaskSupport.Utc(t.CreatedAtUtc),
            TaskSupport.Utc(t.ModifiedAtUtc),
            TaskSupport.Utc(t.StatusChangedAtUtc),
            TaskSupport.Utc(t.CompletedAtUtc),
            t.FormVersionId,
            formVersionNo,
            formValues,
            workflow.Value,
            TaskActionRules.Compute(t.Status, matterActive, permissions.Has),
            await StatusReasonAsync(t, ct),
            TaskSupport.Encode(t.RowVersion),
            notes.Warnings,
            notes.Dropped,
            notes.BulkCompleted,
            UserRef(userMap, statusActorId),
            await OnHoldReasonAsync(t, ct));
    }

    private async Task<TaskOnHoldReasonRef?> OnHoldReasonAsync(WorkTask t, CancellationToken ct)
    {
        if (t.Status != TaskStatusCode.OnHold || t.OnHoldReasonId is not { } id)
            return null;
        var reason = await onHoldReasons.GetAsync(id, ct);
        return reason is null ? null : new TaskOnHoldReasonRef(reason.Id, reason.Name, reason.IsActive);
    }

    /// <summary>The page of list items for already-loaded Tasks (names resolved once per distinct id).</summary>
    public async Task<IReadOnlyList<TaskListItem>> BuildListAsync(IReadOnlyList<WorkTask> tasks, CancellationToken ct)
    {
        var typeInfos = (await taskTypes.ListAsync(includeInactive: true, ct)).ToDictionary(x => x.Id);
        var priorityMap = (await priorities.ListAsync(includeInactive: true, ct)).ToDictionary(p => p.Id);
        var labelMap = (await labels.ListAsync(ct)).ToDictionary(l => l.Code, l => l.DisplayLabel);
        var userMap = await users.FindManyAsync(tasks.Select(t => t.AssignedUserId).OfType<int>().ToList(), ct);

        var matterMap = new Dictionary<int, MatterSummary?>();
        foreach (var id in tasks.Select(t => t.MatterId).Distinct())
            matterMap[id] = await matters.FindAsync(id, ct);

        var projectMap = new Dictionary<int, ProjectSummary?>();
        foreach (var id in tasks.Select(t => t.ProjectId).OfType<int>().Distinct())
            projectMap[id] = await projects.FindAsync(id, ct);

        var podMap = new Dictionary<int, PodInfo?>();
        foreach (var id in tasks.Select(t => t.AssignedPodId).OfType<int>().Distinct())
            podMap[id] = await pods.FindAsync(id, ct);

        var now = clock.UtcNow;
        var items = new List<TaskListItem>(tasks.Count);
        foreach (var t in tasks)
        {
            var matter = matterMap[t.MatterId];
            var project = t.ProjectId is { } pid ? projectMap[pid] : null;
            var pod = t.AssignedPodId is { } podId ? podMap[podId] : null;
            var due = TaskDue.FromStored(t.DueDate, t.DueAtUtc);
            priorityMap.TryGetValue(t.PriorityId, out var priority);
            var code = t.Status.ToCode();
            items.Add(new TaskListItem(
                t.Id,
                t.Number,
                t.Title,
                t.MatterId,
                matter?.MatterRef ?? string.Empty,
                matter?.Name ?? string.Empty,
                t.ProjectId,
                project?.Name,
                t.TaskTypeId,
                typeInfos.TryGetValue(t.TaskTypeId, out var typeInfo) ? typeInfo.Name : string.Empty,
                typeInfo?.IconKey ?? TaskTypeIcons.DefaultKey,
                PriorityRef(priority, t.PriorityId),
                code,
                labelMap.GetValueOrDefault(code, code),
                pod is null ? null : new TaskPodRef(pod.PodId, pod.Name, pod.IsActive),
                UserRef(userMap, t.AssignedUserId),
                t.DueDate,
                TaskSupport.Utc(t.DueAtUtc),
                due.IsAsap,
                due.IsOverdue(t.Status, now, timeZone.Zone),
                TaskSupport.Utc(t.CreatedAtUtc),
                TaskSupport.Encode(t.RowVersion)));
        }

        return items;
    }

    public async Task<Result<TaskWorkflowResponse>> WorkflowAsync(long workflowInstanceId, CancellationToken ct)
    {
        var view = await workflows.GetAsync(workflowInstanceId, ct);
        if (view.IsFailure)
            return Result<TaskWorkflowResponse>.Failure(view.Error!);

        var w = view.Value;
        var version = await workflowCatalog.GetVersionAsync(w.WorkflowVersionId, ct);
        var p = w.Progress;
        return new TaskWorkflowResponse(
            w.WorkflowInstanceId,
            w.WorkflowDefinitionId,
            version?.Name ?? string.Empty,
            w.WorkflowVersionId,
            w.VersionNo,
            w.IsOrdered,
            w.RowVersion,
            new TaskWorkflowProgress(p.Total, p.Pending, p.InProgress, p.Completed, p.Skipped, p.Resolved, p.CurrentStepInstanceId, p.ReopenedPrerequisiteStepInstanceIds),
            [.. w.Steps.Select(ToStep)]);
    }

    private static TaskStepInstance ToStep(StepInstanceView s) => new(
        s.StepInstanceId,
        s.SequenceNo,
        s.Title,
        s.Description,
        s.Instructions,
        s.DocumentationUrl,
        s.InputFormVersionId,
        s.IsSkippable,
        s.SkipCommentRequired,
        StepCode(s.Status),
        s.HasBeenResolved,
        s.IsCurrent,
        s.IsReopenedPrerequisite,
        s.RequiredInputsSatisfied,
        s.SkipComment,
        TaskSupport.Utc(s.FirstResolvedAtUtc),
        TaskSupport.Utc(s.ResolvedAtUtc),
        s.ResolvedByUserId,
        s.Values);

    private static string StepCode(StepInstanceStatus status) => status switch
    {
        StepInstanceStatus.Pending => "PENDING",
        StepInstanceStatus.InProgress => "IN_PROGRESS",
        StepInstanceStatus.Completed => "COMPLETED",
        _ => "SKIPPED",
    };

    private async Task<TaskStatusReason?> StatusReasonAsync(WorkTask t, CancellationToken ct)
    {
        var purpose = t.Status switch
        {
            TaskStatusCode.OnHold => TaskCommentPurpose.OnHold,
            TaskStatusCode.Cancelled => TaskCommentPurpose.Cancel,
            _ => (TaskCommentPurpose?)null,
        };
        if (purpose is not { } wanted)
            return null;

        var comment = await db.Set<TaskComment>().AsNoTracking()
            .Where(c => c.TaskId == t.Id && c.Purpose == wanted && !c.IsDeleted)
            .OrderByDescending(c => c.Id)
            .FirstOrDefaultAsync(ct);
        if (comment is null)
            return null;

        var author = await users.FindAsync(comment.AuthorUserId, ct);
        return new TaskStatusReason(comment.Id, wanted.ToCode(), comment.BodyHtml, comment.AuthorUserId, author?.DisplayName ?? string.Empty, TaskSupport.Utc(comment.CreatedAtUtc));
    }

    private string? DueTimeText(DateTime? dueAtUtc) =>
        dueAtUtc is { } at ? timeZone.ToLocal(at).ToString("HH:mm", CultureInfo.InvariantCulture) : null;

    private static TaskMatterRef MatterRef(MatterSummary? m, int matterId, bool canOpen) =>
        m is null
            ? new TaskMatterRef(matterId, 0, string.Empty, string.Empty, string.Empty, string.Empty, true, false)
            : new TaskMatterRef(m.MatterId, m.ClientId, m.ClientNumber, m.MatterNumber, m.MatterRef, m.Name, m.IsActive, m.IsSensitive, canOpen);

    private static TaskPriorityRef PriorityRef(PriorityInfo? p, int priorityId) =>
        p is null ? new TaskPriorityRef(priorityId, string.Empty, "neutral", 0) : new TaskPriorityRef(p.Id, p.Label, p.Color, p.SortOrder);

    private static TaskUserRef? UserRef(IReadOnlyDictionary<int, UserInfo> map, int? userId) =>
        userId is { } id && map.TryGetValue(id, out var u) ? new TaskUserRef(u.UserId, u.DisplayName, u.IsActive) : null;
}
