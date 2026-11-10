using LptHub.Notes.Contracts;
using LptHub.Notes.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Notes.Application;

/// <summary>Internal lookup for other modules (titles only; the caller gates by matter).</summary>
internal sealed class NoteLabels(DbContext db) : INoteLabels
{
    public async Task<IReadOnlyList<NoteLabel>> NotesAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default) =>
        ids.Count == 0
            ? []
            : await db.Set<Note>().AsNoTracking().Where(n => ids.Contains(n.Id)).Select(n => new NoteLabel(n.Id, n.MatterId, n.Title == "" ? NoteContent.UntitledTitle : n.Title)).ToListAsync(cancellationToken);
}
