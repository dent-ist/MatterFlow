namespace MatterFlow.Organization.Contracts;

/// <summary>A Matter as other modules see it (display reference, state flags and its Client).</summary>
/// <param name="MatterId">Internal id.</param>
/// <param name="ClientId">Owning Client id.</param>
/// <param name="ClientNumber">Normalized Client number, for example <c>00343</c>.</param>
/// <param name="MatterNumber">Normalized Matter number, for example <c>00012</c>.</param>
/// <param name="MatterRef">Combined display reference <c>00343-00012</c>.</param>
/// <param name="Name">Matter name.</param>
/// <param name="IsActive">Tasks can be created only on an active Matter.</param>
/// <param name="IsSensitive">Display-only sensitivity flag (addendum O).</param>
/// <param name="ClientIsActive">False when the owning Client is inactive.</param>
/// <param name="PrimaryManagerId">The Primary project manager (epic #667), or null.</param>
/// <param name="SecondaryManagerId">The Secondary project manager, or null.</param>
public sealed record MatterSummary(
    int MatterId,
    int ClientId,
    string ClientNumber,
    string MatterNumber,
    string MatterRef,
    string Name,
    bool IsActive,
    bool IsSensitive,
    bool ClientIsActive,
    int? PrimaryManagerId = null,
    int? SecondaryManagerId = null);

/// <summary>A Project as other modules see it.</summary>
public sealed record ProjectSummary(int ProjectId, int MatterId, string Name, bool IsActive);

/// <summary>The Matter reference a list sorts by (see <see cref="IMatterDirectory.SortKeys"/>). A class with initialisers, not a positional record, so a query can join it.</summary>
public sealed class MatterSortKey
{
    /// <summary>The Matter id.</summary>
    public int MatterId { get; init; }

    /// <summary>The padded reference, <c>00343-00012</c>, which sorts as text in the order a person reads it.</summary>
    public string MatterRef { get; init; } = string.Empty;
}

/// <summary>Read-only lookups of Matters for other modules (Tasks, Assets, Search).</summary>
public interface IMatterDirectory
{
    /// <summary>The Matter reference of every Matter, as a query a list of another module can join to sort by it (the Assets list sorts by Matter).</summary>
    IQueryable<MatterSortKey> SortKeys();

    /// <summary>The Matter with the given id, or null.</summary>
    Task<MatterSummary?> FindAsync(int matterId, CancellationToken cancellationToken = default);

    /// <summary>Resolves <c>343-12</c> or <c>00343-00012</c> (padded or unpadded) to a Matter, or null when the text is not a pair or no Matter has it.</summary>
    Task<MatterSummary?> ResolveReferenceAsync(string reference, CancellationToken cancellationToken = default);

    /// <summary>
    /// Ids of the Matters whose reference (<c>00343-00012</c>, or the typed pair <c>343-12</c>) or name contains the text, case-insensitively and
    /// with the LIKE wildcards matched literally; at most <paramref name="limit"/> ids, lowest id first. Column filters of other modules' lists use it.
    /// </summary>
    Task<IReadOnlyList<int>> FindIdsMatchingAsync(string text, int limit, CancellationToken cancellationToken = default);
}

/// <summary>Read-only lookups of Projects for other modules.</summary>
public interface IProjectDirectory
{
    /// <summary>The Project with the given id, or null.</summary>
    Task<ProjectSummary?> FindAsync(int projectId, CancellationToken cancellationToken = default);
}

/// <summary>
/// Answers whether a Matter still has work in progress, so the Organization module can enforce
/// "a Matter can be set inactive only when all its Tasks are Completed or Cancelled" (addendum B) without knowing the Task table.
/// The Tasks module replaces the default registration (<see cref="NoTasksMatterTaskGuard"/>) with a real implementation.
/// </summary>
public interface IMatterTaskGuard
{
    /// <summary>Number of the Matter's Tasks that are not Completed or Cancelled (New, In Progress, On Hold).</summary>
    Task<int> CountOpenTasksAsync(int matterId, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IMatterTaskGuard"/> until the Tasks module exists: no Matter has open Tasks.</summary>
public sealed class NoTasksMatterTaskGuard : IMatterTaskGuard
{
    public Task<int> CountOpenTasksAsync(int matterId, CancellationToken cancellationToken = default) => Task.FromResult(0);
}

/// <summary>Which record the Task counts are grouped by.</summary>
public enum TaskCountScope
{
    /// <summary>All Tasks of all the Client's Matters (project Tasks included).</summary>
    Client,

    /// <summary>All Tasks of the Matter (project Tasks included).</summary>
    Matter,

    /// <summary>The Tasks of the Project.</summary>
    Project,
}

/// <summary>Open and overdue Task counts of one Client, Matter or Project (a record with no open Task has no row).</summary>
public sealed class TaskCountRow
{
    /// <summary>The Client, Matter or Project id, depending on the <see cref="TaskCountScope"/>.</summary>
    public int Key { get; init; }

    /// <summary>Tasks that are New, In Progress or On Hold.</summary>
    public int Open { get; init; }

    /// <summary>Open Tasks whose due moment has passed for the viewer.</summary>
    public int Overdue { get; init; }
}

/// <summary>The five numbers of a summary strip, in the Dashboard and Task Queue vocabulary and in the viewer's time zone.</summary>
/// <param name="Open">Tasks that are New, In Progress or On Hold.</param>
/// <param name="Overdue">Open Tasks past their due moment.</param>
/// <param name="Asap">Open Tasks with no due date.</param>
/// <param name="OnHold">Tasks On Hold.</param>
/// <param name="DueSoon">Open, not overdue, with a due date today to two days ahead.</param>
/// <param name="Unassigned">Open Tasks with no person assigned (a Pod may be set); the Task Queue's <c>unassigned=true</c>.</param>
public sealed record TaskStripCounts(int Open, int Overdue, int Asap, int OnHold, int DueSoon, int Unassigned = 0);

/// <summary>One Matter of a Client with its open and overdue Task counts.</summary>
public sealed record MatterTaskCount(int MatterId, int Open, int Overdue);

/// <summary>
/// The one definition of the Task counts shown on the Client, Matter and Project lists and summaries. The Organization module cannot see the Task table,
/// so the WorkViews module implements this with the same predicates as the Dashboard and the Task Queue (<c>TaskQueueRules</c>). Counts are for the
/// viewer's time zone and never apply a permission: the caller checks <c>Task.View</c> first.
/// </summary>
public interface IOrganizationTaskCounts
{
    /// <summary>
    /// Open and overdue counts grouped by key, as a query so a list can join it and sort by it. One row per key that has at least one open Task;
    /// a missing row means 0.
    /// </summary>
    IQueryable<TaskCountRow> Grouped(TaskCountScope scope);

    /// <summary>The counts of the given keys (a page of ids) in one grouped statement; keys with no open Task are absent.</summary>
    Task<IReadOnlyDictionary<int, TaskCountRow>> ForKeysAsync(TaskCountScope scope, IReadOnlyCollection<int> keys, CancellationToken cancellationToken = default);

    /// <summary>The five strip numbers of one record, computed in one statement.</summary>
    Task<TaskStripCounts> StripAsync(TaskCountScope scope, int key, CancellationToken cancellationToken = default);

    /// <summary>The Client's Matters with open Tasks, most open first, then most overdue, then by reference; at most <paramref name="take"/>.</summary>
    Task<IReadOnlyList<MatterTaskCount>> TopMattersAsync(int clientId, int take, CancellationToken cancellationToken = default);
}

/// <summary>
/// Counts a Matter's Assets for the Matter summary without the Organization module knowing the Asset table. The Assets module replaces the default
/// registration (<see cref="NoAssetsMatterAssetCounts"/>).
/// </summary>
public interface IMatterAssetCounts
{
    /// <summary>All Assets of the Matter, active and retired (the Assets tab lists both).</summary>
    Task<int> CountAsync(int matterId, CancellationToken cancellationToken = default);
}

/// <summary>Default <see cref="IMatterAssetCounts"/> until the Assets module registers the real one: no Assets.</summary>
public sealed class NoAssetsMatterAssetCounts : IMatterAssetCounts
{
    public Task<int> CountAsync(int matterId, CancellationToken cancellationToken = default) => Task.FromResult(0);
}

/// <summary>
/// Default <see cref="IOrganizationTaskCounts"/> until the WorkViews module registers the real one: no Task is counted.
/// </summary>
public sealed class NoTasksOrganizationTaskCounts : IOrganizationTaskCounts
{
    public IQueryable<TaskCountRow> Grouped(TaskCountScope scope) => Enumerable.Empty<TaskCountRow>().AsQueryable();

    public Task<IReadOnlyDictionary<int, TaskCountRow>> ForKeysAsync(TaskCountScope scope, IReadOnlyCollection<int> keys, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyDictionary<int, TaskCountRow>>(new Dictionary<int, TaskCountRow>());

    public Task<TaskStripCounts> StripAsync(TaskCountScope scope, int key, CancellationToken cancellationToken = default) =>
        Task.FromResult(new TaskStripCounts(0, 0, 0, 0, 0));

    public Task<IReadOnlyList<MatterTaskCount>> TopMattersAsync(int clientId, int take, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<MatterTaskCount>>([]);
}
