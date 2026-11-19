using System.Globalization;
using System.Security.Cryptography;
using LptHub.Audit.Contracts;
using LptHub.Notes.Domain;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Notes.Application;

/// <summary>What the read endpoint needs before it loads the bytes (the bytes are loaded only when the browser does not already have this version).</summary>
internal sealed record NoteImageHeader(int Id, string ContentType, byte[] Sha256, int ByteSize);

/// <summary>
/// Images pasted into notes (epic #1405, issue #1409; design docs/ux/notes-round-2/README.md section 4, ADR 030). The bytes live in <c>dbo.NoteImage</c>, owned by a matter; the note body only holds
/// <c>&lt;img data-image-id&gt;</c> and <c>NoteLink</c> rows (type IMAGE) say which saved notes use an image. This service uploads (type found by the bytes, never by what the client says: PNG and JPEG,
/// 2 MB, 8,000 px), serves, deletes (Cancel: only the uploader, only while no saved note uses it) and copies an image into another matter, and gives the note service the pieces of the save: the
/// check that every image of a body is the note's matter's, the row locks that keep a save and a delete from crossing, the separate copy for an image another note already uses (a copied note
/// copies its images, nothing is shared) and the immediate delete of an image no note uses any more. A hidden matter's images do not exist for the caller (404).
/// </summary>
public sealed class NoteImageService(DbContext db, IAuditWriter audit, NoteAccess access, ICurrentUser currentUser, IClock clock)
{
    public const string ObjectType = "NoteImage";
    public const string AddedEvent = "NOTE_IMAGE_ADDED";

    public const int MaxBytes = 2 * 1024 * 1024;

    /// <summary>A technical guard against runaway retries, not a product limit: unsaved uploads per person.</summary>
    public const int MaxPendingPerPerson = 50;

    public const string TooLargeCode = "IMAGE_TOO_LARGE";
    public const string TypeUnsupportedCode = "IMAGE_TYPE_UNSUPPORTED";
    public const string CorruptCode = "IMAGE_CORRUPT";
    public const string TooManyPendingCode = "TOO_MANY_PENDING_IMAGES";
    public const string InUseCode = "IMAGE_IN_USE";
    public const string NotUploaderCode = "NOT_IMAGE_UPLOADER";
    public const string NotFoundCode = "IMAGE_NOT_FOUND";
    public const string NotInMatterCode = "IMAGE_NOT_IN_MATTER";

    private int? Me => currentUser.UserId;

    // ---------------------------------------------------------------- upload, read, delete, copy

    public async Task<Result<NoteImageResponse>> UploadAsync(int matterId, byte[] bytes, CancellationToken ct)
    {
        var matter = await access.FindVisibleMatterAsync(matterId, ct);
        if (matter is null)
            return NoteSupport.NotFound("Matter");
        if (!matter.IsActive)
            return Error.Conflict(ErrorCodes.MatterInactive, $"Matter {matter.MatterRef} is inactive; notes can't get new images.");

        var inspected = Inspect(bytes);
        if (inspected.IsFailure)
            return inspected.Error!;

        var guard = await PendingGuardAsync(ct);
        if (guard is not null)
            return guard;

        var image = NewImage(matterId, inspected.Value, bytes);
        db.Set<NoteImage>().Add(image);
        QueueAdded(image, copiedFrom: null);
        await db.SaveChangesAsync(ct);
        return ToResponse(image);
    }

    /// <summary>The type, size and ETag of an image the caller may see; null (404) when it does not exist or its matter is hidden.</summary>
    internal async Task<NoteImageHeader?> GetHeaderAsync(int id, CancellationToken ct) =>
        await access.Visible(db.Set<NoteImage>().AsNoTracking(), i => i.MatterId)
            .Where(i => i.Id == id)
            .Select(i => new NoteImageHeader(i.Id, i.ContentType, i.ContentSha256, i.ByteSize))
            .SingleOrDefaultAsync(ct);

    /// <summary>The bytes of an image the caller was already allowed to see (<see cref="GetHeaderAsync"/>).</summary>
    internal Task<byte[]?> GetContentAsync(int id, CancellationToken ct) =>
        db.Set<NoteImage>().AsNoTracking().Where(i => i.Id == id).Select(i => (byte[]?)i.Content).SingleOrDefaultAsync(ct);

    /// <summary>
    /// Deletes an image nothing uses, for Cancel and Discard: only the person who uploaded it (403 <c>NOT_IMAGE_UPLOADER</c>), only while no saved note uses it (409 <c>IMAGE_IN_USE</c>; the editor
    /// ignores that answer: the image was saved). 404 when it no longer exists (a save already deleted it) or its matter is hidden. Not audited.
    /// </summary>
    public async Task<Result> DeleteAsync(int id, CancellationToken ct)
    {
        var info = await access.Visible(db.Set<NoteImage>().AsNoTracking(), i => i.MatterId).Where(i => i.Id == id).Select(i => new { i.UploadedByUserId }).SingleOrDefaultAsync(ct);
        if (info is null)
            return NoteSupport.NotFound("Image");
        if (info.UploadedByUserId is null || info.UploadedByUserId != Me)
            return Error.Forbidden("Only the person who added an image can remove it.", NotUploaderCode);

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockAsync([id], ct);
        if (await IsUsedAsync(id, ct))
            return Error.Conflict(InUseCode, "A saved note uses this image.");

        var deleted = await db.Set<NoteImage>().Where(i => i.Id == id).ExecuteDeleteAsync(ct);
        await transaction.CommitAsync(ct);
        return deleted == 0 ? NoteSupport.NotFound("Image") : Result.Success();
    }

    /// <summary>
    /// Copies an image into another matter (a note pasted from matter A into matter B): a separate record with the same bytes, never shared. The caller must see both matters and the target must be
    /// active (the endpoint needs Matter Note Edit). Audited at the target like an upload.
    /// </summary>
    public async Task<Result<NoteImageResponse>> CopyAsync(int id, CopyNoteImageRequest request, CancellationToken ct)
    {
        var source = await access.Visible(db.Set<NoteImage>().AsNoTracking(), i => i.MatterId).Where(i => i.Id == id).SingleOrDefaultAsync(ct);
        if (source is null)
            return NoteSupport.NotFound("Image");

        var target = await access.FindVisibleMatterAsync(request.TargetMatterId, ct);
        if (target is null)
            return NoteSupport.NotFound("Matter");
        if (!target.IsActive)
            return Error.Conflict(ErrorCodes.MatterInactive, $"Matter {target.MatterRef} is inactive; notes can't get new images.");

        var guard = await PendingGuardAsync(ct);
        if (guard is not null)
            return guard;

        var copy = CloneOf(source, target.MatterId);
        db.Set<NoteImage>().Add(copy);
        QueueAdded(copy, copiedFrom: source.Id);
        await db.SaveChangesAsync(ct);
        return ToResponse(copy);
    }

    // ---------------------------------------------------------------- the pieces of a note save

    /// <summary>Every image the body refers to must exist and belong to the note's matter. 400 <c>IMAGE_NOT_FOUND</c> (the ids in <c>meta.imageIds</c>: the editor drops them and keeps the text) or <c>IMAGE_NOT_IN_MATTER</c>.</summary>
    internal async Task<Result> CheckAsync(int matterId, IReadOnlyCollection<int> imageIds, CancellationToken ct)
    {
        if (imageIds.Count == 0)
            return Result.Success();

        var found = await db.Set<NoteImage>().AsNoTracking().Where(i => imageIds.Contains(i.Id)).Select(i => new { i.Id, i.MatterId }).ToListAsync(ct);
        return await VerifyAsync(matterId, imageIds, found.ToDictionary(f => f.Id, f => f.MatterId), ct);
    }

    /// <summary>
    /// Takes an update lock on the image rows inside the caller's transaction and returns the ids that exist. A save that links an image and a delete (Cancel, the sweep, another save that drops the
    /// last reference) therefore cannot cross: the later one sees the committed result of the earlier one.
    /// </summary>
    internal async Task<IReadOnlyDictionary<int, int>> LockAsync(IReadOnlyCollection<int> ids, CancellationToken ct)
    {
        if (ids.Count == 0)
            return new Dictionary<int, int>();

        var json = "[" + string.Join(",", ids.Distinct().Select(i => i.ToString(CultureInfo.InvariantCulture))) + "]"; // integers only, passed as one parameter
        var rows = await db.Database.SqlQuery<ImageKey>($"SELECT NoteImageId AS Id, MatterId FROM dbo.NoteImage WITH (UPDLOCK, HOLDLOCK) WHERE NoteImageId IN (SELECT CAST([value] AS INT) FROM OPENJSON({json}))").ToListAsync(ct);
        return rows.ToDictionary(r => r.Id, r => r.MatterId);
    }

    /// <summary>
    /// The same check as <see cref="CheckAsync"/> against the rows <see cref="LockAsync"/> returned. An image of a matter the caller may not see is reported exactly like one that does not exist
    /// (<c>IMAGE_NOT_FOUND</c>), so a save cannot be used to find out which ids exist in a hidden matter.
    /// </summary>
    internal async Task<Result> VerifyAsync(int matterId, IReadOnlyCollection<int> imageIds, IReadOnlyDictionary<int, int> found, CancellationToken ct)
    {
        var missing = imageIds.Where(i => !found.ContainsKey(i)).ToList();
        var foreign = imageIds.Where(i => found.TryGetValue(i, out var m) && m != matterId).ToList();
        var foreignVisible = new List<int>();
        foreach (var group in foreign.GroupBy(i => found[i]))
        {
            if (await access.CanSeeMatterAsync(group.Key, ct))
                foreignVisible.AddRange(group);
            else
                missing.AddRange(group);
        }

        if (missing.Count > 0)
        {
            const string message = "An image in the note is no longer available. Remove it from the text and save again.";
            return new Error(
                ErrorType.Validation,
                NotFoundCode,
                message,
                new Dictionary<string, IReadOnlyList<FieldError>> { ["bodyHtml"] = [new FieldError(NotFoundCode, message)] },
                new Dictionary<string, object?> { ["imageIds"] = imageIds.Where(missing.Contains).ToList() });
        }

        if (foreignVisible.Count > 0)
        {
            const string message = "The note uses an image of another matter. Paste the image again.";
            return new Error(
                ErrorType.Validation,
                NotInMatterCode,
                message,
                new Dictionary<string, IReadOnlyList<FieldError>> { ["bodyHtml"] = [new FieldError(NotInMatterCode, message)] },
                new Dictionary<string, object?> { ["imageIds"] = imageIds.Where(foreignVisible.Contains).ToList() });
        }

        return Result.Success();
    }

    /// <summary>
    /// A copied note copies its images: an image of the body that another note already uses (and this note does not) gets a separate copy for this note, and the map says old id to new id. So no
    /// image is ever shared between notes, and deleting a note deletes exactly its own images. Call it inside the transaction after <see cref="LockAsync"/>, so two notes that claim one pending image
    /// at the same time cannot both link it. The copies are saved here (they need their ids).
    /// </summary>
    internal async Task<IReadOnlyDictionary<int, int>> SeparateSharedAsync(int matterId, int? noteId, IReadOnlyCollection<int> imageIds, IReadOnlySet<int> alreadyMine, CancellationToken ct)
    {
        var candidates = imageIds.Where(i => !alreadyMine.Contains(i)).ToList();
        if (candidates.Count == 0)
            return new Dictionary<int, int>();

        var shared = await db.Set<NoteLink>().AsNoTracking()
            .Where(l => l.TargetType == NoteLinkTarget.Image && candidates.Contains(l.TargetId) && (noteId == null || l.NoteId != noteId))
            .Select(l => l.TargetId).Distinct().ToListAsync(ct);
        if (shared.Count == 0)
            return new Dictionary<int, int>();

        var copies = new List<(int OldId, NoteImage Copy)>();
        foreach (var id in shared)
        {
            var source = await db.Set<NoteImage>().AsNoTracking().SingleAsync(i => i.Id == id, ct);
            var copy = CloneOf(source, matterId);
            db.Set<NoteImage>().Add(copy);
            copies.Add((id, copy));
        }

        await db.SaveChangesAsync(ct);
        return copies.ToDictionary(c => c.OldId, c => c.Copy.Id);
    }

    /// <summary>Deletes, at once, the images among <paramref name="candidates"/> that no note refers to any more. Inside the transaction of the save, the delete or the Cancel that dropped the last reference.</summary>
    internal Task<int> DeleteUnusedAsync(IReadOnlyCollection<int> candidates, CancellationToken ct) =>
        candidates.Count == 0
            ? Task.FromResult(0)
            : db.Set<NoteImage>().Where(i => candidates.Contains(i.Id) && !db.Set<NoteLink>().Any(l => l.TargetType == NoteLinkTarget.Image && l.TargetId == i.Id)).ExecuteDeleteAsync(ct);

    // ---------------------------------------------------------------- helpers

    private Result<NoteImageInfo> Inspect(byte[] bytes)
    {
        if (bytes.Length == 0)
            return Error.Validation("file", "REQUIRED", "Choose a PNG or JPEG image.", "IMAGE_REQUIRED");
        if (bytes.Length > MaxBytes)
            return TooLarge("The image is larger than 2 MB.");

        var info = NoteImageInspector.Inspect(bytes);
        return info.Problem switch
        {
            NoteImageProblem.None => info,
            NoteImageProblem.Unsupported => new Error(
                ErrorType.UnsupportedMediaType,
                TypeUnsupportedCode,
                "Only PNG and JPEG images are supported.",
                new Dictionary<string, IReadOnlyList<FieldError>> { ["file"] = [new FieldError(TypeUnsupportedCode, "Only PNG and JPEG images are supported.")] }),
            NoteImageProblem.TooManyPixels => TooLarge($"The image is larger than {NoteImageInspector.MaxPixels} x {NoteImageInspector.MaxPixels} pixels."),
            _ => Error.Validation("file", CorruptCode, "The image is damaged or incomplete. Try another one.", CorruptCode),
        };
    }

    internal static Error TooLarge(string message) =>
        new(
            ErrorType.PayloadTooLarge,
            TooLargeCode,
            message,
            new Dictionary<string, IReadOnlyList<FieldError>> { ["file"] = [new FieldError(TooLargeCode, message)] },
            new Dictionary<string, object?> { ["maxBytes"] = MaxBytes, ["maxPixels"] = NoteImageInspector.MaxPixels });

    private async Task<Error?> PendingGuardAsync(CancellationToken ct)
    {
        if (Me is not { } me)
            return null;

        var pending = await db.Set<NoteImage>().CountAsync(i => i.UploadedByUserId == me && !db.Set<NoteLink>().Any(l => l.TargetType == NoteLinkTarget.Image && l.TargetId == i.Id), ct);
        return pending >= MaxPendingPerPerson
            ? Error.Conflict(TooManyPendingCode, "Too many images were added without saving a note. Save or cancel the note you are editing and try again.", new Dictionary<string, object?> { ["limit"] = MaxPendingPerPerson })
            : null;
    }

    private Task<bool> IsUsedAsync(int id, CancellationToken ct) =>
        db.Set<NoteLink>().AsNoTracking().AnyAsync(l => l.TargetType == NoteLinkTarget.Image && l.TargetId == id, ct);

    private NoteImage NewImage(int matterId, NoteImageInfo info, byte[] bytes) => new()
    {
        MatterId = matterId,
        ContentType = info.ContentType,
        Width = info.Width,
        Height = info.Height,
        ByteSize = bytes.Length,
        ContentSha256 = SHA256.HashData(bytes),
        Content = bytes,
        UploadedAtUtc = clock.UtcNow,
        UploadedByUserId = Me,
    };

    private NoteImage CloneOf(NoteImage source, int matterId) => new()
    {
        MatterId = matterId,
        ContentType = source.ContentType,
        Width = source.Width,
        Height = source.Height,
        ByteSize = source.ByteSize,
        ContentSha256 = source.ContentSha256,
        Content = source.Content,
        UploadedAtUtc = clock.UtcNow,
        UploadedByUserId = Me,
    };

    /// <summary>NOTE_IMAGE_ADDED: the type, size and dimensions, never the content. Written at upload: a person put data into the matter even if the note is never saved.</summary>
    private void QueueAdded(NoteImage image, int? copiedFrom) =>
        audit.Write(new AuditEntry
        {
            EventType = AddedEvent,
            ObjectType = ObjectType,
            ObjectIdFactory = () => NoteSupport.Id(image.Id),
            MatterId = image.MatterId,
            Summary = $"{(image.ContentType == NoteImageInspector.Png ? "PNG" : "JPEG")}, {image.Width} x {image.Height} px, {Math.Max(1, (image.ByteSize + 1023) / 1024)} KB" + (copiedFrom is null ? string.Empty : " (copied from another matter's image)"),
        });

    private static NoteImageResponse ToResponse(NoteImage i) => new(i.Id, i.MatterId, i.Width, i.Height, i.ContentType, i.ByteSize);

    private sealed class ImageKey
    {
        public int Id { get; set; }

        public int MatterId { get; set; }
    }
}
