using System.Linq.Expressions;
using System.Text.Json;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkflowEngine.Contracts;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// Task creation, reading, editing, assignment and priority (tickets 41, 44, 46). Every write runs in one explicit transaction
/// (<see cref="TaskTransactions"/>) so a Task never exists without its workflow instance, form values and audit rows, and a failure leaves nothing behind.
/// </summary>
public sealed class TaskService
{
    public static readonly string[] SortFields = ["default", "createdAt", "dueAt", "title", "taskNumber", "priority"];

    private const string UserNotInPodWarning = "USER_NOT_IN_POD";

    private static readonly IReadOnlyDictionary<string, JsonElement> NoValues = new Dictionary<string, JsonElement>();

    private readonly DbContext _db;
    private readonly TaskTransactions _tx;
    private readonly TaskPresenter _presenter;
    private readonly IAuditWriter _audit;
    private readonly IPermissionChecker _permissions;
    private readonly ICurrentUser _currentUser;
    private readonly IClock _clock;
    private readonly IUserTimeZone _timeZone;
    private readonly IMatterDirectory _matters;
    private readonly IProjectDirectory _projects;
    private readonly ITaskTypeCatalog _taskTypes;
    private readonly IPriorityCatalog _priorities;
    private readonly IPodDirectory _pods;
    private readonly IUserDirectory _users;
    private readonly IWorkflowCatalog _workflowCatalog;
    private readonly IWorkflowInstanceService _workflows;
    private readonly IFormDefinitionResolver _forms;
    private readonly IFormSubmissionValidator _validator;
    private readonly IFormValueStore _valueStore;

    public TaskService(
        DbContext db,
        TaskTransactions tx,
        TaskPresenter presenter,
        IAuditWriter audit,
        IPermissionChecker permissions,
        ICurrentUser currentUser,
        IClock clock,
        IUserTimeZone timeZone,
        IMatterDirectory matters,
        IProjectDirectory projects,
        ITaskTypeCatalog taskTypes,
        IPriorityCatalog priorities,
        IPodDirectory pods,
        IUserDirectory users,
        IWorkflowCatalog workflowCatalog,
        IWorkflowInstanceService workflows,
        IFormDefinitionResolver forms,
        IFormSubmissionValidator validator,
        IFormValueStore valueStore)
    {
        _db = db;
        _tx = tx;
        _presenter = presenter;
        _audit = audit;
        _permissions = permissions;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
        _matters = matters;
        _projects = projects;
        _taskTypes = taskTypes;
        _priorities = priorities;
        _pods = pods;
        _users = users;
        _workflowCatalog = workflowCatalog;
        _workflows = workflows;
        _forms = forms;
        _validator = validator;
        _valueStore = valueStore;
    }

    // ---- read

    public Task<Result<TaskResponse>> GetAsync(long taskId, CancellationToken ct) => _presenter.GetAsync(taskId, null, ct);

    public async Task<Result<TaskWorkflowResponse>> GetWorkflowAsync(long taskId, CancellationToken ct)
    {
        var instanceId = await _db.Set<WorkTask>().AsNoTracking().Where(t => t.Id == taskId).Select(t => (long?)t.WorkflowInstanceId).SingleOrDefaultAsync(ct);
        return instanceId is null ? TaskSupport.NotFound() : await _presenter.WorkflowAsync(instanceId.Value, ct);
    }

    public async Task<Result<PagedResult<TaskListItem>>> ListAsync(TaskListQuery query, CancellationToken ct)
    {
        var page = PageRequest.Create(query.Page, query.PageSize);
        if (page.IsFailure)
            return page.Error!;

        var sort = SortSpec.Parse(query.Sort, SortFields);
        if (sort.IsFailure)
            return sort.Error!;

        var statuses = TaskSupport.ParseStatuses(query.Status);
        if (statuses.IsFailure)
            return statuses.Error!;

        var rows = _db.Set<WorkTask>().AsNoTracking();
        if (query.MatterId is { } matterId)
            rows = rows.Where(t => t.MatterId == matterId);
        if (query.ProjectId is { } projectId)
            rows = rows.Where(t => t.ProjectId == projectId);
        if (statuses.Value.Count > 0)
        {
            var wanted = statuses.Value.ToList();
            rows = rows.Where(t => wanted.Contains(t.Status));
        }

        if (query.AssigneeId is { } assigneeId)
            rows = rows.Where(t => t.AssignedUserId == assigneeId);
        if (query.PodId is { } podId)
            rows = rows.Where(t => t.AssignedPodId == podId);
        if (query.TaskTypeId is { } typeId)
            rows = rows.Where(t => t.TaskTypeId == typeId);
        if (query.PriorityId is { } priorityId)
            rows = rows.Where(t => t.PriorityId == priorityId);
        if (TaskSupport.Clean(query.Q) is { } q)
            rows = rows.Where(t => t.Title.Contains(q) || t.Number.Contains(q) || t.RequestorName.Contains(q));

        var total = await rows.CountAsync(ct);
        var ordered = await OrderAsync(rows, sort.Value, ct);
        var tasks = await ordered.Skip(page.Value.Skip).Take(page.Value.PageSize).ToListAsync(ct);
        var items = await _presenter.BuildListAsync(tasks, ct);
        return new PagedResult<TaskListItem>(items, total, page.Value.Page, page.Value.PageSize);
    }

    private async Task<IOrderedQueryable<WorkTask>> OrderAsync(IQueryable<WorkTask> rows, IReadOnlyList<SortField> sort, CancellationToken ct)
    {
        if (sort.Count == 0)
            return rows.OrderByDescending(t => t.CreatedAtUtc).ThenByDescending(t => t.Id);

        IOrderedQueryable<WorkTask>? ordered = null;

        IOrderedQueryable<WorkTask> Apply<TKey>(Expression<Func<WorkTask, TKey>> key, bool descending)
        {
            ordered = ordered is null
                ? (descending ? rows.OrderByDescending(key) : rows.OrderBy(key))
                : (descending ? ordered.ThenByDescending(key) : ordered.ThenBy(key));
            return ordered;
        }

        foreach (var field in sort)
        {
            switch (field.Field)
            {
                case "default":
                    // Architecture 8.4: priority order, ASAP (no due date) first, earliest due, oldest first.
                    Apply(PriorityRank(await _priorities.ListAsync(includeInactive: true, ct)), false);
                    Apply(t => t.DueDate == null ? 0 : 1, false);
                    Apply(t => t.DueSortKey, false);
                    Apply(t => t.CreatedAtUtc, false);
                    break;
                case "createdAt":
                    Apply(t => t.CreatedAtUtc, field.Descending);
                    break;
                case "dueAt":
                    Apply(t => t.DueDate == null ? 0 : 1, field.Descending);
                    Apply(t => t.DueSortKey, field.Descending);
                    break;
                case "title":
                    Apply(t => t.Title, field.Descending);
                    break;
                case "taskNumber":
                    Apply(t => t.Id, field.Descending);
                    break;
                case "priority":
                    Apply(PriorityRank(await _priorities.ListAsync(includeInactive: true, ct)), field.Descending);
                    break;
            }
        }

        return ordered!.ThenBy(t => t.Id);
    }

    /// <summary>A CASE expression mapping a priority id to its configured sort order (the priority table belongs to another module).</summary>
    internal static Expression<Func<WorkTask, int>> PriorityRank(IReadOnlyList<PriorityInfo> priorities)
    {
        var task = Expression.Parameter(typeof(WorkTask), "t");
        var priorityId = Expression.Property(task, nameof(WorkTask.PriorityId));
        Expression body = Expression.Constant(int.MaxValue);
        foreach (var p in priorities.Reverse())
            body = Expression.Condition(Expression.Equal(priorityId, Expression.Constant(p.Id)), Expression.Constant(p.SortOrder), body);

        return Expression.Lambda<Func<WorkTask, int>>(body, task);
    }

    // ---- create

    private sealed record Created(long TaskId, CommandNotes Notes);

    public async Task<Result<TaskResponse>> CreateAsync(CreateTaskRequest request, CancellationToken ct)
    {
        // Sub-permissions first: a denied part rejects the whole request (permission matrix PM-X-09).
        if (request.AssignedPodId is not null || request.AssignedUserId is not null)
        {
            var assign = _permissions.Require(Permissions.Task.Assign);
            if (assign.IsFailure)
                return assign.Error!;
        }

        var defaultPriority = await _priorities.GetDefaultAsync(ct);
        if (request.PriorityId is { } requested && requested != defaultPriority.Id)
        {
            var setPriority = _permissions.Require(Permissions.Task.SetPriority);
            if (setPriority.IsFailure)
                return setPriority.Error!;
        }

        var description = TaskDescription.Prepare(request.Description);
        if (TaskSupport.ValidateTextsPrepared(request.Title, description.Error, request.RequestorName, request.RequestorEmail) is { } invalid)
            return invalid;

        var due = TaskDueParser.Parse(request.DueDate, request.DueTime, _timeZone.ToUtc);
        if (due.IsFailure)
            return due.Error!;

        var created = await _tx.RunAsync(token => CreateCoreAsync(request, description.Html, defaultPriority, due.Value, token), ct);
        return created.IsFailure ? created.Error! : await _presenter.GetAsync(created.Value.TaskId, created.Value.Notes, ct);
    }

    private async Task<Result<Created>> CreateCoreAsync(CreateTaskRequest request, string? descriptionHtml, PriorityInfo defaultPriority, TaskDue due, CancellationToken ct)
    {
        // The Matter row lock makes "create a Task" and "deactivate the Matter" mutually exclusive (architecture 10.3).
        await _tx.LockMatterAsync(request.MatterId, ct);
        var matter = await _matters.FindAsync(request.MatterId, ct);
        if (matter is null)
            return Error.Validation("matterId", "NOT_FOUND", "Select a matter.");
        if (!matter.IsActive)
            return Error.Conflict(ErrorCodes.MatterInactive, $"Matter {matter.MatterRef} is inactive; tasks can't be created on it.");

        if (request.ProjectId is { } projectId)
        {
            var project = await CheckProjectAsync(projectId, matter.MatterId, ct);
            if (project.IsFailure)
                return project.Error!;
        }

        var type = await _taskTypes.GetAsync(request.TaskTypeId, ct);
        if (type is null)
            return Error.Validation("taskTypeId", "NOT_FOUND", "Select a task type.");
        if (!type.IsUsable)
            return Error.Validation("taskTypeId", "NOT_USABLE", $"Task type '{type.Name}' is inactive or not fully configured, so it can't be used for new tasks.");
        if (!type.EligibleWorkflowIds.Contains(request.WorkflowDefinitionId))
        {
            return Error.Conflict(
                ErrorCodes.WorkflowNotEligible,
                $"The chosen workflow is not one of the workflows task type '{type.Name}' offers.",
                new Dictionary<string, object?> { ["eligibleWorkflowIds"] = type.EligibleWorkflowIds });
        }

        var workflow = await _workflowCatalog.GetPublishedVersionAsync(request.WorkflowDefinitionId, ct);
        if (workflow.IsFailure)
            return Result<Created>.Failure(workflow.Error!);

        var priorityId = request.PriorityId ?? defaultPriority.Id;
        if (!await _priorities.IsAssignableAsync(priorityId, ct))
            return Error.Validation("priorityId", "NOT_AVAILABLE", "Select an active priority.");

        var assignees = await ValidateAssigneesAsync(request.AssignedPodId, request.AssignedUserId, current: null, ct);
        if (assignees.IsFailure)
            return Result<Created>.Failure(assignees.Error!);

        // Request form values against the Task Type's published form version (captured on the Task).
        var values = request.FormValues ?? [];
        FormSubmissionResult? form = null;
        if (type.PublishedFormVersionId is { } formVersionId)
        {
            var checkedForm = await _validator.ValidateAsync(formVersionId, values, new FormSubmissionOptions { Mode = FormSubmissionMode.Submit, References = new FormReferenceContext(request.MatterId) }, ct);
            if (checkedForm.IsFailure)
                return Result<Created>.Failure(checkedForm.Error!);
            if (checkedForm.Value.ToError() is { } formError)
                return formError;

            form = checkedForm.Value;
        }
        else if (values.Count > 0 && values.Values.Any(v => v.ValueKind != JsonValueKind.Null))
        {
            return Error.Validation("formValues", "NO_REQUEST_FORM", $"Task type '{type.Name}' has no request form fields.");
        }

        var instance = await _workflows.InstantiateAsync(workflow.Value.WorkflowVersionId, ct);
        if (instance.IsFailure)
            return Result<Created>.Failure(instance.Error!);

        var now = _clock.UtcNow;
        var assignment = TaskAssignment.Apply(TaskStatusCode.New, request.AssignedUserId, request.AssignedPodId, assignees.Value.UserInPod);
        var task = new WorkTask
        {
            Number = TaskNumber.Format(await _tx.NextTaskNumberAsync(ct)),
            MatterId = matter.MatterId,
            ProjectId = request.ProjectId,
            TaskTypeId = type.Id,
            FormVersionId = type.PublishedFormVersionId,
            WorkflowInstanceId = instance.Value,
            Title = request.Title.Trim(),
            Description = descriptionHtml,
            DescriptionFormat = TaskDescriptionFormat.Html,
            PriorityId = priorityId,
            Status = assignment.Status,
            AssignedPodId = request.AssignedPodId,
            AssignedUserId = request.AssignedUserId,
            AssignedAtUtc = request.AssignedUserId is null ? null : now,
            RequestorName = request.RequestorName.Trim(),
            RequestorEmail = TaskSupport.Clean(request.RequestorEmail),
            RequestedAtUtc = TaskSupport.ToUtc(request.RequestedAtUtc),
            DueDate = due.Date,
            DueAtUtc = due.AtUtc,
            DueSortKey = due.DueSortKey,
            StatusChangedAtUtc = now,
            CompletedAtUtc = null,
        };
        _db.Set<WorkTask>().Add(task);
        await _db.SaveChangesAsync(ct);

        QueueCreatedAudit(task, assignment);

        IReadOnlyList<string> dropped = [];
        if (form is not null)
        {
            var saved = await _valueStore.SaveAsync(
                FormValueOwnerKind.Task,
                task.Id,
                form.FormVersionId,
                values,
                new FormSaveOptions { Mode = FormSubmissionMode.Submit, References = new FormReferenceContext(task.MatterId) },
                ct);
            if (saved.IsFailure)
                return Result<Created>.Failure(saved.Error!);

            dropped = saved.Value.DroppedFields;
        }

        await _db.SaveChangesAsync(ct);
        return new Created(task.Id, new CommandNotes(assignment.UserNotInPodWarning ? [UserNotInPodWarning] : [], dropped, []));
    }

    private void QueueCreatedAudit(WorkTask task, AssignmentOutcome assignment)
    {
        _audit.Write(new AuditEntry
        {
            EventType = AuditEventTypes.TaskCreated,
            ObjectType = TaskSupport.TaskObjectType,
            ObjectId = TaskSupport.Id(task.Id),
            TaskId = task.Id,
            MatterId = task.MatterId,
            Summary = Clip($"{task.Number} created: {task.Title}"),
        });

        if (task.AssignedPodId is not null || task.AssignedUserId is not null)
            WriteAssigned(task, null, null);

        if (assignment.AutoStarted)
            TaskAudit.StatusChanged(_audit, task, TaskStatusCode.New, task.Status, "ASSIGNMENT");
    }

    // ---- update

    public async Task<Result<TaskResponse>> UpdateAsync(long taskId, UpdateTaskRequest request, CancellationToken ct)
    {
        var description = TaskDescription.Prepare(request.Description);
        if (TaskSupport.ValidateTextsPrepared(request.Title, description.Error, request.RequestorName, request.RequestorEmail) is { } invalid)
            return invalid;

        var due = TaskDueParser.Parse(request.DueDate, request.DueTime, _timeZone.ToUtc);
        if (due.IsFailure)
            return due.Error!;

        var updated = await _tx.RunAsync(token => UpdateCoreAsync(taskId, request, description.Html, due.Value, token), ct);
        return updated.IsFailure ? updated.Error! : await _presenter.GetAsync(taskId, updated.Value, ct);
    }

    private async Task<Result<CommandNotes>> UpdateCoreAsync(long taskId, UpdateTaskRequest request, string? descriptionHtml, TaskDue due, CancellationToken ct)
    {
        var task = await _tx.LockTaskAsync(taskId, ct);
        if (task is null)
            return TaskSupport.NotFound();

        var version = TaskSupport.CheckRowVersion(task.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return Result<CommandNotes>.Failure(version.Error!);

        if (request.MatterId is { } matterId && matterId != task.MatterId)
            return Error.Conflict(ErrorCodes.ImmutableField, "A task belongs to one matter and cannot move to another. Cancel it and create a new task instead.");
        if (request.TaskTypeId is { } typeId && typeId != task.TaskTypeId)
            return Error.Conflict(ErrorCodes.ImmutableField, "The task type cannot be changed after the task is created. Cancel it and create a new task instead.");
        if (request.WorkflowDefinitionId is { } definitionId)
        {
            var current = await _workflows.GetAsync(task.WorkflowInstanceId, ct);
            if (current.IsSuccess && current.Value.WorkflowDefinitionId != definitionId)
                return Error.Conflict(ErrorCodes.ImmutableField, "The workflow cannot be changed after the task is created. Cancel it and create a new task instead.");
        }

        if (TaskEditability.Check(task.Status, TaskOperation.EditDetails) is { } notEditable)
            return NotEditable(task.Status, notEditable);

        // Plan: compute every change and validate everything before the first write.
        var changes = new List<(string Key, string? Old, string? New)>();

        void Track(string key, string? oldValue, string? newValue)
        {
            if (!string.Equals(oldValue, newValue, StringComparison.Ordinal))
                changes.Add((key, oldValue, newValue));
        }

        var title = request.Title.Trim();

        // A description saved before decision R is plain text. A client that sends it back unchanged (a title edit, an older client) must not
        // convert it, so the text stays as it is and nothing is audited; any other value is the sanitized HTML.
        var sentText = TaskSupport.Clean(request.Description);
        var keepText = task.DescriptionFormat == TaskDescriptionFormat.Text && sentText is not null && string.Equals(sentText, task.Description, StringComparison.Ordinal);
        var description = keepText ? task.Description : descriptionHtml;
        var descriptionFormat = keepText ? TaskDescriptionFormat.Text : TaskDescriptionFormat.Html;
        var requestorName = request.RequestorName.Trim();
        var requestorEmail = TaskSupport.Clean(request.RequestorEmail);

        Track("title", task.Title, title);
        if (!string.Equals(task.Description, description, StringComparison.Ordinal))
        {
            // The audit trail keeps what people read (plain text), never markup.
            changes.Add(("description", AuditText(TaskDescription.ToPlainText(task.Description, task.DescriptionFormat)), AuditText(TaskDescription.ToPlainText(description, descriptionFormat))));
        }
        else if (task.Description is null)
        {
            descriptionFormat = task.DescriptionFormat;
        }
        Track("requestorName", task.RequestorName, requestorName);
        Track("requestorEmail", task.RequestorEmail, requestorEmail);
        Track("requestedAt", TaskSupport.Display(task.RequestedAtUtc), TaskSupport.Display(request.RequestedAtUtc));
        Track("dueDate", TaskSupport.Display(task.DueDate), TaskSupport.Display(due.Date));
        Track("dueAtUtc", TaskSupport.Display(task.DueAtUtc), TaskSupport.Display(due.AtUtc));

        if (request.ProjectId != task.ProjectId)
        {
            ProjectSummary? project = null;
            if (request.ProjectId is { } newProjectId)
            {
                var checkedProject = await CheckProjectAsync(newProjectId, task.MatterId, ct);
                if (checkedProject.IsFailure)
                    return Result<CommandNotes>.Failure(checkedProject.Error!);

                project = checkedProject.Value;
            }

            var oldProject = task.ProjectId is { } oldId ? await _projects.FindAsync(oldId, ct) : null;
            Track("project", oldProject?.Name, project?.Name);
        }

        var newPriorityId = request.PriorityId ?? task.PriorityId;
        PriorityInfo? oldPriority = null;
        PriorityInfo? newPriority = null;
        if (newPriorityId != task.PriorityId)
        {
            var permission = _permissions.Require(Permissions.Task.SetPriority);
            if (permission.IsFailure)
                return Result<CommandNotes>.Failure(permission.Error!);

            if (!await _priorities.IsAssignableAsync(newPriorityId, ct))
                return Error.Validation("priorityId", "NOT_AVAILABLE", "Select an active priority.");

            oldPriority = await _priorities.GetAsync(task.PriorityId, ct);
            newPriority = await _priorities.GetAsync(newPriorityId, ct);
            Track("priority", oldPriority?.Label, newPriority?.Label);
        }

        var formPlan = await PlanFormValuesAsync(task, request.FormValues, ct);
        if (formPlan.IsFailure)
            return Result<CommandNotes>.Failure(formPlan.Error!);

        var form = formPlan.Value;
        foreach (var change in form?.Changes ?? [])
            changes.Add(change);

        if (changes.Count == 0)
            return CommandNotes.None;

        // Apply.
        task.Title = title;
        task.Description = description;
        task.DescriptionFormat = descriptionFormat;
        task.RequestorName = requestorName;
        task.RequestorEmail = requestorEmail;
        task.RequestedAtUtc = TaskSupport.ToUtc(request.RequestedAtUtc);
        task.DueDate = due.Date;
        task.DueAtUtc = due.AtUtc;
        task.DueSortKey = due.DueSortKey;
        task.ProjectId = request.ProjectId;
        task.PriorityId = newPriorityId;
        Touch(task);
        TaskSupport.TrackOriginalRowVersion(_db, task, request.RowVersion);

        foreach (var (key, oldValue, newValue) in changes)
        {
            _audit.Write(new AuditEntry
            {
                EventType = AuditEventTypes.FieldChanged,
                ObjectType = TaskSupport.TaskObjectType,
                ObjectId = TaskSupport.Id(task.Id),
                TaskId = task.Id,
                MatterId = task.MatterId,
                FieldKey = Clip100(key),
                OldValue = oldValue,
                NewValue = newValue,
            });
        }

        _audit.Write(new AuditEntry
        {
            EventType = TaskSupport.TaskUpdatedEvent,
            ObjectType = TaskSupport.TaskObjectType,
            ObjectId = TaskSupport.Id(task.Id),
            TaskId = task.Id,
            MatterId = task.MatterId,
            Summary = Clip("Updated: " + string.Join(", ", changes.Select(c => c.Key))),
        });

        if (form is { Dropped.Count: > 0 })
        {
            _audit.Write(new AuditEntry
            {
                EventType = "FORM_VALUES_DROPPED",
                ObjectType = TaskSupport.TaskObjectType,
                ObjectId = TaskSupport.Id(task.Id),
                TaskId = task.Id,
                MatterId = task.MatterId,
                Summary = Clip("Hidden values dropped: " + string.Join(", ", form.Dropped)),
            });
        }

        await _db.SaveChangesAsync(ct);

        if (form is not null && request.FormValues is not null)
        {
            var saved = await _valueStore.SaveAsync(
                FormValueOwnerKind.Task,
                task.Id,
                form.FormVersionId,
                request.FormValues,
                new FormSaveOptions { Mode = FormSubmissionMode.Submit, ValidateOnlyChanged = true, References = new FormReferenceContext(task.MatterId) },
                ct);
            if (saved.IsFailure)
                return Result<CommandNotes>.Failure(saved.Error!);
        }

        return new CommandNotes([], form?.Dropped ?? [], []);
    }

    private sealed record FormPlan(int FormVersionId, IReadOnlyList<(string Key, string? Old, string? New)> Changes, IReadOnlyList<string> Dropped);

    /// <summary>Validates ONLY the changed fields of a form-values patch (FND-07) and works out the per-field changes. Null when no values were sent.</summary>
    private async Task<Result<FormPlan?>> PlanFormValuesAsync(WorkTask task, Dictionary<string, JsonElement>? patch, CancellationToken ct)
    {
        if (patch is null || patch.Count == 0)
            return Result<FormPlan?>.Success(null);

        if (task.FormVersionId is not { } formVersionId)
        {
            return patch.Values.All(v => v.ValueKind == JsonValueKind.Null)
                ? Result<FormPlan?>.Success(null)
                : Error.Validation("formValues", "NO_REQUEST_FORM", "This task's type has no request form fields.");
        }

        var version = await _forms.GetVersionAsync(formVersionId, ct);
        if (version.IsFailure)
            return Result<FormPlan?>.Failure(version.Error!);

        var stored = await _valueStore.GetAsync(FormValueOwnerKind.Task, task.Id, version.Value.FormDefinitionId, ct);
        var previous = stored?.Values ?? NoValues;
        var validated = await _validator.ValidateAsync(
            formVersionId,
            patch,
            new FormSubmissionOptions
            {
                Mode = FormSubmissionMode.Submit,
                ExistingValues = stored is null ? null : previous,
                ValidateOnly = stored is null ? null : FormSubmissionOptions.ChangedFieldsOf(patch, previous),
                References = new FormReferenceContext(task.MatterId),
            },
            ct);
        if (validated.IsFailure)
            return Result<FormPlan?>.Failure(validated.Error!);
        if (validated.Value.ToError() is { } invalid)
            return invalid;

        var current = validated.Value.NormalizedValues;
        var changes = new List<(string, string?, string?)>();
        foreach (var key in previous.Keys.Concat(current.Keys.Where(k => !previous.ContainsKey(k))))
        {
            var hadOld = previous.TryGetValue(key, out var oldValue);
            var hasNew = current.TryGetValue(key, out var newValue);
            if (hadOld && hasNew && oldValue.GetRawText() == newValue.GetRawText())
                continue;

            changes.Add(("form:" + key, hadOld ? Display(oldValue) : null, hasNew ? Display(newValue) : null));
        }

        return new FormPlan(formVersionId, changes, validated.Value.DroppedFields);
    }

    // ---- assignment and priority

    public async Task<Result<TaskResponse>> AssignAsync(long taskId, AssignTaskRequest request, CancellationToken ct)
    {
        var assigned = await _tx.RunAsync(token => AssignCoreAsync(taskId, request, token), ct);
        return assigned.IsFailure ? assigned.Error! : await _presenter.GetAsync(taskId, assigned.Value, ct);
    }

    private async Task<Result<CommandNotes>> AssignCoreAsync(long taskId, AssignTaskRequest request, CancellationToken ct)
    {
        var task = await _tx.LockTaskAsync(taskId, ct);
        if (task is null)
            return TaskSupport.NotFound();

        var version = TaskSupport.CheckRowVersion(task.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return Result<CommandNotes>.Failure(version.Error!);

        if (TaskEditability.Check(task.Status, TaskOperation.AssignOrPrioritize) is { } notEditable)
            return NotEditable(task.Status, notEditable);

        if (task.AssignedPodId == request.PodId && task.AssignedUserId == request.UserId)
            return CommandNotes.None;

        var checkedAssignees = await ValidateAssigneesAsync(request.PodId, request.UserId, task, ct);
        if (checkedAssignees.IsFailure)
            return Result<CommandNotes>.Failure(checkedAssignees.Error!);

        var assignment = TaskAssignment.Apply(task.Status, request.UserId, request.PodId, checkedAssignees.Value.UserInPod);
        var oldStatus = task.Status;
        var oldPod = task.AssignedPodId;
        var oldUser = task.AssignedUserId;

        task.AssignedPodId = request.PodId;
        if (task.AssignedUserId != request.UserId)
            task.AssignedAtUtc = request.UserId is null ? null : _clock.UtcNow;
        task.AssignedUserId = request.UserId;
        if (assignment.AutoStarted)
        {
            var decision = TaskLifecycle.Evaluate(oldStatus, assignment.Status, new TransitionContext(Cause: TransitionCause.Assignment));
            if (!decision.Allowed)
                return Error.Conflict(decision.ErrorCode!, "The task cannot be started by this assignment.");

            task.Status = assignment.Status;
            task.StatusChangedAtUtc = _clock.UtcNow;
        }

        Touch(task);
        TaskSupport.TrackOriginalRowVersion(_db, task, request.RowVersion);
        WriteAssigned(task, oldPod, oldUser);
        if (assignment.AutoStarted)
            TaskAudit.StatusChanged(_audit, task, oldStatus, task.Status, "ASSIGNMENT");

        await _db.SaveChangesAsync(ct);
        return new CommandNotes(assignment.UserNotInPodWarning ? [UserNotInPodWarning] : [], [], []);
    }

    public async Task<Result<TaskResponse>> SetPriorityAsync(long taskId, SetTaskPriorityRequest request, CancellationToken ct)
    {
        var done = await _tx.RunAsync(token => SetPriorityCoreAsync(taskId, request, token), ct);
        return done.IsFailure ? done.Error! : await _presenter.GetAsync(taskId, null, ct);
    }

    private async Task<Result<bool>> SetPriorityCoreAsync(long taskId, SetTaskPriorityRequest request, CancellationToken ct)
    {
        var task = await _tx.LockTaskAsync(taskId, ct);
        if (task is null)
            return TaskSupport.NotFound();

        var version = TaskSupport.CheckRowVersion(task.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return Result<bool>.Failure(version.Error!);

        if (TaskEditability.Check(task.Status, TaskOperation.AssignOrPrioritize) is { } notEditable)
            return NotEditable(task.Status, notEditable);

        if (task.PriorityId == request.PriorityId)
            return true;

        if (!await _priorities.IsAssignableAsync(request.PriorityId, ct))
            return Error.Validation("priorityId", "NOT_AVAILABLE", "Select an active priority.");

        var oldPriority = await _priorities.GetAsync(task.PriorityId, ct);
        var newPriority = await _priorities.GetAsync(request.PriorityId, ct);
        task.PriorityId = request.PriorityId;
        Touch(task);
        TaskSupport.TrackOriginalRowVersion(_db, task, request.RowVersion);
        _audit.Write(new AuditEntry
        {
            EventType = AuditEventTypes.FieldChanged,
            ObjectType = TaskSupport.TaskObjectType,
            ObjectId = TaskSupport.Id(task.Id),
            TaskId = task.Id,
            MatterId = task.MatterId,
            FieldKey = "priority",
            OldValue = oldPriority?.Label,
            NewValue = newPriority?.Label,
        });
        await _db.SaveChangesAsync(ct);
        return true;
    }

    // ---- shared pieces

    internal static Error NotEditable(TaskStatusCode status, string code) =>
        Error.Conflict(
            code,
            status == TaskStatusCode.OnHold
                ? "This task is on hold; resume it first."
                : $"A {(status == TaskStatusCode.Completed ? "completed" : "cancelled")} task can't be changed; reopen it first.",
            new Dictionary<string, object?> { ["taskStatus"] = status.ToCode() });

    private void Touch(WorkTask task)
    {
        // Forces an UPDATE (new rowversion) even when only the form values changed, and stamps who edited.
        task.ModifiedAtUtc = _clock.UtcNow;
        task.ModifiedByUserId = _currentUser.UserId;
        _db.Entry(task).Property(t => t.ModifiedAtUtc).IsModified = true;
    }

    private async Task<Result<ProjectSummary>> CheckProjectAsync(int projectId, int matterId, CancellationToken ct)
    {
        var project = await _projects.FindAsync(projectId, ct);
        if (project is null)
            return Error.Validation("projectId", "NOT_FOUND", "Select a project.");
        if (project.MatterId != matterId)
            return Error.Conflict(ErrorCodes.CrossMatterReference, "The project belongs to a different matter than the task.");
        if (!project.IsActive)
            return Error.Conflict(ErrorCodes.ProjectInactive, $"Project '{project.Name}' is archived; choose another.");

        return project;
    }

    private sealed record Assignees(bool? UserInPod);

    /// <summary>A Pod must exist and be active, a user must exist and be active; only changed values are checked. A user outside the Pod is a warning.</summary>
    private async Task<Result<Assignees>> ValidateAssigneesAsync(int? podId, int? userId, WorkTask? current, CancellationToken ct)
    {
        if (podId is { } pod && pod != current?.AssignedPodId)
        {
            var info = await _pods.FindAsync(pod, ct);
            if (info is null)
                return Error.Validation("podId", "NOT_FOUND", "Select a pod.");
            if (!info.IsActive)
                return Error.Conflict(ErrorCodes.PodInactive, $"Pod '{info.Name}' is inactive; choose another.");
        }

        if (userId is { } user && user != current?.AssignedUserId)
        {
            var info = await _users.FindAsync(user, ct);
            if (info is null)
                return Error.Validation("userId", "NOT_FOUND", "Select a user.");
            if (!info.IsActive)
                return Error.Validation("userId", "USER_INACTIVE", $"{info.DisplayName} is disabled and can't be assigned work.");
        }

        bool? inPod = null;
        if (podId is { } p && userId is { } u)
            inPod = (await _pods.GetMemberUserIdsAsync(p, ct)).Contains(u);

        return new Assignees(inPod);
    }

    private void WriteAssigned(WorkTask task, int? oldPod, int? oldUser)
    {
        static string Json(int? pod, int? user) => $"{{\"podId\":{(pod is null ? "null" : pod.ToString())},\"userId\":{(user is null ? "null" : user.ToString())}}}";

        _audit.Write(new AuditEntry
        {
            EventType = AuditEventTypes.TaskAssigned,
            ObjectType = TaskSupport.TaskObjectType,
            ObjectId = TaskSupport.Id(task.Id),
            TaskId = task.Id,
            MatterId = task.MatterId,
            FieldKey = "assignment",
            OldValue = Json(oldPod, oldUser),
            NewValue = Json(task.AssignedPodId, task.AssignedUserId),
            Summary = Clip($"Assignment changed: pod {task.AssignedPodId?.ToString() ?? "none"}, user {task.AssignedUserId?.ToString() ?? "none"}"),
        });
    }

    private static string? Display(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Null => null,
        _ => e.GetRawText(),
    };

    /// <summary>The description text kept in an audit row: empty becomes null, and no more than the plain-text limit.</summary>
    private static string? AuditText(string text) => text.Length == 0 ? null : text.Length <= TaskDescription.MaxTextLength ? text : text[..TaskDescription.MaxTextLength];

    private static string Clip(string text) => text.Length <= 500 ? text : text[..500];

    private static string Clip100(string key) => key.Length <= 100 ? key : key[..100];
}
