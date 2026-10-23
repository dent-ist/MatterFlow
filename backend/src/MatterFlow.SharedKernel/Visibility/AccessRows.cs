namespace MatterFlow.SharedKernel.Visibility;

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

/// <summary>The columns of a task the visibility rule needs: its matter and the person it is currently assigned to.</summary>
public sealed class TaskAccessRow
{
    public long TaskId { get; init; }

    public int MatterId { get; init; }

    public int? AssignedUserId { get; init; }
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
