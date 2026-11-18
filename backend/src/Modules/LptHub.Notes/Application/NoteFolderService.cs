using System.Globalization;
using LptHub.Audit.Contracts;
using LptHub.Notes.Domain;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Notes.Application;

/// <summary>
/// Folders of a matter's notes (epic #1405, design docs/ux/notes-round-2/README.md section 3): list, create, rename, move and delete. A folder belongs to one matter and nests up to
/// <see cref="NoteFolderRules.MaxDepth"/> levels, with at most <see cref="NoteFolderRules.MaxPerMatter"/> folders per matter; a name is unique inside its parent. Every change of the
/// structure of a matter takes one application lock per matter, so two people cannot make a cycle by moving A into B and B into A at the same time. A hidden (sensitive) matter has no
/// folders for the caller: 404. Every change is audited with its matter. A folder holding notes or subfolders is deleted only with "Move Contents Up"; notes are never deleted with a folder.
/// </summary>
public sealed class NoteFolderService(DbContext db, IAuditWriter audit, NoteAccess access, ICurrentUser currentUser, IClock clock)
{
    public const string ObjectType = nameof(NoteFolder);
    public const string CreatedEvent = "NOTE_FOLDER_CREATED";
    public const string RenamedEvent = "NOTE_FOLDER_RENAMED";
    public const string MovedEvent = "NOTE_FOLDER_MOVED";
    public const string DeletedEvent = "NOTE_FOLDER_DELETED";

    public const string NameTakenCode = "FOLDER_NAME_TAKEN";
    public const string TooDeepCode = "FOLDER_TOO_DEEP";
    public const string LimitCode = "FOLDER_LIMIT";
    public const string CycleCode = "FOLDER_CYCLE";
    public const string NotEmptyCode = "FOLDER_NOT_EMPTY";

    private int? Me => currentUser.UserId;

    // ---------------------------------------------------------------- read

    public async Task<Result<NoteFolderListResponse>> ListAsync(int matterId, CancellationToken ct)
    {
        if (await access.FindVisibleMatterAsync(matterId, ct) is null)
            return NoteSupport.NotFound("Matter");

        var folders = await db.Set<NoteFolder>().AsNoTracking().Where(f => f.MatterId == matterId).OrderBy(f => f.Name).ThenBy(f => f.Id).ToListAsync(ct);
        var (counts, noFolder) = await DirectNoteCountsAsync(matterId, ct);
        var children = folders.Where(f => f.ParentFolderId != null).GroupBy(f => f.ParentFolderId!.Value).ToDictionary(g => g.Key, g => g.Count());
        return new NoteFolderListResponse([.. folders.Select(f => ToResponse(f, counts.GetValueOrDefault(f.Id), children.GetValueOrDefault(f.Id)))], noFolder, noFolder + counts.Values.Sum());
    }

    // ---------------------------------------------------------------- write

    public async Task<Result<NoteFolderResponse>> CreateAsync(CreateNoteFolderRequest request, CancellationToken ct)
    {
        var name = NoteFolderRules.NormalizeName(request.Name);
        if (name.IsFailure)
            return name.Error!;

        var matter = await access.FindVisibleMatterAsync(request.MatterId, ct);
        if (matter is null)
            return NoteSupport.NotFound("Matter");
        if (!matter.IsActive)
            return Error.Conflict(ErrorCodes.MatterInactive, $"Matter {matter.MatterRef} is inactive; folders can't be added to it.");

        NoteFolder folder;
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await NoteFolderLock.AcquireAsync(db, matter.MatterId, ct);
            var tree = await LoadTreeAsync(matter.MatterId, ct);
            if (request.ParentFolderId is { } parent && !tree.Contains(parent))
                return Error.Validation("parentFolderId", "NOT_FOUND", "The folder no longer exists in this matter.");
            if (tree.Count >= NoteFolderRules.MaxPerMatter)
                return Error.Conflict(LimitCode, $"A matter can have at most {NoteFolderRules.MaxPerMatter} folders.", new Dictionary<string, object?> { ["limit"] = NoteFolderRules.MaxPerMatter });
            if (tree.Level(request.ParentFolderId) + 1 > NoteFolderRules.MaxDepth)
                return TooDeep();
            if (tree.FindByName(request.ParentFolderId, name.Value) is not null)
                return NameTaken(tree, request.ParentFolderId, name.Value);

            folder = new NoteFolder { MatterId = matter.MatterId, ParentFolderId = request.ParentFolderId, Name = name.Value };
            db.Set<NoteFolder>().Add(folder);
            var parentPath = request.ParentFolderId is null ? null : tree.Path(request.ParentFolderId);
            audit.Write(new AuditEntry
            {
                EventType = CreatedEvent,
                ObjectType = ObjectType,
                ObjectIdFactory = () => NoteSupport.Id(folder.Id),
                MatterId = matter.MatterId,
                Summary = parentPath is null ? name.Value : parentPath + NoteFolderRules.PathSeparator + name.Value,
            });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (NoteSupport.IsUniqueViolation(ex, NoteSupport.FolderNameUnique))
        {
            db.ChangeTracker.Clear();
            audit.DiscardPending();
            return NameTakenAfterRace(name.Value);
        }

        return (await ResponseAsync(folder.Id, ct))!;
    }

    public async Task<Result<NoteFolderResponse>> RenameAsync(int id, RenameNoteFolderRequest request, CancellationToken ct)
    {
        var folder = await access.FindTrackedAsync<NoteFolder>(f => f.MatterId, f => f.Id == id, ct);
        if (folder is null)
            return NoteSupport.NotFound("Folder");

        var version = NoteSupport.CheckRowVersion(folder.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        var name = NoteFolderRules.NormalizeName(request.Name);
        if (name.IsFailure)
            return name.Error!;
        if (string.Equals(folder.Name, name.Value, StringComparison.Ordinal))
            return (await ResponseAsync(id, ct))!;

        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await NoteFolderLock.AcquireAsync(db, folder.MatterId, ct);
            var tree = await LoadTreeAsync(folder.MatterId, ct);
            if (!tree.Contains(id))
                return NoteSupport.NotFound("Folder");
            if (tree.FindByName(folder.ParentFolderId, name.Value, exceptId: id) is not null)
                return NameTaken(tree, folder.ParentFolderId, name.Value);

            audit.Write(new AuditEntry
            {
                EventType = RenamedEvent,
                ObjectType = ObjectType,
                ObjectId = NoteSupport.Id(id),
                MatterId = folder.MatterId,
                OldValue = folder.Name,
                NewValue = name.Value,
            });
            folder.Name = name.Value;
            NoteSupport.TrackOriginalRowVersion(db, folder, request.RowVersion);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            audit.DiscardPending();
            return NoteSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (NoteSupport.IsUniqueViolation(ex, NoteSupport.FolderNameUnique))
        {
            db.ChangeTracker.Clear();
            audit.DiscardPending();
            return NameTakenAfterRace(name.Value);
        }

        return (await ResponseAsync(id, ct))!;
    }

    /// <summary>Moves a folder, with its notes and subfolders, under another folder of the same matter or to the top level. Refuses a cycle, a result deeper than 5 levels and a name clash.</summary>
    public async Task<Result<NoteFolderResponse>> MoveAsync(int id, MoveNoteFolderRequest request, CancellationToken ct)
    {
        var folder = await access.FindTrackedAsync<NoteFolder>(f => f.MatterId, f => f.Id == id, ct);
        if (folder is null)
            return NoteSupport.NotFound("Folder");

        var version = NoteSupport.CheckRowVersion(folder.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (folder.ParentFolderId == request.ParentFolderId)
            return (await ResponseAsync(id, ct))!;

        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await NoteFolderLock.AcquireAsync(db, folder.MatterId, ct);
            var tree = await LoadTreeAsync(folder.MatterId, ct);
            if (!tree.Contains(id))
                return NoteSupport.NotFound("Folder");
            if (request.ParentFolderId is { } target && !tree.Contains(target))
                return Error.Validation("parentFolderId", "NOT_FOUND", "The folder no longer exists in this matter.");
            if (tree.WouldCycle(id, request.ParentFolderId))
                return Error.Conflict(CycleCode, "A folder can't be moved into itself or into one of its own subfolders.");
            if (tree.WouldBeTooDeep(id, request.ParentFolderId))
                return TooDeep();
            if (tree.FindByName(request.ParentFolderId, folder.Name, exceptId: id) is not null)
                return NameTaken(tree, request.ParentFolderId, folder.Name);

            audit.Write(new AuditEntry
            {
                EventType = MovedEvent,
                ObjectType = ObjectType,
                ObjectId = NoteSupport.Id(id),
                MatterId = folder.MatterId,
                OldValue = tree.Path(id),
                NewValue = (request.ParentFolderId is null ? string.Empty : tree.Path(request.ParentFolderId) + NoteFolderRules.PathSeparator) + folder.Name,
            });
            folder.ParentFolderId = request.ParentFolderId;
            NoteSupport.TrackOriginalRowVersion(db, folder, request.RowVersion);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            audit.DiscardPending();
            return NoteSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (NoteSupport.IsUniqueViolation(ex, NoteSupport.FolderNameUnique))
        {
            db.ChangeTracker.Clear();
            audit.DiscardPending();
            return NameTakenAfterRace(folder.Name);
        }

        return (await ResponseAsync(id, ct))!;
    }

    /// <summary>
    /// Deletes an empty folder. A folder with notes or subfolders is refused (409 <c>FOLDER_NOT_EMPTY</c>, counts in meta) unless <paramref name="moveContentsUp"/>: then its notes and
    /// subfolders move to the parent folder (or to the top level for a top-level folder) and the empty folder is deleted, all in one transaction. Notes are never deleted.
    /// </summary>
    public async Task<Result> DeleteAsync(int id, string? rowVersion, bool moveContentsUp, CancellationToken ct)
    {
        var folder = await access.FindTrackedAsync<NoteFolder>(f => f.MatterId, f => f.Id == id, ct);
        if (folder is null)
            return NoteSupport.NotFound("Folder");
        if (string.IsNullOrWhiteSpace(rowVersion))
            return Error.Validation("rowVersion", "REQUIRED", "rowVersion is required.");

        var version = NoteSupport.CheckRowVersion(folder.RowVersion, rowVersion);
        if (version.IsFailure)
            return version.Error!;

        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await NoteFolderLock.AcquireAsync(db, folder.MatterId, ct);
            var tree = await LoadTreeAsync(folder.MatterId, ct);
            if (!tree.Contains(id))
                return NoteSupport.NotFound("Folder");

            var path = tree.Path(id);
            var subfolders = tree.Children(id).ToList();
            var notes = await db.Set<Note>().AsNoTracking().Where(n => n.MatterId == folder.MatterId && n.FolderId == id).Select(n => new { n.Id, n.Title }).ToListAsync(ct);
            string? summary = null;
            if (notes.Count > 0 || subfolders.Count > 0)
            {
                if (!moveContentsUp)
                {
                    return Error.Conflict(
                        NotEmptyCode,
                        $"The folder \"{folder.Name}\" holds {Plural(notes.Count, "note")} and {Plural(subfolders.Count, "subfolder")}. Move or delete them first, or use Move Contents Up and Delete.",
                        new Dictionary<string, object?> { ["noteCount"] = notes.Count, ["subfolderCount"] = subfolders.Count });
                }

                var newParent = folder.ParentFolderId;
                var clash = subfolders.FirstOrDefault(s => tree.FindByName(newParent, s.Name, exceptId: id) is not null);
                if (clash.Name is not null)
                    return NameTaken(tree, newParent, clash.Name);

                var newPath = tree.Path(newParent);
                var now = clock.UtcNow;
                var me = Me;
                if (notes.Count > 0)
                {
                    await db.Set<Note>().Where(n => n.MatterId == folder.MatterId && n.FolderId == id)
                        .ExecuteUpdateAsync(s => s.SetProperty(n => n.FolderId, newParent).SetProperty(n => n.ModifiedAtUtc, now).SetProperty(n => n.ModifiedByUserId, me), ct);
                    foreach (var note in notes)
                    {
                        audit.Write(new AuditEntry
                        {
                            EventType = NoteService.MovedEvent,
                            ObjectType = NoteService.ObjectType,
                            ObjectId = NoteSupport.Id(note.Id),
                            MatterId = folder.MatterId,
                            OldValue = path,
                            NewValue = newPath,
                            Summary = note.Title.Length == 0 ? NoteContent.UntitledTitle : note.Title,
                        });
                    }
                }

                if (subfolders.Count > 0)
                {
                    await db.Set<NoteFolder>().Where(f => f.MatterId == folder.MatterId && f.ParentFolderId == id)
                        .ExecuteUpdateAsync(s => s.SetProperty(f => f.ParentFolderId, newParent).SetProperty(f => f.ModifiedAtUtc, now).SetProperty(f => f.ModifiedByUserId, me), ct);
                }

                summary = $"{Plural(notes.Count, "note")} and {Plural(subfolders.Count, "subfolder")} moved up";
            }

            audit.Write(new AuditEntry { EventType = DeletedEvent, ObjectType = ObjectType, ObjectId = NoteSupport.Id(id), MatterId = folder.MatterId, OldValue = path, Summary = summary ?? path });
            NoteSupport.TrackOriginalRowVersion(db, folder, rowVersion);
            db.Set<NoteFolder>().Remove(folder);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return Result.Success();
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            audit.DiscardPending();
            return NoteSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (NoteSupport.IsForeignKeyViolation(ex, NoteSupport.NoteFolderForeignKey) || NoteSupport.IsForeignKeyViolation(ex, NoteSupport.FolderParentForeignKey))
        {
            // Somebody put a note into the folder (or a folder under it) after it was counted.
            db.ChangeTracker.Clear();
            audit.DiscardPending();
            return NoteSupport.ConcurrencyError();
        }
    }

    // ---------------------------------------------------------------- helpers

    private async Task<NoteFolderTree> LoadTreeAsync(int matterId, CancellationToken ct) =>
        new(await db.Set<NoteFolder>().AsNoTracking().Where(f => f.MatterId == matterId).Select(f => new NoteFolderNode(f.Id, f.ParentFolderId, f.Name)).ToListAsync(ct));

    /// <summary>Notes directly in each folder of the matter, and the notes in no folder.</summary>
    private async Task<(Dictionary<int, int> ByFolder, int NoFolder)> DirectNoteCountsAsync(int matterId, CancellationToken ct)
    {
        var rows = await db.Set<Note>().AsNoTracking().Where(n => n.MatterId == matterId).GroupBy(n => n.FolderId).Select(g => new { FolderId = g.Key, Count = g.Count() }).ToListAsync(ct);
        return (rows.Where(r => r.FolderId != null).ToDictionary(r => r.FolderId!.Value, r => r.Count), rows.Where(r => r.FolderId == null).Sum(r => r.Count));
    }

    private async Task<NoteFolderResponse?> ResponseAsync(int id, CancellationToken ct)
    {
        var folder = await db.Set<NoteFolder>().AsNoTracking().SingleOrDefaultAsync(f => f.Id == id, ct);
        if (folder is null)
            return null;

        var notes = await db.Set<Note>().AsNoTracking().CountAsync(n => n.MatterId == folder.MatterId && n.FolderId == id, ct);
        var subfolders = await db.Set<NoteFolder>().AsNoTracking().CountAsync(f => f.MatterId == folder.MatterId && f.ParentFolderId == id, ct);
        return ToResponse(folder, notes, subfolders);
    }

    private static NoteFolderResponse ToResponse(NoteFolder f, int notes, int subfolders) =>
        new(f.Id, f.MatterId, f.ParentFolderId, f.Name, notes, subfolders, NoteSupport.Encode(f.RowVersion));

    private static string Plural(int count, string noun) => string.Create(CultureInfo.InvariantCulture, $"{count} {noun}{(count == 1 ? string.Empty : "s")}");

    private static Error TooDeep() =>
        Error.Conflict(TooDeepCode, $"Folders can be nested up to {NoteFolderRules.MaxDepth} levels.", new Dictionary<string, object?> { ["maxDepth"] = NoteFolderRules.MaxDepth });

    private static Error NameTaken(NoteFolderTree tree, int? parentId, string name)
    {
        var where = parentId is null ? "at the top level" : $"in {tree.Path(parentId)}";
        return NameTakenError(name, parentId, $"A folder named \"{name}\" already exists {where}.");
    }

    private static Error NameTakenAfterRace(string name) => NameTakenError(name, null, $"A folder named \"{name}\" already exists here.");

    private static Error NameTakenError(string name, int? parentId, string message) =>
        new(
            ErrorType.Conflict,
            NameTakenCode,
            message,
            new Dictionary<string, IReadOnlyList<FieldError>> { ["name"] = [new FieldError(NameTakenCode, message)] },
            new Dictionary<string, object?> { ["name"] = name, ["parentFolderId"] = parentId });
}

/// <summary>The application lock that serialises every change of the folder structure of one matter (transaction owned: released at commit or rollback).</summary>
internal static class NoteFolderLock
{
    public static async Task AcquireAsync(DbContext db, int matterId, CancellationToken ct)
    {
        var resource = "LptHub.NoteFolders." + matterId.ToString(CultureInfo.InvariantCulture);
        await db.Database.ExecuteSqlRawAsync(
            """
            DECLARE @result int;
            EXEC @result = sp_getapplock @Resource = {0}, @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 15000;
            IF @result < 0 THROW 51000, 'Could not acquire the note folder lock.', 1;
            """,
            [resource],
            ct);
    }
}
