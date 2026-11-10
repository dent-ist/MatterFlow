using LptHub.Identity.Contracts;
using LptHub.Notes.Application;
using LptHub.SharedKernel.Paging;
using LptHub.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

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
    /// <summary>Lists the notes of a matter (<c>matterId</c> is required), pinned first. <c>tagId</c> (repeatable) keeps notes with any of the tags, <c>locked</c> true or false, <c>q</c> searches title and text. Sort: updatedAt (default, newest first), title, createdAt.</summary>
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
