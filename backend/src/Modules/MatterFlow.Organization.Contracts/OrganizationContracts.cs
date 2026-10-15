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
public sealed record MatterSummary(
    int MatterId,
    int ClientId,
    string ClientNumber,
    string MatterNumber,
    string MatterRef,
    string Name,
    bool IsActive,
    bool IsSensitive,
    bool ClientIsActive);

/// <summary>A Project as other modules see it.</summary>
public sealed record ProjectSummary(int ProjectId, int MatterId, string Name, bool IsActive);

/// <summary>Read-only lookups of Matters for other modules (Tasks, Assets, Search).</summary>
public interface IMatterDirectory
{
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
