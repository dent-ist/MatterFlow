using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text.Json;
using LptHub.Audit.Contracts;
using LptHub.Configuration.Application.Lookups;
using LptHub.Configuration.Domain;
using LptHub.Identity.Contracts;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Tasks;
using LptHub.SharedKernel.Time;
using LptHub.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LptHub.Configuration.Application.TaskTypes;

/// <summary>The three role lists of a Task Type as the Task Types list and detail carry them (to <c>TaskType.Manage</c> holders only).</summary>
/// <param name="IsRestricted">True when Can View has at least one role; false = the type is open to everyone.</param>
/// <param name="CanView">Role ids that may see tasks of the type, ascending.</param>
/// <param name="CanEdit">Role ids that may change tasks of the type, ascending; empty = no extra limit among those who can view.</param>
/// <param name="CanAssign">Role ids whose people may be assignee, ascending; empty = no extra limit among those who can view.</param>
public sealed record TaskTypeAccessLists(
    [property: Required] bool IsRestricted,
    [property: Required] IReadOnlyList<int> CanView,
    [property: Required] IReadOnlyList<int> CanEdit,
    [property: Required] IReadOnlyList<int> CanAssign);

/// <summary>A role named in a Task Type access list, with its name for the dialog.</summary>
/// <param name="RoleId">Role id.</param>
/// <param name="Name">Role name.</param>
/// <param name="IsActive">False = deactivated; a deactivated role grants nothing (the type stays restricted: fail closed).</param>
public sealed record TaskTypeAccessRole(
    [property: Required] int RoleId,
    [property: Required] string Name,
    [property: Required] bool IsActive);

/// <summary>The access lists of one Task Type with the roles they name, the go-live state and the version to send back on save.</summary>
/// <param name="TaskTypeId">Task Type id.</param>
/// <param name="IsRestricted">True when Can View has at least one role.</param>
/// <param name="CanView">Role ids that may see tasks of the type, ascending.</param>
/// <param name="CanEdit">Role ids that may change tasks of the type, ascending; empty = no extra limit among those who can view.</param>
/// <param name="CanAssign">Role ids whose people may be assignee, ascending; empty = no extra limit among those who can view.</param>
/// <param name="Roles">Every role named in one of the lists (id, name, active flag), by name.</param>
/// <param name="Enforced">
/// The go-live switch <c>Features:TaskTypeAccess</c>. False = the lists are stored but nothing is enforced yet (every person sees and may change every type, as today);
/// the administrator can prepare the lists before go-live.
/// </param>
/// <param name="RowVersion">Optimistic-concurrency token of the Task Type (base64); send it back on save.</param>
public sealed record TaskTypeAccessView(
    [property: Required] int TaskTypeId,
    [property: Required] bool IsRestricted,
    [property: Required] IReadOnlyList<int> CanView,
    [property: Required] IReadOnlyList<int> CanEdit,
    [property: Required] IReadOnlyList<int> CanAssign,
    [property: Required] IReadOnlyList<TaskTypeAccessRole> Roles,
    [property: Required] bool Enforced,
    [property: Required] string RowVersion);

/// <summary>
/// Body to replace the access lists of a Task Type as a set. Every role in <c>canEdit</c> or <c>canAssign</c> is added to <c>canView</c> by the server when it is
/// missing (Edit and Assign imply View). All three lists empty opens the type to everyone.
/// </summary>
/// <param name="CanView">Role ids that may see tasks of the type.</param>
/// <param name="CanEdit">Role ids that may change tasks of the type; empty = no extra limit among those who can view.</param>
/// <param name="CanAssign">Role ids whose people may be assignee; empty = no extra limit among those who can view.</param>
/// <param name="RowVersion">The Task Type's row version the client saw.</param>
public sealed record ReplaceTaskTypeAccessRequest(
    [Required] IReadOnlyList<int> CanView,
    [Required] IReadOnlyList<int> CanEdit,
    [Required] IReadOnlyList<int> CanAssign,
    [Required] string RowVersion);

/// <summary>Body to ask what a proposed set of lists would do, before saving it. Same lists as <see cref="ReplaceTaskTypeAccessRequest"/>; nothing is changed.</summary>
/// <param name="CanView">Role ids that may see tasks of the type.</param>
/// <param name="CanEdit">Role ids that may change tasks of the type.</param>
/// <param name="CanAssign">Role ids whose people may be assignee.</param>
public sealed record PreviewTaskTypeAccessRequest(
    [Required] IReadOnlyList<int> CanView,
    [Required] IReadOnlyList<int> CanEdit,
    [Required] IReadOnlyList<int> CanAssign);

/// <summary>What saving the proposed lists would do (counts only: no names, no ids). Advisory; saving does not require a preview.</summary>
/// <param name="IsRestricted">Whether the type would be restricted afterwards (Can View not empty).</param>
/// <param name="BecomesOpenToEveryone">True when the type is restricted now and the proposal empties Can View ("This task type will become visible to everyone").</param>
/// <param name="OpenTasksBecomingHidden">Open tasks of the type (every task, not only the ones the caller sees) that at least one person would no longer see.</param>
/// <param name="PeopleLosingView">Active people holding Task.View who may see the type now and would not afterwards.</param>
/// <param name="OpenTasksAssignedToPeopleLosingView">Open tasks of the type assigned to one of those people (they stay assigned; the administrator may reassign first).</param>
/// <param name="PeopleLosingEdit">Active people holding Task.View who may change tasks of the type now and would not afterwards (people who lose view count here too).</param>
/// <param name="CallerLosesView">True when the caller would no longer see the type ("You will no longer see this task type"). System Admin never does.</param>
public sealed record TaskTypeAccessPreview(
    [property: Required] bool IsRestricted,
    [property: Required] bool BecomesOpenToEveryone,
    [property: Required] int OpenTasksBecomingHidden,
    [property: Required] int PeopleLosingView,
    [property: Required] int OpenTasksAssignedToPeopleLosingView,
    [property: Required] int PeopleLosingEdit,
    [property: Required] bool CallerLosesView);

/// <summary>
/// The role lists of a Task Type (epic #1397, issue #1399): read, replace as a set, preview, and the "which Task Types use this role" probe behind the role-delete block.
/// This is the ONE writer of <c>dbo.TaskTypeRoleAccess</c> and of <c>TaskType.IsRestricted</c>; both change in one transaction (one SaveChanges), together with the audit events.
/// <para>
/// Go-live switch: the lists can be edited and stored whether or not <c>Features:TaskTypeAccess</c> is on. While it is off nothing is enforced (issue #1400 reads the switch in the
/// visibility port and #1401 in the edit and assign rules); the admin views report it as <c>enforced</c>. Empty Can Edit or Can Be Assigned means "no extra limit" (design section 1.1).
/// </para>
/// </summary>
public sealed class TaskTypeAccessService(
    DbContext db,
    IRoleDirectory roles,
    IAuditWriter audit,
    IClock clock,
    ICurrentUser currentUser,
    ITaskTypeAccessImpact impact,
    IOptions<TaskTypeAccessOptions> options) : ITaskTypeRoleUsage
{
    private const string ObjectType = "TaskType";

    /// <summary>The go-live switch (<c>Features:TaskTypeAccess</c>), read once at start.</summary>
    public bool Enforced => options.Value.TaskTypeAccess;

    // ---- read side

    /// <summary>The lists of the given Task Types (types without a row are open: empty lists). One statement for any number of ids.</summary>
    public async Task<IReadOnlyDictionary<int, TaskTypeAccessLists>> ListsForAsync(IReadOnlyCollection<int> taskTypeIds, CancellationToken ct = default)
    {
        if (taskTypeIds.Count == 0)
            return new Dictionary<int, TaskTypeAccessLists>();

        var ids = taskTypeIds.Distinct().ToList();
        var rows = await db.Set<TaskTypeRoleAccess>().AsNoTracking().Where(a => ids.Contains(a.TaskTypeId)).ToListAsync(ct);
        return ids.ToDictionary(id => id, id => ToLists(rows.Where(r => r.TaskTypeId == id).ToList()));
    }

    public async Task<Result<TaskTypeAccessView>> GetAsync(int taskTypeId, CancellationToken ct = default)
    {
        var taskType = await db.Set<TaskType>().AsNoTracking().FirstOrDefaultAsync(t => t.Id == taskTypeId, ct);
        if (taskType is null)
            return Error.NotFound("Task type not found.");
        return await ToViewAsync(taskType, ct);
    }

    // ---- commands

    /// <summary>
    /// Replaces the three lists. 400 on the list field: <c>ROLE_NOT_FOUND</c> (unknown role, or a deactivated role that is not already in a list), <c>DUPLICATE_ROLE</c>
    /// (the same id twice in one list), <c>INVALID</c> (not a positive id). 409 <c>CONCURRENCY_CONFLICT</c> when the Task Type changed since the client read it.
    /// Saving the lists a type already has changes nothing and writes no event.
    /// </summary>
    public async Task<Result<TaskTypeAccessView>> ReplaceAsync(int taskTypeId, ReplaceTaskTypeAccessRequest request, CancellationToken ct = default)
    {
        var version = LookupSupport.ParseRowVersion(request.RowVersion);
        if (version is null)
            return LookupErrors.InvalidRowVersion();

        var taskType = await db.Set<TaskType>().FirstOrDefaultAsync(t => t.Id == taskTypeId, ct);
        if (taskType is null)
            return Error.NotFound("Task type not found.");
        if (!LookupSupport.VersionMatches(taskType, version))
            return LookupErrors.Concurrency();

        var existing = await db.Set<TaskTypeRoleAccess>().Where(a => a.TaskTypeId == taskTypeId).ToListAsync(ct);
        var before = ToLists(existing);
        var proposed = await NormaliseAsync(request.CanView, request.CanEdit, request.CanAssign, before, ct);
        if (proposed.IsFailure)
            return proposed.Error!;

        var after = proposed.Value;
        if (SameLists(before, after))
            return await ToViewAsync(taskType, ct);

        // Replace as a set: update the rows that stay, delete the ones that go, add the new ones.
        var wanted = after.Rows;
        foreach (var row in existing.ToList())
        {
            if (!wanted.TryGetValue(row.RoleId, out var flags))
            {
                db.Set<TaskTypeRoleAccess>().Remove(row);
                continue;
            }

            row.CanView = flags.View;
            row.CanEdit = flags.Edit;
            row.CanAssign = flags.Assign;
        }

        foreach (var (roleId, flags) in wanted.Where(w => existing.All(e => e.RoleId != w.Key)))
        {
            db.Set<TaskTypeRoleAccess>().Add(new TaskTypeRoleAccess
            {
                TaskTypeId = taskTypeId,
                RoleId = roleId,
                CanView = flags.View,
                CanEdit = flags.Edit,
                CanAssign = flags.Assign,
                CreatedByUserId = currentUser.UserId,
            });
        }

        var wasRestricted = taskType.IsRestricted;
        var nowRestricted = after.CanView.Count > 0;
        taskType.IsRestricted = nowRestricted;
        // The access rows are children of the Task Type: touch the parent so its row version moves and concurrent editors conflict.
        taskType.ModifiedAtUtc = clock.UtcNow;
        taskType.ModifiedByUserId = currentUser.UserId;
        LookupSupport.ExpectVersion(db, taskType, version);

        var names = await roles.FindManyAsync([.. before.CanView.Union(before.CanEdit).Union(before.CanAssign).Union(after.CanView).Union(after.CanEdit).Union(after.CanAssign)], ct);
        WriteAccessChanged(taskType, before, after, names);
        if (wasRestricted != nowRestricted)
            WriteFlagFlipped(taskType, nowRestricted);

        // A concurrent save of the same Task Type loses on the row version (or on the primary key of a row both added): both are the same conflict for the client.
        var failure = await LookupSupport.SaveAsync(db, LookupErrors.Concurrency(), null, ct);
        if (failure is not null)
            return failure;
        return await GetAsync(taskTypeId, ct);
    }

    /// <summary>What saving the proposed lists would do. Validates and normalises like the save; changes nothing.</summary>
    public async Task<Result<TaskTypeAccessPreview>> PreviewAsync(int taskTypeId, PreviewTaskTypeAccessRequest request, CancellationToken ct = default)
    {
        var taskType = await db.Set<TaskType>().AsNoTracking().FirstOrDefaultAsync(t => t.Id == taskTypeId, ct);
        if (taskType is null)
            return Error.NotFound("Task type not found.");

        var existing = await db.Set<TaskTypeRoleAccess>().AsNoTracking().Where(a => a.TaskTypeId == taskTypeId).ToListAsync(ct);
        var before = ToLists(existing);
        var proposed = await NormaliseAsync(request.CanView, request.CanEdit, request.CanAssign, before, ct);
        if (proposed.IsFailure)
            return proposed.Error!;

        var after = proposed.Value;
        var numbers = await impact.PreviewAsync(
            taskTypeId,
            new TaskTypeAccessSets(before.CanView, before.CanEdit, before.CanAssign),
            new TaskTypeAccessSets(after.CanView, after.CanEdit, after.CanAssign),
            currentUser.UserId,
            ct);
        return new TaskTypeAccessPreview(
            after.CanView.Count > 0,
            before.CanView.Count > 0 && after.CanView.Count == 0,
            numbers.OpenTasksBecomingHidden,
            numbers.PeopleLosingView,
            numbers.OpenTasksAssignedToPeopleLosingView,
            numbers.PeopleLosingEdit,
            numbers.CallerLosesView);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<string>> TaskTypeNamesUsingRoleAsync(int roleId, CancellationToken cancellationToken = default) =>
        await (from a in db.Set<TaskTypeRoleAccess>().AsNoTracking()
               join t in db.Set<TaskType>().AsNoTracking() on a.TaskTypeId equals t.Id
               where a.RoleId == roleId
               orderby t.Name
               select t.Name)
            .ToListAsync(cancellationToken);

    // ---- helpers

    /// <summary>The lists after validation and normalisation: ascending distinct ids, View includes every Edit and Assign role, plus the per-role flags.</summary>
    private sealed record Normalised(IReadOnlyList<int> CanView, IReadOnlyList<int> CanEdit, IReadOnlyList<int> CanAssign)
    {
        public Dictionary<int, (bool View, bool Edit, bool Assign)> Rows =>
            CanView.ToDictionary(id => id, id => (true, CanEdit.Contains(id), CanAssign.Contains(id)));
    }

    private async Task<Result<Normalised>> NormaliseAsync(IReadOnlyList<int> canView, IReadOnlyList<int> canEdit, IReadOnlyList<int> canAssign, TaskTypeAccessLists current, CancellationToken ct)
    {
        var lists = new[] { ("canView", canView), ("canEdit", canEdit), ("canAssign", canAssign) };
        foreach (var (field, ids) in lists)
        {
            if (ids is null)
                return Error.Validation(field, "REQUIRED", "Send the list of role ids (it may be empty).");
            if (ids.Any(i => i <= 0))
                return Error.Validation(field, "INVALID", "Role ids must be positive numbers.");
            if (ids.Distinct().Count() != ids.Count)
                return Error.Validation(field, ErrorCodes.DuplicateRole, "A role can be in a list only once.");
        }

        var all = canView.Union(canEdit).Union(canAssign).ToList();
        var found = await roles.FindManyAsync(all, ct);
        var alreadyListed = current.CanView.Union(current.CanEdit).Union(current.CanAssign).ToHashSet();
        foreach (var (field, ids) in lists)
        {
            foreach (var id in ids)
            {
                if (!found.TryGetValue(id, out var role))
                    return Error.Validation(field, ErrorCodes.RoleNotFound, "Choose a role from the list.");
                // A role that is deactivated today may not be added; one that is already in a list may stay (the administrator can still save other changes; the screen warns).
                if (!role.IsActive && !alreadyListed.Contains(id))
                    return Error.Validation(field, ErrorCodes.RoleNotFound, $"The role '{role.Name}' is deactivated. Choose an active role.");
            }
        }

        // Edit and Assign imply View. With no View role the type is open and Edit and Assign roles cannot exist: they are added to View, so the type becomes restricted by them.
        var view = canView.Union(canEdit).Union(canAssign).Order().ToList();
        return new Normalised(view, [.. canEdit.Order()], [.. canAssign.Order()]);
    }

    private static bool SameLists(TaskTypeAccessLists before, Normalised after) =>
        before.CanView.SequenceEqual(after.CanView) && before.CanEdit.SequenceEqual(after.CanEdit) && before.CanAssign.SequenceEqual(after.CanAssign);

    private static TaskTypeAccessLists ToLists(IReadOnlyCollection<TaskTypeRoleAccess> rows) =>
        new(
            rows.Any(r => r.CanView),
            [.. rows.Where(r => r.CanView).Select(r => r.RoleId).Order()],
            [.. rows.Where(r => r.CanEdit).Select(r => r.RoleId).Order()],
            [.. rows.Where(r => r.CanAssign).Select(r => r.RoleId).Order()]);

    private async Task<TaskTypeAccessView> ToViewAsync(TaskType taskType, CancellationToken ct)
    {
        var rows = await db.Set<TaskTypeRoleAccess>().AsNoTracking().Where(a => a.TaskTypeId == taskType.Id).ToListAsync(ct);
        var lists = ToLists(rows);
        var named = await roles.FindManyAsync([.. rows.Select(r => r.RoleId)], ct);
        return new TaskTypeAccessView(
            taskType.Id,
            lists.IsRestricted,
            lists.CanView,
            lists.CanEdit,
            lists.CanAssign,
            [.. named.Values.OrderBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase).ThenBy(r => r.RoleId).Select(r => new TaskTypeAccessRole(r.RoleId, r.Name, r.IsActive))],
            Enforced,
            LookupSupport.FormatRowVersion(taskType.RowVersion));
    }

    private void WriteAccessChanged(TaskType taskType, TaskTypeAccessLists before, Normalised after, IReadOnlyDictionary<int, RoleInfo> names)
    {
        string Name(int id) => names.TryGetValue(id, out var r) ? r.Name : $"#{id.ToString(CultureInfo.InvariantCulture)}";
        string Text(IReadOnlyCollection<int> ids, string empty) => ids.Count == 0 ? empty : string.Join(", ", ids.Select(Name).Order(StringComparer.CurrentCultureIgnoreCase));

        // Old and new value hold the three lists as role names together with the role ids, so a later rename of a role does not rewrite history.
        object Snapshot(IReadOnlyCollection<int> view, IReadOnlyCollection<int> edit, IReadOnlyCollection<int> assign) => new
        {
            canView = view.Select(id => new { roleId = id, name = Name(id) }),
            canEdit = edit.Select(id => new { roleId = id, name = Name(id) }),
            canAssign = assign.Select(id => new { roleId = id, name = Name(id) }),
        };

        var changes = new List<string>();
        void Describe(string label, IReadOnlyList<int> was, IReadOnlyList<int> now, string empty)
        {
            if (!was.SequenceEqual(now))
                changes.Add($"{label} changed from {Text(was, empty)} to {Text(now, empty)}");
        }

        Describe("Can View", before.CanView, after.CanView, "(everyone)");
        Describe("Can Edit", before.CanEdit, after.CanEdit, "(no extra limit)");
        Describe("Can Be Assigned", before.CanAssign, after.CanAssign, "(no extra limit)");
        var summary = $"Task Type '{taskType.Name}': {string.Join("; ", changes)}";
        audit.Write(new AuditEntry
        {
            EventType = "TASK_TYPE_ACCESS_CHANGED",
            ObjectType = ObjectType,
            ObjectIdFactory = () => taskType.Id.ToString(CultureInfo.InvariantCulture),
            FieldKey = "access",
            OldValue = JsonSerializer.Serialize(Snapshot(before.CanView, before.CanEdit, before.CanAssign)),
            NewValue = JsonSerializer.Serialize(Snapshot(after.CanView, after.CanEdit, after.CanAssign)),
            Summary = summary.Length <= 500 ? summary : summary[..497] + "...",
        });
    }

    /// <summary>The extra row when the restriction flag flips: easy to find on the audit page and in the runbook.</summary>
    private void WriteFlagFlipped(TaskType taskType, bool restricted) =>
        audit.Write(new AuditEntry
        {
            EventType = restricted ? "TASK_TYPE_RESTRICTED" : "TASK_TYPE_UNRESTRICTED",
            ObjectType = ObjectType,
            ObjectIdFactory = () => taskType.Id.ToString(CultureInfo.InvariantCulture),
            FieldKey = "isRestricted",
            OldValue = restricted ? "false" : "true",
            NewValue = restricted ? "true" : "false",
            Summary = restricted ? $"Task Type '{taskType.Name}' is now restricted to the roles in Can View" : $"Task Type '{taskType.Name}' is now visible to everyone",
        });
}
