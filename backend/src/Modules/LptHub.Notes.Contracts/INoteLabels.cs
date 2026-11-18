namespace LptHub.Notes.Contracts;

/// <summary>A note as the audit display names it (its title).</summary>
public sealed record NoteLabel(int Id, int MatterId, string Title);

/// <summary>A note folder as the audit display names it (its name).</summary>
public sealed record NoteFolderLabel(int Id, int MatterId, string Name);

/// <summary>Titles of notes for the audit browser and the Activities feed. The caller applies the sensitive-matter rule with <c>MatterId</c>.</summary>
public interface INoteLabels
{
    Task<IReadOnlyList<NoteLabel>> NotesAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default);

    /// <summary>Names of note folders (the caller applies the sensitive-matter rule with <c>MatterId</c>). A deleted folder is left out.</summary>
    Task<IReadOnlyList<NoteFolderLabel>> FoldersAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default);
}
