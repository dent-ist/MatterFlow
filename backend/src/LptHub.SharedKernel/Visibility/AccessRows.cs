namespace LptHub.SharedKernel.Visibility;

/// <summary>
/// The only columns of a matter the visibility rule needs. The Organization module projects its matters to this shape, so the rule is written once
/// in SharedKernel without any module seeing another module's entity. Classes with initialisers (not positional records) so a query can project to them.
/// </summary>
public sealed class MatterAccessRow
{
    public int MatterId { get; init; }

    public bool IsSensitive { get; init; }

    public int? PrimaryManagerId { get; init; }

    public int? SecondaryManagerId { get; init; }
}

/// <summary>The columns of a task the visibility rule needs: its matter, whether that matter is sensitive, and the person it is currently assigned to.</summary>
public sealed class TaskAccessRow
{
    public long TaskId { get; init; }

    public int MatterId { get; init; }

    public int? AssignedUserId { get; init; }

    /// <summary>The task's copy of its matter's <c>IsSensitive</c> (script 37), for readers that only need to know whether the matter is sensitive.</summary>
    public bool IsMatterSensitive { get; init; }

    /// <summary>The task's type (immutable after creation). The Task Type access rule (epic #1397) hides the task when this type is restricted and the viewer holds none of its Can View roles.</summary>
    public int TaskTypeId { get; init; }
}

/// <summary>The only columns of a Task Type the access rule needs: whether it is restricted (<c>TaskType.IsRestricted</c>).</summary>
public sealed class TaskTypeAccessRow
{
    public int TaskTypeId { get; init; }

    public bool IsRestricted { get; init; }
}

/// <summary>One role of a Task Type's Can View list (rows of <c>dbo.TaskTypeRoleAccess</c> with <c>CanView = 1</c>).</summary>
public sealed class TaskTypeViewRoleRow
{
    public int TaskTypeId { get; init; }

    public int RoleId { get; init; }
}

/// <summary>Every Task Type and its Can View roles, unfiltered. Implemented by the Configuration module; consumed only by the visibility port (Task Type access rule, epic #1397).</summary>
public interface ITaskTypeAccessSource
{
    IQueryable<TaskTypeAccessRow> Types();

    IQueryable<TaskTypeViewRoleRow> ViewRoles();
}

/// <summary>Every matter, unfiltered, as <see cref="MatterAccessRow"/>. Implemented by the Organization module; consumed only by the visibility port.</summary>
public interface IMatterAccessSource
{
    IQueryable<MatterAccessRow> Rows();
}

/// <summary>Every task, unfiltered, as <see cref="TaskAccessRow"/>. Implemented by the WorkManagement module; consumed only by the visibility port.</summary>
public interface ITaskAccessSource
{
    IQueryable<TaskAccessRow> Rows();
}
