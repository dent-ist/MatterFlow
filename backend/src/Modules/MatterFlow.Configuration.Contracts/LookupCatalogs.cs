namespace MatterFlow.Configuration.Contracts;

/// <summary>A task priority as other modules see it. Users see the label, never <see cref="SortOrder"/> (UX 4.5).</summary>
/// <param name="Id">Priority id (Task.PriorityId references it).</param>
/// <param name="Label">Display label.</param>
/// <param name="SortOrder">Lower is more urgent; the Task Queue sorts by it.</param>
/// <param name="Color">Badge color: a token (critical, high, normal, low, neutral) or an admin override <c>#RRGGBB</c>.</param>
/// <param name="IsActive">Inactive priorities still display on historical tasks but are not offered for new or changed tasks.</param>
/// <param name="IsDefault">Exactly one active priority is the default for new tasks.</param>
public sealed record PriorityInfo(int Id, string Label, int SortOrder, string Color, bool IsActive, bool IsDefault);

/// <summary>Read access to priorities for other modules (task creation, queue joins, validation).</summary>
public interface IPriorityCatalog
{
    /// <summary>All priorities ordered by <see cref="PriorityInfo.SortOrder"/> (most urgent first).</summary>
    Task<IReadOnlyList<PriorityInfo>> ListAsync(bool includeInactive, CancellationToken cancellationToken = default);

    /// <summary>One priority (active or not), or null when it does not exist.</summary>
    Task<PriorityInfo?> GetAsync(int priorityId, CancellationToken cancellationToken = default);

    /// <summary>The default priority for new tasks. Always exists once the module seed ran.</summary>
    Task<PriorityInfo> GetDefaultAsync(CancellationToken cancellationToken = default);

    /// <summary>True when the priority exists and is active, so it may be set on a new or changed task.</summary>
    Task<bool> IsAssignableAsync(int priorityId, CancellationToken cancellationToken = default);
}

/// <summary>
/// Implemented by the module that owns tasks, so the Configuration module can refuse to delete a priority that tasks reference
/// (it can then only be deactivated). Registered as a service; the foreign key from Task is the backstop.
/// </summary>
public interface IPriorityUsage
{
    Task<bool> IsInUseAsync(int priorityId, CancellationToken cancellationToken = default);
}

/// <summary>The five fixed internal lifecycle codes. They never change; only their display labels are configurable.</summary>
public static class TaskStatusCodes
{
    public const string New = "NEW";
    public const string InProgress = "IN_PROGRESS";
    public const string OnHold = "ON_HOLD";
    public const string Completed = "COMPLETED";
    public const string Cancelled = "CANCELLED";

    /// <summary>All codes in lifecycle order.</summary>
    public static IReadOnlyList<string> All { get; } = [New, InProgress, OnHold, Completed, Cancelled];
}

/// <summary>A lifecycle status code with its configurable display label.</summary>
public sealed record StatusLabelInfo(string Code, string DisplayLabel, int SortOrder);

/// <summary>Read access to the status display labels for other modules.</summary>
public interface IStatusLabelCatalog
{
    /// <summary>The five labels in lifecycle order.</summary>
    Task<IReadOnlyList<StatusLabelInfo>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>The display label of a status code, or the code itself when unknown.</summary>
    Task<string> GetLabelAsync(string statusCode, CancellationToken cancellationToken = default);
}

/// <summary>A Task-to-Asset link role (Source, Destination, Subject, Result, ...).</summary>
public sealed record AssetLinkRoleInfo(int Id, string Name, int SortOrder, bool IsActive);

/// <summary>Read access to asset link roles for other modules (linking assets to tasks).</summary>
public interface IAssetLinkRoleCatalog
{
    Task<IReadOnlyList<AssetLinkRoleInfo>> ListAsync(bool includeInactive, CancellationToken cancellationToken = default);

    /// <summary>True when the role exists and is active, so it may be used on a new link.</summary>
    Task<bool> IsAssignableAsync(int assetLinkRoleId, CancellationToken cancellationToken = default);
}

/// <summary>Implemented by the module that owns task-asset links, so a link role in use can only be deactivated, not deleted.</summary>
public interface IAssetLinkRoleUsage
{
    Task<bool> IsInUseAsync(int assetLinkRoleId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The number of links that use each role (#639), in one grouped statement. Roles no link uses are absent (a missing key means 0). The default
    /// counts nothing, so an implementation written before this member keeps working.
    /// </summary>
    Task<IReadOnlyDictionary<int, int>> CountLinksAsync(IReadOnlyCollection<int> assetLinkRoleIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, int>>(new Dictionary<int, int>());
}
