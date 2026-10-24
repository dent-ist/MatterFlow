using System.ComponentModel.DataAnnotations;
using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.Configuration.Infrastructure;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.TaskTypes;

/// <summary>A Task Type for the admin screen (UX S14) and the Task screens' pickers.</summary>
/// <param name="Id">Task Type id.</param>
/// <param name="Name">Unique display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IconKey">Key of the type's icon in the icon library (<c>contracts/task-type-icons.json</c>). Always set; neutral colour.</param>
/// <param name="IsActive">False = not offered for new Tasks; historical Tasks keep it.</param>
/// <param name="DefaultWorkflowDefinitionId">Workflow pre-selected for new Tasks; one of the eligible workflows.</param>
/// <param name="EligibleWorkflowIds">Workflow definition ids a new Task of this type may use, ascending.</param>
/// <param name="FormDefinitionId">The request form's definition id (provisioned together with the Task Type).</param>
/// <param name="FormStatus">Published when a version is published, else Draft when a draft is open, else Retired; absent when the form has no versions.</param>
/// <param name="PublishedFormVersionId">The current PUBLISHED request-form version.</param>
/// <param name="PublishedFormVersionNo">Its version number.</param>
/// <param name="DraftFormVersionNo">The open draft's version number.</param>
/// <param name="HasFormFields">True when any form version has at least one field.</param>
/// <param name="IsUsable">True when active, the form is published (or has no fields) and there is at least one eligible workflow.</param>
/// <param name="UsabilityIssues">Why the type is not usable: INACTIVE, FORM_NOT_PUBLISHED, NO_ELIGIBLE_WORKFLOW. Empty when usable.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64); send it back on update.</param>
/// <param name="OpenTaskCount">
/// Tasks of this type that are open (New, In Progress or On Hold, the Task Queue definition), over every pod and Matter, counting only the Tasks the viewer may see
/// (sensitive-matter rule). Null (not 0) when the viewer lacks <c>Task.View</c>. The list, the detail and the create and
/// update responses all carry it.
/// </param>
public sealed record TaskTypeView(
    [property: Required] int Id,
    [property: Required] string Name,
    string? Description,
    [property: Required] string IconKey,
    [property: Required] bool IsActive,
    int? DefaultWorkflowDefinitionId,
    [property: Required] IReadOnlyList<int> EligibleWorkflowIds,
    int? FormDefinitionId,
    FormVersionStatus? FormStatus,
    int? PublishedFormVersionId,
    int? PublishedFormVersionNo,
    int? DraftFormVersionNo,
    [property: Required] bool HasFormFields,
    [property: Required] bool IsUsable,
    [property: Required] IReadOnlyList<string> UsabilityIssues,
    [property: Required] string RowVersion,
    int? OpenTaskCount = null);

/// <summary>Body to create a Task Type. Its (empty) request form is provisioned with it.</summary>
/// <param name="Name">Unique display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IsActive">Defaults to true.</param>
/// <param name="EligibleWorkflowIds">Workflows a new Task of this type may use.</param>
/// <param name="DefaultWorkflowDefinitionId">One of the eligible workflows.</param>
/// <param name="IconKey">An icon key from the library; omitted = the default icon (<c>file-text</c>). 400 <c>UNKNOWN_ICON</c> when not in the library.</param>
public sealed record CreateTaskTypeRequest(
    [Required, StringLength(100)] string Name,
    [StringLength(1000)] string? Description,
    bool IsActive = true,
    IReadOnlyList<int>? EligibleWorkflowIds = null,
    int? DefaultWorkflowDefinitionId = null,
    [StringLength(50)] string? IconKey = null);

/// <summary>Body to change a Task Type, including its complete set of eligible workflows.</summary>
public sealed record UpdateTaskTypeRequest(
    [Required, StringLength(100)] string Name,
    [StringLength(1000)] string? Description,
    [Required] bool IsActive,
    [Required] IReadOnlyList<int> EligibleWorkflowIds,
    int? DefaultWorkflowDefinitionId,
    [Required] string RowVersion,
    [Required, StringLength(50)] string IconKey);

/// <summary>Task Types: admin commands (audited) and the <see cref="ITaskTypeCatalog"/> read side for other modules.</summary>
public sealed class TaskTypeService(
    DbContext db,
    IFormDefinitionResolver forms,
    IAuditWriter audit,
    IClock clock,
    ICurrentUser currentUser,
    IPermissionChecker permissions,
    IConfigurationTaskCounts taskCounts) : ITaskTypeCatalog
{
    private const string ObjectType = "TaskType";

    public const string Inactive = "INACTIVE";
    public const string FormNotPublished = "FORM_NOT_PUBLISHED";
    public const string NoEligibleWorkflow = "NO_ELIGIBLE_WORKFLOW";

    private sealed record FormFacts(
        int DefinitionId,
        int? PublishedId,
        int? PublishedNo,
        int? DraftNo,
        bool AnyRetired,
        bool HasFields);

    // ---- read side

    /// <summary>All Task Types by name; with <paramref name="workflowId"/> only the types that list that workflow as eligible.</summary>
    public Task<IReadOnlyList<TaskTypeView>> ListViewsAsync(int? workflowId = null, CancellationToken ct = default) => LoadViewsAsync(workflowId, true, ct);

    /// <summary>Sort keys of the list: the name (default) or the open Task count, each ascending or descending (<c>-</c>); ties and equal counts follow the name.</summary>
    public static readonly string[] SortFields = ["name", "-name", "openTaskCount", "-openTaskCount"];

    /// <summary>
    /// The list in the requested order. The list is not paged (every Task Type comes back), so the order is applied to the loaded rows. Without
    /// <c>Task.View</c> the counts are null and a count sort falls back to the name order. 400 <c>INVALID</c> for an unknown sort key.
    /// </summary>
    public async Task<Result<IReadOnlyList<TaskTypeView>>> ListViewsAsync(int? workflowId, string? sort, CancellationToken ct = default)
    {
        if (sort is not null && !SortFields.Contains(sort))
            return Error.Validation("sort", "INVALID", $"sort must be one of: {string.Join(", ", SortFields)}.");

        var rows = await LoadViewsAsync(workflowId, true, ct);
        // The rows come back by name (the database collation); the LINQ orderings below are stable, so equal counts keep that name order.
        IEnumerable<TaskTypeView> ordered = sort switch
        {
            "-name" => rows.Reverse(),
            "openTaskCount" => rows.OrderBy(r => r.OpenTaskCount ?? 0),
            "-openTaskCount" => rows.OrderByDescending(r => r.OpenTaskCount ?? 0),
            _ => rows,
        };
        return Result<IReadOnlyList<TaskTypeView>>.Success([.. ordered]);
    }

    private async Task<IReadOnlyList<TaskTypeView>> LoadViewsAsync(int? workflowId, bool withCounts, CancellationToken ct)
    {
        var query = db.Set<TaskType>().AsNoTracking().Include(t => t.EligibleWorkflows).AsQueryable();
        if (workflowId is { } wanted)
        {
            query = query.Where(t => t.EligibleWorkflows.Any(e => e.WorkflowDefinitionId == wanted));
        }

        var rows = await query.OrderBy(t => t.Name).ThenBy(t => t.Id).ToListAsync(ct);
        var ids = rows.Select(r => r.Id).ToList();
        var facts = await LoadFormFactsAsync(ids, ct);
        var counts = withCounts ? await OpenCountsAsync(ids, ct) : null;
        return [.. rows.Select(r => ToView(r, facts.GetValueOrDefault(r.Id), counts is null ? null : counts.GetValueOrDefault(r.Id)))];
    }

    public async Task<Result<TaskTypeView>> GetViewAsync(int id, CancellationToken ct = default) => await GetViewAsync(id, true, ct);

    private async Task<Result<TaskTypeView>> GetViewAsync(int id, bool withCounts, CancellationToken ct)
    {
        var row = await db.Set<TaskType>().AsNoTracking().Include(t => t.EligibleWorkflows).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (row is null)
            return Error.NotFound("Task type not found.");
        var facts = await LoadFormFactsAsync([id], ct);
        var counts = withCounts ? await OpenCountsAsync([id], ct) : null;
        return ToView(row, facts.GetValueOrDefault(id), counts is null ? null : counts.GetValueOrDefault(id));
    }

    /// <summary>
    /// The open Task count of each Task Type (one grouped statement for the whole page of ids), or null when the viewer may not see Tasks, so the
    /// responses carry null instead of a made-up 0 (the Organization lists do the same). A type with no open Task is 0.
    /// </summary>
    private async Task<Dictionary<int, int>?> OpenCountsAsync(IReadOnlyCollection<int> ids, CancellationToken ct)
    {
        if (!permissions.Has(Permissions.Task.View))
            return null;
        return new Dictionary<int, int>(await taskCounts.OpenByTaskTypeAsync(ids, ct));
    }

    public async Task<IReadOnlyList<TaskTypeInfo>> ListUsableAsync(CancellationToken cancellationToken = default) =>
        [.. (await ListAsync(false, cancellationToken)).Where(t => t.IsUsable)];

    public async Task<IReadOnlyList<TaskTypeInfo>> ListAsync(bool includeInactive, CancellationToken cancellationToken = default) =>
        [.. (await LoadViewsAsync(null, false, cancellationToken)).Where(v => includeInactive || v.IsActive).Select(ToInfo)];

    public async Task<TaskTypeInfo?> GetAsync(int taskTypeId, CancellationToken cancellationToken = default)
    {
        var view = await GetViewAsync(taskTypeId, false, cancellationToken);
        return view.IsSuccess ? ToInfo(view.Value) : null;
    }

    public async Task<IReadOnlyList<TaskTypeWorkflowLink>> ListWorkflowLinksAsync(
        IReadOnlyCollection<int>? workflowIds = null, int? taskTypeId = null, CancellationToken cancellationToken = default)
    {
        var links = db.Set<TaskTypeWorkflowEligibility>().AsNoTracking().AsQueryable();
        if (workflowIds is not null)
        {
            var wanted = workflowIds.ToList();
            links = links.Where(l => wanted.Contains(l.WorkflowDefinitionId));
        }

        if (taskTypeId is { } one)
        {
            links = links.Where(l => l.TaskTypeId == one);
        }

        return await (
            from l in links
            join t in db.Set<TaskType>().AsNoTracking() on l.TaskTypeId equals t.Id
            orderby t.Name, t.Id
            select new TaskTypeWorkflowLink(t.Id, t.Name, t.IsActive, l.WorkflowDefinitionId, t.DefaultWorkflowDefinitionId == l.WorkflowDefinitionId))
            .ToListAsync(cancellationToken);
    }

    private static TaskTypeInfo ToInfo(TaskTypeView v) =>
        new(v.Id, v.Name, v.Description, v.IconKey, v.IsActive, v.FormDefinitionId, v.PublishedFormVersionId, v.HasFormFields, v.EligibleWorkflowIds, v.DefaultWorkflowDefinitionId, v.IsUsable);

    private static TaskTypeView ToView(TaskType t, FormFacts? form, int? openTaskCount)
    {
        var eligible = t.EligibleWorkflows.Select(e => e.WorkflowDefinitionId).Order().ToList();
        var issues = new List<string>();
        if (!t.IsActive)
            issues.Add(Inactive);
        // A published form is required once the form has fields; a type whose form never had a field needs none.
        if (form is { PublishedId: null } && form.HasFields)
            issues.Add(FormNotPublished);
        if (eligible.Count == 0)
            issues.Add(NoEligibleWorkflow);

        var status = form is null ? (FormVersionStatus?)null
            : form.PublishedId is not null ? FormVersionStatus.Published
            : form.DraftNo is not null ? FormVersionStatus.Draft
            : form.AnyRetired ? FormVersionStatus.Retired
            : null;
        return new TaskTypeView(
            t.Id,
            t.Name,
            t.Description,
            t.IconKey,
            t.IsActive,
            t.DefaultWorkflowDefinitionId,
            eligible,
            form?.DefinitionId,
            status,
            form?.PublishedId,
            form?.PublishedNo,
            form?.DraftNo,
            form?.HasFields ?? false,
            issues.Count == 0,
            issues,
            LookupSupport.FormatRowVersion(t.RowVersion),
            openTaskCount);
    }

    private async Task<Dictionary<int, FormFacts>> LoadFormFactsAsync(IReadOnlyCollection<int> taskTypeIds, CancellationToken ct)
    {
        if (taskTypeIds.Count == 0)
            return [];

        var rows = await db.Set<FormDefinition>().AsNoTracking()
            .Where(d => d.Scope == FormOwnerKind.TaskType && d.TaskTypeId != null && taskTypeIds.Contains(d.TaskTypeId.Value))
            .Select(d => new
            {
                TaskTypeId = d.TaskTypeId!.Value,
                DefinitionId = d.Id,
                PublishedId = d.Versions.Where(v => v.Status == FormVersionStatus.Published).Select(v => (int?)v.Id).FirstOrDefault(),
                PublishedNo = d.Versions.Where(v => v.Status == FormVersionStatus.Published).Select(v => (int?)v.VersionNo).FirstOrDefault(),
                DraftNo = d.Versions.Where(v => v.Status == FormVersionStatus.Draft).Select(v => (int?)v.VersionNo).FirstOrDefault(),
                AnyRetired = d.Versions.Any(v => v.Status == FormVersionStatus.Retired),
                HasFields = d.Versions.Any(v => v.Fields.Any()),
            })
            .ToListAsync(ct);
        return rows.ToDictionary(r => r.TaskTypeId, r => new FormFacts(r.DefinitionId, r.PublishedId, r.PublishedNo, r.DraftNo, r.AnyRetired, r.HasFields));
    }

    // ---- commands

    public async Task<Result<TaskTypeView>> CreateAsync(CreateTaskTypeRequest request, CancellationToken ct = default)
    {
        var name = LookupSupport.CleanText(request.Name, "name", "Enter a name.", 100);
        if (name.IsFailure)
            return name.Error!;
        var description = CleanDescription(request.Description);
        if (description.IsFailure)
            return description.Error!;
        var workflows = CheckWorkflows(request.EligibleWorkflowIds ?? [], request.DefaultWorkflowDefinitionId);
        if (workflows.IsFailure)
            return workflows.Error!;
        var icon = CheckIcon(request.IconKey, allowOmitted: true);
        if (icon.IsFailure)
            return icon.Error!;
        if (await NameExistsAsync(name.Value, null, ct))
            return Duplicate(name.Value);

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var taskType = new TaskType
        {
            Name = name.Value,
            Description = description.Value,
            IsActive = request.IsActive,
            IconKey = icon.Value,
            DefaultWorkflowDefinitionId = request.DefaultWorkflowDefinitionId,
        };
        foreach (var workflowId in workflows.Value)
            taskType.EligibleWorkflows.Add(new TaskTypeWorkflowEligibility { WorkflowDefinitionId = workflowId, CreatedByUserId = currentUser.UserId });
        db.Set<TaskType>().Add(taskType);
        if (workflows.Value.Count > 0)
            WriteWorkflowsChanged(taskType, null, workflows.Value);

        var failure = await LookupSupport.SaveAsync(db, Duplicate(name.Value), null, ct);
        if (failure is not null)
            return failure;

        var form = await forms.EnsureDefinitionAsync(FormOwnerKind.TaskType, taskType.Id, ct);
        if (form.IsFailure)
            return form.Error!;
        await tx.CommitAsync(ct);
        return (await GetViewAsync(taskType.Id, ct)).Value;
    }

    public async Task<Result<TaskTypeView>> UpdateAsync(int id, UpdateTaskTypeRequest request, CancellationToken ct = default)
    {
        var version = LookupSupport.ParseRowVersion(request.RowVersion);
        if (version is null)
            return LookupErrors.InvalidRowVersion();
        var name = LookupSupport.CleanText(request.Name, "name", "Enter a name.", 100);
        if (name.IsFailure)
            return name.Error!;
        var description = CleanDescription(request.Description);
        if (description.IsFailure)
            return description.Error!;
        var workflows = CheckWorkflows(request.EligibleWorkflowIds, request.DefaultWorkflowDefinitionId);
        if (workflows.IsFailure)
            return workflows.Error!;
        var icon = CheckIcon(request.IconKey, allowOmitted: false);
        if (icon.IsFailure)
            return icon.Error!;

        var taskType = await db.Set<TaskType>().Include(t => t.EligibleWorkflows).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (taskType is null)
            return Error.NotFound("Task type not found.");
        if (!LookupSupport.VersionMatches(taskType, version))
            return LookupErrors.Concurrency();
        if (await NameExistsAsync(name.Value, id, ct))
            return Duplicate(name.Value);

        taskType.Name = name.Value;
        taskType.Description = description.Value;
        taskType.IsActive = request.IsActive;
        taskType.IconKey = icon.Value;
        taskType.DefaultWorkflowDefinitionId = request.DefaultWorkflowDefinitionId;

        var before = taskType.EligibleWorkflows.Select(e => e.WorkflowDefinitionId).Order().ToList();
        var after = workflows.Value;
        if (!before.SequenceEqual(after))
        {
            foreach (var removed in taskType.EligibleWorkflows.Where(e => !after.Contains(e.WorkflowDefinitionId)).ToList())
                taskType.EligibleWorkflows.Remove(removed);
            foreach (var added in after.Where(w => !before.Contains(w)))
                taskType.EligibleWorkflows.Add(new TaskTypeWorkflowEligibility { TaskTypeId = id, WorkflowDefinitionId = added, CreatedByUserId = currentUser.UserId });
            WriteWorkflowsChanged(taskType, before, after);
            // The eligibility rows are children: touch the parent so its row version moves and concurrent editors conflict.
            taskType.ModifiedAtUtc = clock.UtcNow;
            taskType.ModifiedByUserId = currentUser.UserId;
        }

        LookupSupport.ExpectVersion(db, taskType, version);
        var failure = await LookupSupport.SaveAsync(db, Duplicate(name.Value), null, ct);
        if (failure is not null)
            return failure;

        // Self-heal a Task Type whose form definition was never provisioned.
        var form = await forms.EnsureDefinitionAsync(FormOwnerKind.TaskType, id, ct);
        if (form.IsFailure)
            return form.Error!;
        return (await GetViewAsync(id, ct)).Value;
    }

    // ---- helpers

    private void WriteWorkflowsChanged(TaskType taskType, IReadOnlyList<int>? before, IReadOnlyList<int> after) =>
        audit.Write(new AuditEntry
        {
            EventType = "TASK_TYPE_WORKFLOWS_CHANGED",
            ObjectType = ObjectType,
            ObjectIdFactory = () => taskType.Id.ToString(CultureInfo.InvariantCulture),
            FieldKey = "eligibleWorkflows",
            OldValue = before is null ? null : string.Join(", ", before),
            NewValue = string.Join(", ", after),
            Summary = $"Eligible workflows of {taskType.Name}: {(after.Count == 0 ? "none" : string.Join(", ", after))}",
        });

    private static Result<string?> CleanDescription(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
            return Result<string?>.Success(null);
        return text.Length > 1000 ? LookupErrors.TooLong("description", "Use at most 1000 characters.") : Result<string?>.Success(text);
    }

    /// <summary>The icon must be one of the library keys. Omitted on create means the default icon; never accepted blank or free text.</summary>
    private static Result<string> CheckIcon(string? key, bool allowOmitted)
    {
        if (key is null && allowOmitted)
            return Result<string>.Success(TaskTypeIcons.DefaultKey);
        if (string.IsNullOrWhiteSpace(key))
            return Error.Validation("iconKey", "REQUIRED", "Choose an icon.");
        return TaskTypeIcons.IsValid(key)
            ? Result<string>.Success(key)
            : Error.Validation("iconKey", "UNKNOWN_ICON", "Choose an icon from the library.");
    }

    /// <summary>Distinct ascending workflow ids; the default must be among them (erd.md: application check).</summary>
    private static Result<IReadOnlyList<int>> CheckWorkflows(IReadOnlyList<int> ids, int? defaultId)
    {
        if (ids.Any(i => i <= 0))
            return Error.Validation("eligibleWorkflowIds", "INVALID", "Workflow ids must be positive numbers.");
        var distinct = ids.Distinct().Order().ToList();
        if (defaultId is not null && !distinct.Contains(defaultId.Value))
        {
            return Error.Validation(
                "defaultWorkflowDefinitionId",
                "NOT_ELIGIBLE",
                "The default workflow must be one of the eligible workflows.");
        }

        return Result<IReadOnlyList<int>>.Success(distinct);
    }

    private static Error Duplicate(string name) => LookupErrors.Duplicate("name", $"A task type named '{name}' already exists.");

    private Task<bool> NameExistsAsync(string name, int? exceptId, CancellationToken ct) =>
        db.Set<TaskType>().AnyAsync(t => t.Name == name && (exceptId == null || t.Id != exceptId), ct);
}
