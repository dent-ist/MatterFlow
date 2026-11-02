using System.Linq.Expressions;
using MatterFlow.Identity.Contracts;
using MatterFlow.Notes.Domain;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notes.Application;

/// <summary>
/// The sensitive-matter rule for this module (epic #788, mode M): notes, their links and the matter templates are those of a matter the caller may see, for reads and writes alike.
/// A hidden matter's records do not exist for the caller (404).
/// </summary>
public sealed class NoteAccess(IMatterVisibility visibility, IMatterDirectory matters, IUserDirectory users, DbContext db)
{
    /// <summary>Keeps the rows of the matters the caller may see.</summary>
    public IQueryable<T> Visible<T>(IQueryable<T> source, Expression<Func<T, int>> matterId) => visibility.WhereMatterVisible(source, matterId);

    /// <summary>The matter when it exists and the caller may see it, otherwise null.</summary>
    public async Task<MatterSummary?> FindVisibleMatterAsync(int matterId, CancellationToken ct) =>
        await visibility.CanSeeMatterAsync(matterId, ct) ? await matters.FindAsync(matterId, ct) : null;


    /// <summary>
    /// The record to change, tracked: it must be of a matter the caller may see (otherwise null, the 404). The visibility query is read without tracking (it joins the access rows), so the
    /// record itself is loaded again by its key; changes to an untracked record would be silently lost.
    /// </summary>
    public async Task<T?> FindTrackedAsync<T>(Expression<Func<T, int>> matterId, Expression<Func<T, bool>> where, CancellationToken ct)
        where T : class
    {
        var visible = await Visible(db.Set<T>().AsNoTracking(), matterId).AnyAsync(where, ct);
        return visible ? await db.Set<T>().SingleOrDefaultAsync(where, ct) : null;
    }

    public Task<bool> CanSeeMatterAsync(int matterId, CancellationToken ct) => visibility.CanSeeMatterAsync(matterId, ct);

    /// <summary>Display names of the given users (history keeps the names of inactive users).</summary>
    public async Task<IReadOnlyDictionary<int, string>> NamesAsync(IEnumerable<int?> userIds, CancellationToken ct)
    {
        var ids = userIds.OfType<int>().Distinct().ToList();
        if (ids.Count == 0)
            return new Dictionary<int, string>();

        var found = await users.FindManyAsync(ids, ct);
        return found.ToDictionary(kv => kv.Key, kv => kv.Value.DisplayName);
    }

    /// <summary>The tags of the given notes (or templates), by owner id.</summary>
    public async Task<IReadOnlyDictionary<int, IReadOnlyList<NoteTagRef>>> TagsOfNotesAsync(IReadOnlyCollection<int> noteIds, CancellationToken ct)
    {
        if (noteIds.Count == 0)
            return new Dictionary<int, IReadOnlyList<NoteTagRef>>();

        var rows = await (from l in db.Set<NoteTagLink>().AsNoTracking()
                          join t in db.Set<NoteTag>().AsNoTracking() on l.NoteTagId equals t.Id
                          where noteIds.Contains(l.NoteId)
                          orderby t.Name
                          select new { l.NoteId, Tag = new NoteTagRef(t.Id, t.Name, t.ColourKey, t.IsActive) }).ToListAsync(ct);
        return rows.GroupBy(r => r.NoteId).ToDictionary(g => g.Key, g => (IReadOnlyList<NoteTagRef>)[.. g.Select(r => r.Tag)]);
    }

    public async Task<IReadOnlyDictionary<int, IReadOnlyList<NoteTagRef>>> TagsOfTemplatesAsync(IReadOnlyCollection<int> templateIds, CancellationToken ct)
    {
        if (templateIds.Count == 0)
            return new Dictionary<int, IReadOnlyList<NoteTagRef>>();

        var rows = await (from l in db.Set<NoteTemplateTag>().AsNoTracking()
                          join t in db.Set<NoteTag>().AsNoTracking() on l.NoteTagId equals t.Id
                          where templateIds.Contains(l.NoteTemplateId)
                          orderby t.Name
                          select new { l.NoteTemplateId, Tag = new NoteTagRef(t.Id, t.Name, t.ColourKey, t.IsActive) }).ToListAsync(ct);
        return rows.GroupBy(r => r.NoteTemplateId).ToDictionary(g => g.Key, g => (IReadOnlyList<NoteTagRef>)[.. g.Select(r => r.Tag)]);
    }
}
