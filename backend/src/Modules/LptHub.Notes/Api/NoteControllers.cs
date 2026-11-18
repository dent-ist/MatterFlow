using LptHub.Identity.Contracts;
using LptHub.Notes.Application;
using LptHub.SharedKernel.Paging;
using LptHub.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace LptHub.Notes.Api;

/// <summary>Permission policy names for the Notes endpoints ("Perm:" plus the permission code, resolved by the Identity module).</summary>
internal static class NotePolicies
{
    private const string Prefix = "Perm:";

    public const string NoteView = Prefix + Permissions.MatterNote.View;
    public const string NoteEdit = Prefix + Permissions.MatterNote.Edit;
    public const string NoteDelete = Prefix + Permissions.MatterNote.Delete;

    /// <summary>Read the tag list: anyone who reads notes, or an administrator of the Labels pages.</summary>
    public const string TagRead = Prefix + Permissions.MatterNote.View + "|" + Permissions.StatusLabel.Manage;

    /// <summary>Create, change and delete tags: the Labels administration (<c>StatusLabel.Manage</c>).</summary>
    public const string TagManage = Prefix + Permissions.StatusLabel.Manage;
}

internal static class ListFilters
{
    /// <summary>Unknown query parameters are a 400 (architecture section 11).</summary>
    public static Error? UnknownFilter(HttpRequest request, IReadOnlyCollection<string> allowed) =>
        FilterParsing.EnsureKnown(request.Query.Keys, allowed).Error;
}

/// <summary>
/// Notes of a matter. A matter the caller may not see (sensitive-matter rule) is a 404 on every endpoint. A locked note is read only for everybody: saving or deleting it is a 409
/// <c>NOTE_LOCKED</c>; pinning still works. Only the person who locked a note, or an administrator, unlocks it.
/// </summary>
[ApiController]
[Route("api/v1/notes")]
public class NotesController(NoteService notes) : ControllerBase
{
    /// <summary>Lists the notes of a matter (<c>matterId</c> is required), pinned first. <c>tagId</c> (repeatable) keeps notes with any of the tags, <c>locked</c> true or false, <c>q</c> searches title and text, <c>folderId</c> keeps the notes directly in a folder (with <c>q</c>: the folder and its subfolders), <c>noFolder=true</c> the notes in no folder. Sort: updatedAt (default, newest first), title, createdAt.</summary>
    [HttpGet(Name = "ListNotes")]
    [Authorize(Policy = NotePolicies.NoteView)]
    [ProducesResponseType<PagedResult<NoteListItem>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] NoteListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, NoteListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await notes.ListAsync(query, cancellationToken));
    }

    /// <summary>The counts behind the Notes tab: notes and locked notes of the matter.</summary>
    [HttpGet("/api/v1/matters/{matterId:int}/notes/summary", Name = "GetMatterNotesSummary")]
    [Authorize(Policy = NotePolicies.NoteView)]
    [ProducesResponseType<NoteSummaryResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Summary(int matterId, CancellationToken cancellationToken) =>
        this.ToActionResult(await notes.SummaryAsync(matterId, cancellationToken));

    /// <summary>Gets one note with its sanitised body, tags and references.</summary>
    [HttpGet("{noteId:int}", Name = "GetNote")]
    [Authorize(Policy = NotePolicies.NoteView)]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int noteId, CancellationToken cancellationToken) =>
        this.ToActionResult(await notes.GetAsync(noteId, cancellationToken));

    /// <summary>Creates a note in an active matter. The body is sanitised, the title is its first line; at most five active tags; everything it refers to must belong to the matter.</summary>
    [HttpPost(Name = "CreateNote")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateNoteRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await notes.CreateAsync(request, cancellationToken), n => CreatedAtRoute("GetNote", new { noteId = n.NoteId }, n));

    /// <summary>
    /// Saves a note (body and tags). Send the <c>rowVersion</c> last read. 409 <c>NOTE_LOCKED</c> for a locked note. <c>ackWarnings</c> records "saved after an AI warning" with the reasons in the note history.
    /// </summary>
    [HttpPut("{noteId:int}", Name = "UpdateNote")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int noteId, [FromBody] UpdateNoteRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await notes.UpdateAsync(noteId, request, cancellationToken));

    /// <summary>Deletes a note for good (audited; needs Matter Note Delete). A locked note can't be deleted (409). Send the <c>rowVersion</c> last read as a query parameter.</summary>
    [HttpDelete("{noteId:int}", Name = "DeleteNote")]
    [Authorize(Policy = NotePolicies.NoteDelete)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int noteId, [FromQuery] string? rowVersion, CancellationToken cancellationToken)
    {
        var result = await notes.DeleteAsync(noteId, rowVersion, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }

    /// <summary>Pins or unpins a note; pinned notes are listed first. Allowed on a locked note.</summary>
    [HttpPut("{noteId:int}/pinned", Name = "SetNotePinned")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetPinned(int noteId, [FromBody] SetNotePinnedRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await notes.SetPinnedAsync(noteId, request, cancellationToken));

    /// <summary>Locks a note: nobody can change or delete it until it is unlocked. 409 <c>NOTE_LOCKED</c> when someone else locked it.</summary>
    [HttpPost("{noteId:int}/lock", Name = "LockNote")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Lock(int noteId, [FromBody] LockNoteRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await notes.LockAsync(noteId, request, cancellationToken));

    /// <summary>
    /// Moves a note into a folder of its matter, or out of every folder (<c>folderId</c> null = No Folder). Allowed on a locked note (like pinning). Does not change Last Updated.
    /// Send the <c>rowVersion</c> last read. 400 <c>NOT_FOUND</c> on <c>folderId</c> when the folder is not one of the note's matter.
    /// </summary>
    [HttpPut("{noteId:int}/folder", Name = "MoveNote")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Move(int noteId, [FromBody] MoveNoteRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await notes.MoveAsync(noteId, request, cancellationToken));

    /// <summary>Unlocks a note. Only the person who locked it or an administrator may (403 <c>NOT_LOCK_OWNER</c>).</summary>
    [HttpPost("{noteId:int}/unlock", Name = "UnlockNote")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Unlock(int noteId, [FromBody] UnlockNoteRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await notes.UnlockAsync(noteId, request, cancellationToken));

    /// <summary>Who did what to the note and when (created, edited, tags changed, locked, unlocked, pinned, saved after an AI warning), newest first, from the audit trail.</summary>
    [HttpGet("{noteId:int}/history", Name = "GetNoteHistory")]
    [Authorize(Policy = NotePolicies.NoteView)]
    [ProducesResponseType<NoteHistoryResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> History(int noteId, [FromQuery] NoteHistoryQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, NoteHistoryQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await notes.HistoryAsync(noteId, query, cancellationToken));
    }

    /// <summary>
    /// Names and states of the references in a note, for the person asking: Ok, Inactive, Restricted (they may not see it) or Removed (it no longer exists). For an inline note the sanitised body is included.
    /// </summary>
    [HttpPost("resolve-references", Name = "ResolveNoteReferences")]
    [Authorize(Policy = NotePolicies.NoteView)]
    [ProducesResponseType<ResolveNoteReferencesResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ResolveReferences([FromBody] ResolveNoteReferencesRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await notes.ResolveReferencesAsync(request, cancellationToken));
}

/// <summary>
/// Nested folders of a matter's notes. A hidden matter has no folders for the caller (404). Read: Matter Note Read; create, rename and move: Matter Note Edit; delete: Matter Note Delete.
/// Errors (409): <c>FOLDER_NAME_TAKEN</c>, <c>FOLDER_TOO_DEEP</c> (5 levels), <c>FOLDER_LIMIT</c> (200 per matter), <c>FOLDER_CYCLE</c>, <c>FOLDER_NOT_EMPTY</c>, <c>MATTER_INACTIVE</c>, <c>CONCURRENCY_CONFLICT</c>.
/// </summary>
[ApiController]
public class NoteFoldersController(NoteFolderService folders) : ControllerBase
{
    /// <summary>All folders of the matter, flat (id, parentId, name, direct note count, subfolder count, rowVersion), plus the number of notes in no folder and the total.</summary>
    [HttpGet("/api/v1/matters/{matterId:int}/note-folders", Name = "ListNoteFolders")]
    [Authorize(Policy = NotePolicies.NoteView)]
    [ProducesResponseType<NoteFolderListResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(int matterId, CancellationToken cancellationToken) =>
        this.ToActionResult(await folders.ListAsync(matterId, cancellationToken));

    /// <summary>Creates a folder in an active matter (top level, or under <c>parentFolderId</c>). 409 <c>FOLDER_NAME_TAKEN</c>, <c>FOLDER_TOO_DEEP</c>, <c>FOLDER_LIMIT</c>, <c>MATTER_INACTIVE</c>.</summary>
    [HttpPost("/api/v1/note-folders", Name = "CreateNoteFolder")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteFolderResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateNoteFolderRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await folders.CreateAsync(request, cancellationToken), f => StatusCode(StatusCodes.Status201Created, f));

    /// <summary>Renames a folder. Send the <c>rowVersion</c> last read. 409 <c>FOLDER_NAME_TAKEN</c>.</summary>
    [HttpPut("/api/v1/note-folders/{folderId:int}", Name = "RenameNoteFolder")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteFolderResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Rename(int folderId, [FromBody] RenameNoteFolderRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await folders.RenameAsync(folderId, request, cancellationToken));

    /// <summary>Moves a folder with everything in it under another folder (<c>parentFolderId</c>) or to the top level (null). 409 <c>FOLDER_CYCLE</c>, <c>FOLDER_TOO_DEEP</c>, <c>FOLDER_NAME_TAKEN</c>.</summary>
    [HttpPut("/api/v1/note-folders/{folderId:int}/parent", Name = "MoveNoteFolder")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteFolderResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Move(int folderId, [FromBody] MoveNoteFolderRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await folders.MoveAsync(folderId, request, cancellationToken));

    /// <summary>
    /// Deletes a folder (needs Matter Note Delete). A folder that holds notes or subfolders is refused with 409 <c>FOLDER_NOT_EMPTY</c> (<c>noteCount</c> and <c>subfolderCount</c> in meta) unless
    /// <c>moveContentsUp</c> is true: then its notes and subfolders move to the parent folder (top level for a top-level folder) and the folder is deleted, in one transaction (409
    /// <c>FOLDER_NAME_TAKEN</c> when a moved subfolder's name clashes). Notes are never deleted. Send the <c>rowVersion</c> last read as a query parameter.
    /// </summary>
    [HttpDelete("/api/v1/note-folders/{folderId:int}", Name = "DeleteNoteFolder")]
    [Authorize(Policy = NotePolicies.NoteDelete)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int folderId, [FromQuery] string? rowVersion, [FromQuery] bool moveContentsUp, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ["rowVersion", "moveContentsUp"]) is { } unknown)
            return this.Problem(unknown);

        var result = await folders.DeleteAsync(folderId, rowVersion, moveContentsUp, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }
}

/// <summary>Multipart body of an image upload.</summary>
public sealed class UploadNoteImageForm
{
    /// <summary>The image: PNG or JPEG, at most 2 MB, at most 8,000 px on a side. The type is found by the bytes; the declared content type and the file name are ignored.</summary>
    public IFormFile? File { get; set; }
}

/// <summary>
/// Pasted images of notes (epic #1405, issue #1409; ADR 030). Upload and copy need Matter Note Edit, read needs Matter Note Read, and all of them follow the matter: a hidden matter's image is a 404, the same
/// answer as a missing one. The bytes are served only here, never through a URL kept in a note body. Errors: 413 <c>IMAGE_TOO_LARGE</c> (2 MB or 8,000 px), 415 <c>IMAGE_TYPE_UNSUPPORTED</c> (anything but
/// PNG and JPEG, found by content), 400 <c>IMAGE_CORRUPT</c>, 409 <c>MATTER_INACTIVE</c>, 409 <c>TOO_MANY_PENDING_IMAGES</c> (50 unsaved uploads per person), 409 <c>IMAGE_IN_USE</c>, 403 <c>NOT_IMAGE_UPLOADER</c>.
/// </summary>
[ApiController]
public class NoteImagesController(NoteImageService images) : ControllerBase
{
    /// <summary><c>Cache-Control</c> of an image: kept by the browser but checked every time (the ETag answers 304), so a note whose matter access changed never shows a stale image.</summary>
    internal const string ReadCacheControl = "private, no-cache";

    /// <summary>Policy of an image response: nothing loads, nothing runs, and the document is sandboxed even if someone opens the URL directly.</summary>
    internal const string ReadContentSecurityPolicy = "default-src 'none'; sandbox; frame-ancestors 'none'";

    /// <summary>
    /// Adds an image to a matter (multipart field <c>file</c>, PNG or JPEG, at most 2 MB). The note body then refers to it as <c>&lt;img data-image-id="..."&gt;</c>; an image no saved note uses is deleted by
    /// the save, by <c>DELETE /note-images/{id}</c> or by the nightly sweep. The matter must be active. Audited (<c>NOTE_IMAGE_ADDED</c>, no content).
    /// </summary>
    [HttpPost("/api/v1/matters/{matterId:int}/note-images", Name = "UploadNoteImage")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [Consumes("multipart/form-data")]
    [NoteImageRequestLimits]
    [RequestFormLimits(MultipartBodyLengthLimit = NoteImageRequestLimitsAttribute.MaxRequestBytes, MemoryBufferThreshold = (int)NoteImageRequestLimitsAttribute.MaxRequestBytes, ValueCountLimit = 8, MultipartHeadersCountLimit = 16)]
    [ProducesResponseType<NoteImageResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Upload(int matterId, [FromForm] UploadNoteImageForm form, CancellationToken cancellationToken)
    {
        if (form.File is not { Length: > 0 } file)
            return this.Problem(Error.Validation("file", "REQUIRED", "Choose a PNG or JPEG image.", "IMAGE_REQUIRED"));
        if (file.Length > NoteImageService.MaxBytes)
            return this.Problem(NoteImageService.TooLarge("The image is larger than 2 MB."));

        byte[] bytes;
        await using (var stream = file.OpenReadStream())
        {
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer, cancellationToken);
            bytes = buffer.ToArray();
        }

        return this.ToActionResult(await images.UploadAsync(matterId, bytes, cancellationToken), r => StatusCode(StatusCodes.Status201Created, r));
    }

    /// <summary>
    /// The image bytes (<c>image/png</c> or <c>image/jpeg</c>, the type found when it was uploaded). Matter Note Read and the matter's visibility; a hidden matter is a 404. Sent with <c>nosniff</c>,
    /// <c>Content-Disposition: inline</c>, a sandbox policy, <c>Cache-Control: private, no-cache</c> and the SHA-256 as <c>ETag</c> (304 when <c>If-None-Match</c> matches). An image of an inactive matter is still readable.
    /// </summary>
    [HttpGet("/api/v1/notes/images/{noteImageId:int}", Name = "GetNoteImage")]
    [Authorize(Policy = NotePolicies.NoteView)]
    [Produces("image/png", "image/jpeg")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(int noteImageId, CancellationToken cancellationToken)
    {
        var header = await images.GetHeaderAsync(noteImageId, cancellationToken);
        if (header is null)
            return this.Problem(NoteSupport.NotFound("Image"));

        var etag = "\"" + Convert.ToHexString(header.Sha256).ToLowerInvariant() + "\"";
        Response.Headers.ETag = etag;
        Response.Headers.CacheControl = ReadCacheControl;
        Response.Headers.ContentDisposition = "inline";
        Response.Headers.ContentSecurityPolicy = ReadContentSecurityPolicy;
        if (Request.GetTypedHeaders().IfNoneMatch.Any(v => v.Tag == "*" || string.Equals(v.Tag.Value, etag, StringComparison.Ordinal)))
            return StatusCode(StatusCodes.Status304NotModified);

        var bytes = await images.GetContentAsync(noteImageId, cancellationToken);
        return bytes is null ? this.Problem(NoteSupport.NotFound("Image")) : File(bytes, header.ContentType);
    }

    /// <summary>
    /// Deletes an image no saved note uses: the editor calls it on Cancel and Discard for every image uploaded in that editing session and not saved. Only the person who uploaded it (403
    /// <c>NOT_IMAGE_UPLOADER</c>); 409 <c>IMAGE_IN_USE</c> when a saved note uses it (the editor ignores that answer); 404 when it is already gone (a save deleted it) or its matter is hidden.
    /// </summary>
    [HttpDelete("/api/v1/note-images/{noteImageId:int}", Name = "DeleteNoteImage")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int noteImageId, CancellationToken cancellationToken)
    {
        var result = await images.DeleteAsync(noteImageId, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }

    /// <summary>
    /// Copies an image into another matter (a note pasted from matter A into matter B): a separate record with the same bytes, never shared. The caller must see both matters and the target must be
    /// active (409 <c>MATTER_INACTIVE</c>). Audited at the target. The editor swaps the id in the pasted text.
    /// </summary>
    [HttpPost("/api/v1/note-images/{noteImageId:int}/copy", Name = "CopyNoteImage")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteImageResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Copy(int noteImageId, [FromBody] CopyNoteImageRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await images.CopyAsync(noteImageId, request, cancellationToken), r => StatusCode(StatusCodes.Status201Created, r));
}

/// <summary>
/// Caps the image upload before anything reads it (the request body may be at most 2 MB plus the multipart envelope; a larger declared length is answered with a 413 problem without reading a byte) and
/// turns failures of the form reader (limits exceeded, truncated or malformed multipart) into problems that never echo content.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
internal sealed class NoteImageRequestLimitsAttribute : Attribute, IAsyncResourceFilter, IExceptionFilter
{
    /// <summary>The file is at most 2 MB; the rest is the multipart envelope.</summary>
    internal const long MaxRequestBytes = NoteImageService.MaxBytes + 64 * 1024;

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var http = context.HttpContext;
        var feature = http.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false })
            feature.MaxRequestBodySize = MaxRequestBytes;

        if (http.Request.ContentLength > MaxRequestBytes)
        {
            context.Result = Problem(context, NoteImageService.TooLarge("The image is larger than 2 MB."));
            return;
        }

        await next();
    }

    public void OnException(ExceptionContext context)
    {
        var error = context.Exception switch
        {
            BadHttpRequestException { StatusCode: StatusCodes.Status413PayloadTooLarge } => NoteImageService.TooLarge("The image is larger than 2 MB."),
            InvalidDataException => NoteImageService.TooLarge("The image is larger than 2 MB."),
            BadHttpRequestException or IOException or InvalidOperationException { Source: "Microsoft.AspNetCore.Http" } =>
                Error.Validation("file", NoteImageService.CorruptCode, "The upload could not be read. Choose the image again.", NoteImageService.CorruptCode),
            _ => null,
        };
        if (error is null)
            return;

        context.Result = Problem(context, error);
        context.ExceptionHandled = true;
    }

    private static IActionResult Problem(ActionContext context, Error error) => new ProblemCarrier { ControllerContext = new ControllerContext(context) }.Problem(error);

    private sealed class ProblemCarrier : ControllerBase;
}

/// <summary>The firm-wide note tags. Everyone who reads notes reads the list; the Labels administrators change it.</summary>
[ApiController]
[Route("api/v1/note-tags")]
public class NoteTagsController(NoteTagService tags) : ControllerBase
{
    /// <summary>Lists the tags by name; inactive ones only with <c>includeInactive=true</c>.</summary>
    [HttpGet(Name = "ListNoteTags")]
    [Authorize(Policy = NotePolicies.TagRead)]
    [ProducesResponseType<IReadOnlyList<NoteTagResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] bool includeInactive, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ["includeInactive"]) is { } unknown)
            return this.Problem(unknown);

        return Ok(await tags.ListAsync(includeInactive, cancellationToken));
    }

    /// <summary>Creates a tag (409 DUPLICATE_NAME when the name is taken).</summary>
    [HttpPost(Name = "CreateNoteTag")]
    [Authorize(Policy = NotePolicies.TagManage)]
    [ProducesResponseType<NoteTagResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateNoteTagRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await tags.CreateAsync(request, cancellationToken), t => StatusCode(StatusCodes.Status201Created, t));

    /// <summary>Renames, recolours, deactivates or reactivates a tag. Send the <c>rowVersion</c> last read.</summary>
    [HttpPut("{tagId:int}", Name = "UpdateNoteTag")]
    [Authorize(Policy = NotePolicies.TagManage)]
    [ProducesResponseType<NoteTagResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int tagId, [FromBody] UpdateNoteTagRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await tags.UpdateAsync(tagId, request, cancellationToken));

    /// <summary>Deletes a tag nothing uses (409 IN_USE otherwise: deactivate it). Send the <c>rowVersion</c> last read as a query parameter.</summary>
    [HttpDelete("{tagId:int}", Name = "DeleteNoteTag")]
    [Authorize(Policy = NotePolicies.TagManage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int tagId, [FromQuery] string? rowVersion, CancellationToken cancellationToken)
    {
        var result = await tags.DeleteAsync(tagId, rowVersion, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }
}

/// <summary>
/// Note templates: firm-wide ones (administrators change them) and a matter's own (anyone with Matter Note Edit who sees the matter). Using a template needs Matter Note Edit.
/// </summary>
[ApiController]
[Route("api/v1/note-templates")]
public class NoteTemplatesController(NoteTemplateService templates) : ControllerBase
{
    /// <summary>The firm-wide templates and those of the matter (<c>matterId</c> is required), firm-wide first.</summary>
    [HttpGet(Name = "ListNoteTemplates")]
    [Authorize(Policy = NotePolicies.NoteView)]
    [ProducesResponseType<IReadOnlyList<NoteTemplateResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] NoteTemplateListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, NoteTemplateListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await templates.ListAsync(query, cancellationToken));
    }

    /// <summary>Gets one template.</summary>
    [HttpGet("{templateId:int}", Name = "GetNoteTemplate")]
    [Authorize(Policy = NotePolicies.NoteView)]
    [ProducesResponseType<NoteTemplateResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int templateId, CancellationToken cancellationToken) =>
        this.ToActionResult(await templates.GetAsync(templateId, cancellationToken));

    /// <summary>Creates a template at one of three levels: SYSTEM (administrators only, 403 SYSTEM_TEMPLATE_ADMIN_ONLY), CLIENT (needs client edit and a visible matter of the client) or MATTER (needs the matter).</summary>
    [HttpPost(Name = "CreateNoteTemplate")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteTemplateResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateNoteTemplateRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await templates.CreateAsync(request, cancellationToken), t => CreatedAtRoute("GetNoteTemplate", new { templateId = t.NoteTemplateId }, t));

    /// <summary>Changes a template. Send the <c>rowVersion</c> last read.</summary>
    [HttpPut("{templateId:int}", Name = "UpdateNoteTemplate")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteTemplateResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int templateId, [FromBody] UpdateNoteTemplateRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await templates.UpdateAsync(templateId, request, cancellationToken));

    /// <summary>Copies a template; a non-administrator's copy always belongs to a matter.</summary>
    [HttpPost("{templateId:int}/duplicate", Name = "DuplicateNoteTemplate")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteTemplateResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Duplicate(int templateId, [FromBody] DuplicateNoteTemplateRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await templates.DuplicateAsync(templateId, request, cancellationToken), t => CreatedAtRoute("GetNoteTemplate", new { templateId = t.NoteTemplateId }, t));

    /// <summary>Deletes a template. Send the <c>rowVersion</c> last read as a query parameter.</summary>
    [HttpDelete("{templateId:int}", Name = "DeleteNoteTemplate")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int templateId, [FromQuery] string? rowVersion, CancellationToken cancellationToken)
    {
        var result = await templates.DeleteAsync(templateId, rowVersion, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }

    /// <summary>Counts one use (the client copies the text into a new note) and returns the template; no link is kept.</summary>
    [HttpPost("{templateId:int}/use", Name = "UseNoteTemplate")]
    [Authorize(Policy = NotePolicies.NoteEdit)]
    [ProducesResponseType<NoteTemplateResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Use(int templateId, CancellationToken cancellationToken) =>
        this.ToActionResult(await templates.UseAsync(templateId, cancellationToken));
}
