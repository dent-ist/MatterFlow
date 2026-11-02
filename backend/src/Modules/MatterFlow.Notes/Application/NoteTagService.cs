using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Notes.Domain;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notes.Application;

/// <summary>
/// The firm-wide list of note tags. Anyone who reads notes can read the list; administrators (<c>StatusLabel.Manage</c>, the Labels administration) create, rename, recolour,
/// deactivate and delete tags. A tag that notes carry is deactivated, not deleted; a deactivated tag stays on its notes but cannot be added.
/// </summary>
public sealed class NoteTagService(DbContext db, IAuditWriter audit, NoteAccess access)
{
    public const string ObjectType = nameof(NoteTag);

    public async Task<IReadOnlyList<NoteTagResponse>> ListAsync(bool includeInactive, CancellationToken ct)
    {
        var tags = db.Set<NoteTag>().AsNoTracking();
        if (!includeInactive)
            tags = tags.Where(t => t.IsActive);

        var rows = await tags.OrderBy(t => t.Name).ToListAsync(ct);
        var ids = rows.Select(r => r.Id).ToList();
        var inUse = await db.Set<NoteTagLink>().AsNoTracking().Where(l => ids.Contains(l.NoteTagId)).Select(l => l.NoteTagId).Distinct().ToListAsync(ct);
        var visible = await (from l in db.Set<NoteTagLink>().AsNoTracking()
                             join n in access.Visible(db.Set<Note>().AsNoTracking(), n => n.MatterId) on l.NoteId equals n.Id
                             where ids.Contains(l.NoteTagId)
                             group l by l.NoteTagId into g
                             select new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        return [.. rows.Select(t => ToResponse(t, visible.GetValueOrDefault(t.Id), inUse.Contains(t.Id)))];
    }

    public async Task<Result<NoteTagResponse>> CreateAsync(CreateNoteTagRequest request, CancellationToken ct)
    {
        var name = request.Name.Trim();
        if (name.Length == 0)
            return Error.Validation("name", "REQUIRED", "Enter a name.");
        var look = CheckColour(request.ColourKey);
        if (look.IsFailure)
            return look.Error!;
        if (await db.Set<NoteTag>().AnyAsync(t => t.Name == name, ct))
            return NoteSupport.Duplicate("name", $"A tag named '{name}' already exists.");

        var tag = new NoteTag { Name = name, ColourKey = NoteSupport.Clean(request.ColourKey), IsActive = true };
        db.Set<NoteTag>().Add(tag);
        audit.Write(new AuditEntry { EventType = "NOTE_TAG_CREATED", ObjectType = ObjectType, ObjectIdFactory = () => NoteSupport.Id(tag.Id), Summary = name });
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : ToResponse(tag, 0, false);
    }

    public async Task<Result<NoteTagResponse>> UpdateAsync(int id, UpdateNoteTagRequest request, CancellationToken ct)
    {
        var tag = await db.Set<NoteTag>().SingleOrDefaultAsync(t => t.Id == id, ct);
        if (tag is null)
            return NoteSupport.NotFound("Tag");

        var version = NoteSupport.CheckRowVersion(tag.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        var name = request.Name.Trim();
        if (name.Length == 0)
            return Error.Validation("name", "REQUIRED", "Enter a name.");
        var look = CheckColour(request.ColourKey);
        if (look.IsFailure)
            return look.Error!;
        if (await db.Set<NoteTag>().AnyAsync(t => t.Name == name && t.Id != id, ct))
            return NoteSupport.Duplicate("name", $"A tag named '{name}' already exists.");

        var before = new Dictionary<string, string?> { ["Name"] = tag.Name, ["ColourKey"] = tag.ColourKey, ["IsActive"] = tag.IsActive.ToString() };
        tag.Name = name;
        tag.ColourKey = NoteSupport.Clean(request.ColourKey);
        tag.IsActive = request.IsActive;
        var after = new Dictionary<string, string?> { ["Name"] = tag.Name, ["ColourKey"] = tag.ColourKey, ["IsActive"] = tag.IsActive.ToString() };
        foreach (var (key, value) in after)
        {
            if (!string.Equals(before[key], value, StringComparison.Ordinal))
                audit.Write(new AuditEntry { EventType = AuditEventTypes.FieldChanged, ObjectType = ObjectType, ObjectId = NoteSupport.Id(id), FieldKey = key, OldValue = before[key], NewValue = value });
        }

        NoteSupport.TrackOriginalRowVersion(db, tag, request.RowVersion);
        var saved = await SaveAsync(ct);
        if (saved.IsFailure)
            return saved.Error!;

        return (await ListByIdAsync(id, ct))!;
    }

    public async Task<Result> DeleteAsync(int id, string? rowVersion, CancellationToken ct)
    {
        var tag = await db.Set<NoteTag>().SingleOrDefaultAsync(t => t.Id == id, ct);
        if (tag is null)
            return NoteSupport.NotFound("Tag");
        if (string.IsNullOrWhiteSpace(rowVersion))
            return Error.Validation("rowVersion", "REQUIRED", "rowVersion is required.");

        var version = NoteSupport.CheckRowVersion(tag.RowVersion, rowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (await db.Set<NoteTagLink>().AnyAsync(l => l.NoteTagId == id, ct) || await db.Set<NoteTemplateTag>().AnyAsync(l => l.NoteTagId == id, ct))
            return Error.Conflict(ErrorCodes.InUse, "Notes or templates use this tag. Deactivate it instead.");

        audit.Write(new AuditEntry { EventType = "NOTE_TAG_DELETED", ObjectType = ObjectType, ObjectId = NoteSupport.Id(id), Summary = tag.Name });
        NoteSupport.TrackOriginalRowVersion(db, tag, rowVersion);
        db.Set<NoteTag>().Remove(tag);
        return await SaveAsync(ct);
    }

    private async Task<NoteTagResponse?> ListByIdAsync(int id, CancellationToken ct) =>
        (await ListAsync(includeInactive: true, ct)).FirstOrDefault(t => t.NoteTagId == id);

    private static Result CheckColour(string? colour) =>
        NoteSupport.Clean(colour) is { } c && !TaskTypeColours.IsValid(c)
            ? Error.Validation("colourKey", "UNKNOWN_COLOUR", "Choose a colour from the palette.")
            : Result.Success();

    private async Task<Result> SaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return Result.Success();
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return NoteSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (NoteSupport.IsUniqueViolation(ex, NoteSupport.TagNameUnique))
        {
            db.ChangeTracker.Clear();
            return NoteSupport.Duplicate("name", "A tag with this name already exists.");
        }
    }

    private static NoteTagResponse ToResponse(NoteTag t, int visibleNotes, bool inUse) =>
        new(t.Id, t.Name, t.ColourKey, t.IsActive, visibleNotes, inUse, NoteSupport.Encode(t.RowVersion));
}
