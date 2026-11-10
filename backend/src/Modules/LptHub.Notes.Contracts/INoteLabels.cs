namespace MatterFlow.Notes.Contracts;

/// <summary>A note as the audit display names it (its title).</summary>
public sealed record NoteLabel(int Id, int MatterId, string Title);

/// <summary>Titles of notes for the audit browser and the Activities feed. The caller applies the sensitive-matter rule with <c>MatterId</c>.</summary>
public interface INoteLabels
{
    Task<IReadOnlyList<NoteLabel>> NotesAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default);
}
