using System.Globalization;
using MatterFlow.Assets.Contracts;
using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Notes.Domain;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notes.Application;

/// <summary>
/// Notes of a matter: list, read, create, save, delete, pin, lock and unlock, history and the resolving of the references in a body. The body is sanitised and the title, snippet,
/// search text and links are derived on the server. A locked note is read only for everybody (pinning still works) and cannot be deleted. Every state change is audited with its matter.
/// </summary>
public sealed class NoteService(
    DbContext db,
    IAuditWriter audit,
    IAuditReader auditReader,
    NoteAccess access,
    ICurrentUser currentUser,
    IClock clock,
    IAssetDirectory assets,
    IProjectDirectory projects,
    IMatterDirectory matters,
    IUserDirectory users)
{
    public const string ObjectType = nameof(Note);
    public const string CreatedEvent = "NOTE_CREATED";
    public const string EditedEvent = "NOTE_EDITED";
    public const string TagsChangedEvent = "NOTE_TAGS_CHANGED";
    public const string LockedEvent = "NOTE_LOCKED";
    public const string UnlockedEvent = "NOTE_UNLOCKED";
    public const string PinnedEvent = "NOTE_PINNED";
    public const string UnpinnedEvent = "NOTE_UNPINNED";
    public const string AiWarningEvent = "NOTE_SAVED_AFTER_AI_WARNING";
    public const string DeletedEvent = "NOTE_DELETED";

    public const int MaxTags = 5;
    public const int MaxAckItems = 20;

    public static readonly string[] SortFields = ["updatedAt", "title", "createdAt"];

    private int? Me => currentUser.UserId;

    // ---------------------------------------------------------------- read

    public async Task<Result<PagedResult<NoteListItem>>> ListAsync(NoteListQuery query, CancellationToken ct)
    {
        if (query.MatterId is not { } matterId)
            return Error.Validation("matterId", "REQUIRED", "matterId is required.");

        var paging = NoteSupport.PagingOf(query.Page, query.PageSize, query.Sort, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        if (await access.FindVisibleMatterAsync(matterId, ct) is null)
            return NoteSupport.NotFound("Matter");

        var notes = access.Visible(db.Set<Note>().AsNoTracking(), n => n.MatterId).Where(n => n.MatterId == matterId);
        if (query.Locked is { } locked)
            notes = locked ? notes.Where(n => n.LockedByUserId != null) : notes.Where(n => n.LockedByUserId == null);
        if (query.TagId is { Length: > 0 } tagIds)
            notes = notes.Where(n => db.Set<NoteTagLink>().Any(l => l.NoteId == n.Id && tagIds.Contains(l.NoteTagId)));
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var q = query.Q.Trim();
            notes = notes.Where(n => n.Title.Contains(q) || n.BodyText.Contains(q));
        }

        var (page, sort) = paging.Value;
        var total = await notes.CountAsync(ct);

        // Pinned notes first, whatever the sort; then the chosen keys (default: last updated, newest first).
        IOrderedQueryable<Note> ordered = notes.OrderByDescending(n => n.IsPinned);
        if (sort.Count == 0)
        {
            ordered = ordered.ThenByDescending(n => n.ContentUpdatedAtUtc);
        }
        else
        {
            foreach (var field in sort)
            {
                ordered = (field.Field, field.Descending) switch
                {
                    ("title", false) => ordered.ThenBy(n => n.Title),
                    ("title", true) => ordered.ThenByDescending(n => n.Title),
                    ("createdAt", false) => ordered.ThenBy(n => n.CreatedAtUtc),
                    ("createdAt", true) => ordered.ThenByDescending(n => n.CreatedAtUtc),
                    (_, false) => ordered.ThenBy(n => n.ContentUpdatedAtUtc),
                    _ => ordered.ThenByDescending(n => n.ContentUpdatedAtUtc),
                };
            }
        }

        var rows = await ordered.ThenBy(n => n.Id).Skip(page.Skip).Take(page.PageSize)
            .Select(n => new Note
            {
                Id = n.Id,
                MatterId = n.MatterId,
                Title = n.Title,
                Snippet = n.Snippet,
                IsPinned = n.IsPinned,
                LockedByUserId = n.LockedByUserId,
                LockedAtUtc = n.LockedAtUtc,
                ContentUpdatedAtUtc = n.ContentUpdatedAtUtc,
                ContentUpdatedByUserId = n.ContentUpdatedByUserId,
            })
            .ToListAsync(ct);

        var tags = await access.TagsOfNotesAsync([.. rows.Select(r => r.Id)], ct);
        var names = await access.NamesAsync(rows.SelectMany(r => new[] { r.LockedByUserId, r.ContentUpdatedByUserId, r.CreatedByUserId }), ct);
        return new PagedResult<NoteListItem>([.. rows.Select(r => ToListItem(r, tags, names))], total, page.Page, page.PageSize);
    }

    public async Task<Result<NoteSummaryResponse>> SummaryAsync(int matterId, CancellationToken ct)
    {
        if (await access.FindVisibleMatterAsync(matterId, ct) is null)
            return NoteSupport.NotFound("Matter");

        var notes = db.Set<Note>().AsNoTracking().Where(n => n.MatterId == matterId);
        return new NoteSummaryResponse(await notes.CountAsync(ct), await notes.CountAsync(n => n.LockedByUserId != null, ct));
    }

    public async Task<Result<NoteResponse>> GetAsync(int id, CancellationToken ct)
    {
        var note = await access.Visible(db.Set<Note>().AsNoTracking(), n => n.MatterId).SingleOrDefaultAsync(n => n.Id == id, ct);
        return note is null ? NoteSupport.NotFound("Note") : await ToResponseAsync(note, ct);
    }

    public async Task<Result<NoteHistoryResponse>> HistoryAsync(int id, NoteHistoryQuery query, CancellationToken ct)
    {
        if (!await access.Visible(db.Set<Note>().AsNoTracking(), n => n.MatterId).AnyAsync(n => n.Id == id, ct))
            return NoteSupport.NotFound("Note");

        var page = await auditReader.ListAllForObjectAsync(ObjectType, NoteSupport.Id(id), query.BeforeId, query.Limit, ct);
        var names = await access.NamesAsync(page.Items.Select(e => e.ActorUserId), ct);
        var items = page.Items.Select(e => new NoteHistoryEntry(
            e.AuditEventId,
            e.OccurredAtUtc,
            e.ActorUserId,
            e.ActorUserId is { } actor && names.TryGetValue(actor, out var n) ? n : null,
            e.EventType,
            e.OldValue,
            e.NewValue,
            e.Summary)).ToList();
        return new NoteHistoryResponse(items, page.NextBeforeId);
    }

    // ---------------------------------------------------------------- write

    public async Task<Result<NoteResponse>> CreateAsync(CreateNoteRequest request, CancellationToken ct)
    {
        var matter = await access.FindVisibleMatterAsync(request.MatterId, ct);
        if (matter is null)
            return Error.Validation("matterId", "NOT_FOUND", "Select a matter.");
        if (!matter.IsActive)
            return Error.Conflict(ErrorCodes.MatterInactive, $"Matter {matter.MatterRef} is inactive; notes can't be added to it.");

        var content = NoteContent.Process(request.BodyHtml);
        if (content.IsFailure)
            return content.Error!;

        var tags = await LoadTagsAsync(request.TagIds, existing: [], ct);
        if (tags.IsFailure)
            return tags.Error!;

        var references = await CheckReferencesAsync(matter.MatterId, noteId: null, content.Value.References, ct);
        if (references.IsFailure)
            return references.Error!;

        var now = clock.UtcNow;
        var note = new Note { MatterId = matter.MatterId, ContentUpdatedAtUtc = now, ContentUpdatedByUserId = Me };
        ApplyContent(note, content.Value);
        db.Set<Note>().Add(note);
        audit.Write(new AuditEntry
        {
            EventType = CreatedEvent,
            ObjectType = ObjectType,
            ObjectIdFactory = () => NoteSupport.Id(note.Id),
            MatterId = note.MatterId,
            Summary = DisplayTitle(note),
        });

        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            await db.SaveChangesAsync(ct);
            db.Set<NoteTagLink>().AddRange(tags.Value.Select(t => new NoteTagLink { NoteId = note.Id, NoteTagId = t.Id }));
            db.Set<NoteLink>().AddRange(NoteContent.Links(content.Value.References).Select(l => new NoteLink { NoteId = note.Id, TargetType = l.Target, TargetId = l.Id }));
            if (tags.Value.Count > 0)
            {
                audit.Write(new AuditEntry
                {
                    EventType = TagsChangedEvent,
                    ObjectType = ObjectType,
                    ObjectId = NoteSupport.Id(note.Id),
                    MatterId = note.MatterId,
                    NewValue = string.Join(", ", tags.Value.Select(t => t.Name)),
                });
            }

            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }

        return await GetAsync(note.Id, ct);
    }

    public async Task<Result<NoteResponse>> UpdateAsync(int id, UpdateNoteRequest request, CancellationToken ct)
    {
        var note = await access.FindTrackedAsync<Note>(n => n.MatterId, n => n.Id == id, ct);
        if (note is null)
            return NoteSupport.NotFound("Note");

        var version = NoteSupport.CheckRowVersion(note.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (note.IsLocked)
            return await LockedErrorAsync(note, ct);

        var ack = ValidateAck(request);
        if (ack.IsFailure)
            return ack.Error!;

        var content = NoteContent.Process(request.BodyHtml);
        if (content.IsFailure)
            return content.Error!;

        var currentLinks = await db.Set<NoteTagLink>().Where(l => l.NoteId == id).ToListAsync(ct);
        var tags = await LoadTagsAsync(request.TagIds, currentLinks.Select(l => l.NoteTagId).ToList(), ct);
        if (tags.IsFailure)
            return tags.Error!;

        var references = await CheckReferencesAsync(note.MatterId, id, content.Value.References, ct);
        if (references.IsFailure)
            return references.Error!;

        var contentChanged = !string.Equals(note.BodyHtml, content.Value.Html, StringComparison.Ordinal);
        var oldTags = await TagNamesAsync(currentLinks.Select(l => l.NoteTagId), ct);
        var newIds = tags.Value.Select(t => t.Id).ToHashSet();
        var tagsChanged = !currentLinks.Select(l => l.NoteTagId).ToHashSet().SetEquals(newIds);
        if (!contentChanged && !tagsChanged)
            return await GetAsync(id, ct); // nothing to save: no new "last updated", no history line

        if (contentChanged)
        {
            ApplyContent(note, content.Value);
            audit.Write(new AuditEntry
            {
                EventType = EditedEvent,
                ObjectType = ObjectType,
                ObjectId = NoteSupport.Id(id),
                MatterId = note.MatterId,
                Summary = DisplayTitle(note),
            });

            var existing = await db.Set<NoteLink>().Where(l => l.NoteId == id).ToListAsync(ct);
            var wanted = NoteContent.Links(content.Value.References).ToHashSet();
            db.Set<NoteLink>().RemoveRange(existing.Where(l => !wanted.Contains((l.TargetType, l.TargetId))));
            var have = existing.Select(l => (l.TargetType, l.TargetId)).ToHashSet();
            db.Set<NoteLink>().AddRange(wanted.Where(w => !have.Contains(w)).Select(w => new NoteLink { NoteId = id, TargetType = w.Target, TargetId = w.Id }));
        }

        if (tagsChanged)
        {
            db.Set<NoteTagLink>().RemoveRange(currentLinks.Where(l => !newIds.Contains(l.NoteTagId)));
            var haveTags = currentLinks.Select(l => l.NoteTagId).ToHashSet();
            db.Set<NoteTagLink>().AddRange(newIds.Where(t => !haveTags.Contains(t)).Select(t => new NoteTagLink { NoteId = id, NoteTagId = t }));
            audit.Write(new AuditEntry
            {
                EventType = TagsChangedEvent,
                ObjectType = ObjectType,
                ObjectId = NoteSupport.Id(id),
                MatterId = note.MatterId,
                OldValue = oldTags.Count == 0 ? null : string.Join(", ", oldTags),
                NewValue = tags.Value.Count == 0 ? null : string.Join(", ", tags.Value.Select(t => t.Name)),
            });
        }

        if (ack.Value.Ids.Count > 0)
        {
            audit.Write(new AuditEntry
            {
                EventType = AiWarningEvent,
                ObjectType = ObjectType,
                ObjectId = NoteSupport.Id(id),
                MatterId = note.MatterId,
                NewValue = string.Join(", ", ack.Value.Ids),
                Summary = string.Join("; ", ack.Value.Reasons),
            });
        }

        note.ContentUpdatedAtUtc = clock.UtcNow;
        note.ContentUpdatedByUserId = Me;
        NoteSupport.TrackOriginalRowVersion(db, note, request.RowVersion);
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(id, ct);
    }

    public async Task<Result<NoteResponse>> SetPinnedAsync(int id, SetNotePinnedRequest request, CancellationToken ct)
    {
        var note = await access.FindTrackedAsync<Note>(n => n.MatterId, n => n.Id == id, ct);
        if (note is null)
            return NoteSupport.NotFound("Note");

        var version = NoteSupport.CheckRowVersion(note.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (note.IsPinned == request.Pinned)
            return await GetAsync(id, ct);

        note.IsPinned = request.Pinned;
        audit.Write(new AuditEntry
        {
            EventType = request.Pinned ? PinnedEvent : UnpinnedEvent,
            ObjectType = ObjectType,
            ObjectId = NoteSupport.Id(id),
            MatterId = note.MatterId,
        });
        NoteSupport.TrackOriginalRowVersion(db, note, request.RowVersion);
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(id, ct);
    }

    public async Task<Result<NoteResponse>> LockAsync(int id, LockNoteRequest request, CancellationToken ct)
    {
        var note = await access.FindTrackedAsync<Note>(n => n.MatterId, n => n.Id == id, ct);
        if (note is null)
            return NoteSupport.NotFound("Note");

        var version = NoteSupport.CheckRowVersion(note.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (note.IsLocked)
            return note.LockedByUserId == Me ? await GetAsync(id, ct) : await LockedErrorAsync(note, ct);

        note.LockedByUserId = Me;
        note.LockedAtUtc = clock.UtcNow;
        audit.Write(new AuditEntry { EventType = LockedEvent, ObjectType = ObjectType, ObjectId = NoteSupport.Id(id), MatterId = note.MatterId });
        NoteSupport.TrackOriginalRowVersion(db, note, request.RowVersion);
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(id, ct);
    }

    public async Task<Result<NoteResponse>> UnlockAsync(int id, UnlockNoteRequest request, CancellationToken ct)
    {
        var note = await access.FindTrackedAsync<Note>(n => n.MatterId, n => n.Id == id, ct);
        if (note is null)
            return NoteSupport.NotFound("Note");

        var version = NoteSupport.CheckRowVersion(note.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (!note.IsLocked)
            return await GetAsync(id, ct);
        if (!(note.LockedByUserId == Me || currentUser.IsSystemAdmin))
        {
            var who = (await access.NamesAsync([note.LockedByUserId], ct)).GetValueOrDefault(note.LockedByUserId!.Value) ?? "the person who locked it";
            return Error.Forbidden($"Only {who} or an administrator can unlock this note.", "NOT_LOCK_OWNER");
        }

        note.LockedByUserId = null;
        note.LockedAtUtc = null;
        audit.Write(new AuditEntry { EventType = UnlockedEvent, ObjectType = ObjectType, ObjectId = NoteSupport.Id(id), MatterId = note.MatterId });
        NoteSupport.TrackOriginalRowVersion(db, note, request.RowVersion);
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(id, ct);
    }

    public async Task<Result> DeleteAsync(int id, string? rowVersion, CancellationToken ct)
    {
        var note = await access.FindTrackedAsync<Note>(n => n.MatterId, n => n.Id == id, ct);
        if (note is null)
            return NoteSupport.NotFound("Note");
        if (string.IsNullOrWhiteSpace(rowVersion))
            return Error.Validation("rowVersion", "REQUIRED", "rowVersion is required.");

        var version = NoteSupport.CheckRowVersion(note.RowVersion, rowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (note.IsLocked)
            return (await LockedErrorAsync(note, ct)).Error!;

        audit.Write(new AuditEntry { EventType = DeletedEvent, ObjectType = ObjectType, ObjectId = NoteSupport.Id(id), MatterId = note.MatterId, Summary = DisplayTitle(note) });
        NoteSupport.TrackOriginalRowVersion(db, note, rowVersion);
        db.Set<Note>().Remove(note);
        return await SaveAsync(ct);
    }

    // ---------------------------------------------------------------- references

    public async Task<Result<ResolveNoteReferencesResponse>> ResolveReferencesAsync(ResolveNoteReferencesRequest request, CancellationToken ct)
    {
        if (request.References.Count > NoteContent.MaxReferences)
            return Error.Validation("references", "TOO_MANY_REFERENCES", $"At most {NoteContent.MaxReferences} references at a time.");
        if (await access.FindVisibleMatterAsync(request.MatterId, ct) is null)
            return NoteSupport.NotFound("Matter");

        var matterId = request.MatterId;
        var wanted = request.References.Select(r => (Kind: r.Kind.ToLowerInvariant(), r.Id)).ToList();
        if (wanted.Any(w => w.Kind is not ("asset" or "project" or "matter" or "note" or "embed" or "user")))
            return Error.Validation("references", "UNKNOWN_KIND", "A reference kind must be asset, project, matter, note, embed or user.");

        var assetMap = (await assets.FindManyAsync([.. wanted.Where(w => w.Kind == "asset").Select(w => w.Id).Distinct()], ct)).ToDictionary(a => a.AssetId);
        var userMap = await users.FindManyAsync([.. wanted.Where(w => w.Kind == "user").Select(w => w.Id).Distinct()], ct);
        var noteIds = wanted.Where(w => w.Kind is "note" or "embed").Select(w => w.Id).Distinct().ToList();
        var noteMap = noteIds.Count == 0
            ? []
            : await access.Visible(db.Set<Note>().AsNoTracking(), n => n.MatterId).Where(n => noteIds.Contains(n.Id)).ToDictionaryAsync(n => n.Id, ct);

        var items = new List<NoteReferenceResolution>();
        foreach (var (kind, id) in wanted)
        {
            switch (kind)
            {
                case "asset":
                    items.Add(!assetMap.TryGetValue(id, out var asset)
                        ? Gone(kind, id, "Removed")
                        : asset.MatterId != matterId
                            ? Gone(kind, id, "Restricted")
                            : new(kind, id, asset.IsActive ? "Ok" : "Inactive", asset.DisplayName, asset.AssetTypeName, null));
                    break;
                case "project":
                    var project = await projects.FindAsync(id, ct);
                    items.Add(project is null
                        ? Gone(kind, id, "Removed")
                        : project.MatterId != matterId
                            ? Gone(kind, id, "Restricted")
                            : new(kind, id, project.IsActive ? "Ok" : "Inactive", project.Name, null, null));
                    break;
                case "matter":
                    // A matter the person may not see is Restricted, whether or not it exists: nothing is revealed.
                    var matter = await access.CanSeeMatterAsync(id, ct) ? await matters.FindAsync(id, ct) : null;
                    items.Add(matter is null ? Gone(kind, id, "Restricted") : new(kind, id, matter.IsActive ? "Ok" : "Inactive", matter.Name, matter.MatterRef, null));
                    break;
                case "user":
                    items.Add(userMap.TryGetValue(id, out var user)
                        ? new(kind, id, user.IsActive ? "Ok" : "Inactive", user.DisplayName, null, null)
                        : Gone(kind, id, "Removed"));
                    break;
                default: // note, embed
                    if (!noteMap.TryGetValue(id, out var target))
                        items.Add(Gone(kind, id, "Removed"));
                    else if (target.MatterId != matterId)
                        items.Add(Gone(kind, id, "Restricted"));
                    else
                        items.Add(new(kind, id, "Ok", DisplayTitle(target), null, kind == "embed" ? target.BodyHtml : null));
                    break;
            }
        }

        return new ResolveNoteReferencesResponse(items);
    }

    private static NoteReferenceResolution Gone(string kind, int id, string state) => new(kind, id, state, null, null, null);

    /// <summary>Everything a note refers to must be a record of the note's own matter (assets, projects, notes), an existing person, or a matter the author may see.</summary>
    private async Task<Result> CheckReferencesAsync(int matterId, int? noteId, IReadOnlyList<NoteReference> references, CancellationToken ct)
    {
        if (references.Count == 0)
            return Result.Success();

        Error Foreign(string what) => Error.Validation("bodyHtml", "REFERENCE_NOT_ALLOWED", $"The note refers to {what} that is not part of this matter.");

        var assetIds = references.Where(r => r.Target == NoteLinkTarget.Asset).Select(r => r.Id).Distinct().ToList();
        if (assetIds.Count > 0)
        {
            var found = await assets.FindManyAsync(assetIds, ct);
            if (found.Count != assetIds.Count || found.Any(a => a.MatterId != matterId))
                return Foreign("an asset");
        }

        foreach (var projectId in references.Where(r => r.Target == NoteLinkTarget.Project).Select(r => r.Id).Distinct())
        {
            if (await projects.FindAsync(projectId, ct) is not { } project || project.MatterId != matterId)
                return Foreign("a project");
        }

        foreach (var otherMatter in references.Where(r => r.Target == NoteLinkTarget.Matter).Select(r => r.Id).Distinct())
        {
            if (!await access.CanSeeMatterAsync(otherMatter, ct))
                return Error.Validation("bodyHtml", "REFERENCE_NOT_ALLOWED", "The note refers to a matter you can't see.");
        }

        var noteIds = references.Where(r => r.Target == NoteLinkTarget.Note).Select(r => r.Id).Distinct().ToList();
        if (noteIds.Count > 0)
        {
            if (noteId is { } self && noteIds.Contains(self))
                return Error.Validation("bodyHtml", "REFERENCE_NOT_ALLOWED", "A note can't refer to itself.");
            if (await db.Set<Note>().CountAsync(n => noteIds.Contains(n.Id) && n.MatterId == matterId, ct) != noteIds.Count)
                return Foreign("a note");
        }

        var userIds = references.Where(r => r.Target == NoteLinkTarget.User).Select(r => r.Id).Distinct().ToList();
        if (userIds.Count > 0 && (await users.FindManyAsync(userIds, ct)).Count != userIds.Count)
            return Error.Validation("bodyHtml", "REFERENCE_NOT_ALLOWED", "The note mentions a person who doesn't exist.");

        return Result.Success();
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>The tags for a save: at most five, they exist, and each is active unless the note already carries it.</summary>
    private async Task<Result<IReadOnlyList<NoteTag>>> LoadTagsAsync(IReadOnlyList<int>? tagIds, IReadOnlyCollection<int> existing, CancellationToken ct)
    {
        var ids = (tagIds ?? []).Distinct().ToList();
        if (ids.Count > MaxTags)
            return Error.Validation("tagIds", "TOO_MANY_TAGS", $"A note can have at most {MaxTags} tags.");
        if (ids.Count == 0)
            return Result<IReadOnlyList<NoteTag>>.Success([]);

        var tags = await db.Set<NoteTag>().AsNoTracking().Where(t => ids.Contains(t.Id)).ToListAsync(ct);
        if (tags.Count != ids.Count)
            return Error.Validation("tagIds", "NOT_FOUND", "A tag no longer exists.");
        if (tags.FirstOrDefault(t => !t.IsActive && !existing.Contains(t.Id)) is { } inactive)
            return Error.Conflict("TAG_INACTIVE", $"The tag '{inactive.Name}' is no longer in use. Remove it or ask an administrator.");

        return Result<IReadOnlyList<NoteTag>>.Success(tags);
    }

    private async Task<List<string>> TagNamesAsync(IEnumerable<int> tagIds, CancellationToken ct)
    {
        var ids = tagIds.ToList();
        return ids.Count == 0 ? [] : await db.Set<NoteTag>().AsNoTracking().Where(t => ids.Contains(t.Id)).OrderBy(t => t.Name).Select(t => t.Name).ToListAsync(ct);
    }

    private static Result<(IReadOnlyList<string> Ids, IReadOnlyList<string> Reasons)> ValidateAck(UpdateNoteRequest request)
    {
        var ids = (request.AckWarnings ?? []).Select(a => a?.Trim() ?? string.Empty).Where(a => a.Length > 0).Distinct().ToList();
        var reasons = (request.AckWarningReasons ?? []).Select(a => a?.Trim() ?? string.Empty).Where(a => a.Length > 0).ToList();
        if (ids.Count > MaxAckItems || reasons.Count > MaxAckItems)
            return Error.Validation("ackWarnings", "TOO_MANY", $"At most {MaxAckItems} warnings.");
        if (ids.Any(a => a.Length > 64) || reasons.Any(a => a.Length > 300))
            return Error.Validation("ackWarnings", "TOO_LONG", "A warning id is at most 64 characters and a reason at most 300.");
        return (ids, reasons);
    }

    private static void ApplyContent(Note note, NoteContentResult content)
    {
        note.BodyHtml = content.Html;
        note.BodyText = content.Text;
        note.Title = content.Title;
        note.Snippet = content.Snippet;
    }

    private static string DisplayTitle(Note note) => note.Title.Length == 0 ? NoteContent.UntitledTitle : note.Title;

    private async Task<Result<NoteResponse>> LockedErrorAsync(Note note, CancellationToken ct)
    {
        var who = note.LockedByUserId is { } locker ? (await access.NamesAsync([locker], ct)).GetValueOrDefault(locker) : null;
        return Error.Conflict(
            "NOTE_LOCKED",
            who is null ? "This note is locked." : $"This note is locked by {who}. Nobody can change it until it is unlocked.",
            new Dictionary<string, object?> { ["lockedByUserId"] = note.LockedByUserId, ["lockedByName"] = who });
    }

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
    }

    private static NoteListItem ToListItem(Note n, IReadOnlyDictionary<int, IReadOnlyList<NoteTagRef>> tags, IReadOnlyDictionary<int, string> names)
    {
        string? Name(int? userId) => userId is { } u && names.TryGetValue(u, out var name) ? name : null;
        return new NoteListItem(
            n.Id,
            n.MatterId,
            DisplayTitle(n),
            n.Snippet,
            tags.GetValueOrDefault(n.Id) ?? [],
            n.IsPinned,
            n.IsLocked,
            n.LockedByUserId,
            Name(n.LockedByUserId),
            NoteSupport.Utc(n.LockedAtUtc),
            NoteSupport.Utc(n.ContentUpdatedAtUtc),
            n.ContentUpdatedByUserId,
            Name(n.ContentUpdatedByUserId),
            n.CreatedByUserId,
            Name(n.CreatedByUserId));
    }

    private async Task<NoteResponse> ToResponseAsync(Note n, CancellationToken ct)
    {
        var tags = await access.TagsOfNotesAsync([n.Id], ct);
        var links = await db.Set<NoteLink>().AsNoTracking().Where(l => l.NoteId == n.Id).OrderBy(l => l.TargetType).ThenBy(l => l.TargetId).ToListAsync(ct);
        var names = await access.NamesAsync([n.LockedByUserId, n.ContentUpdatedByUserId, n.CreatedByUserId], ct);
        string? Name(int? userId) => userId is { } u && names.TryGetValue(u, out var name) ? name : null;
        return new NoteResponse(
            n.Id,
            n.MatterId,
            DisplayTitle(n),
            n.Snippet,
            n.BodyHtml,
            tags.GetValueOrDefault(n.Id) ?? [],
            [.. links.Select(l => new NoteReferenceRef(l.TargetType.ToLower(CultureInfo.InvariantCulture), l.TargetId))],
            n.IsPinned,
            n.IsLocked,
            n.LockedByUserId,
            Name(n.LockedByUserId),
            NoteSupport.Utc(n.LockedAtUtc),
            NoteSupport.Utc(n.CreatedAtUtc),
            n.CreatedByUserId,
            Name(n.CreatedByUserId),
            NoteSupport.Utc(n.ContentUpdatedAtUtc),
            n.ContentUpdatedByUserId,
            Name(n.ContentUpdatedByUserId),
            NoteSupport.Encode(n.RowVersion));
    }
}
