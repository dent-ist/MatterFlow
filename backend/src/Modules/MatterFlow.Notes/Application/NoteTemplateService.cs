using MatterFlow.Audit.Contracts;
using MatterFlow.Notes.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notes.Application;

/// <summary>
/// Note templates: a starting text for a note, firm-wide (created and changed by administrators only) or for one matter (anyone with Matter Note Edit who sees the matter). Using a template
/// copies it (no link is kept); the placeholders <c>{{date}}</c>, <c>{{time}}</c>, <c>{{matter}}</c> and <c>{{author}}</c> are filled in by the client. A template carries no references.
/// </summary>
public sealed class NoteTemplateService(DbContext db, IAuditWriter audit, NoteAccess access, ICurrentUser currentUser)
{
    public const string ObjectType = nameof(NoteTemplate);

    public async Task<Result<IReadOnlyList<NoteTemplateResponse>>> ListAsync(NoteTemplateListQuery query, CancellationToken ct)
    {
        if (query.MatterId is not { } matterId)
            return Error.Validation("matterId", "REQUIRED", "matterId is required.");
        if (await access.FindVisibleMatterAsync(matterId, ct) is null)
            return NoteSupport.NotFound("Matter");

        var templates = db.Set<NoteTemplate>().AsNoTracking().Where(t => t.MatterId == null || t.MatterId == matterId);
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var q = query.Q.Trim();
            templates = templates.Where(t => t.Name.Contains(q) || (t.Description != null && t.Description.Contains(q)));
        }

        var rows = await templates.OrderBy(t => t.ScopeCode).ThenBy(t => t.Name).ThenBy(t => t.Id).ToListAsync(ct);
        return Result<IReadOnlyList<NoteTemplateResponse>>.Success(await ToResponsesAsync(rows, ct));
    }

    public async Task<Result<NoteTemplateResponse>> GetAsync(int id, CancellationToken ct)
    {
        var template = await FindReadableAsync(id, tracked: false, ct);
        return template is null ? NoteSupport.NotFound("Template") : (await ToResponsesAsync([template], ct))[0];
    }

    public async Task<Result<NoteTemplateResponse>> CreateAsync(CreateNoteTemplateRequest request, CancellationToken ct)
    {
        if (request.Scope is not (TemplateScope.Firm or TemplateScope.Matter))
            return Error.Validation("scope", "INVALID", "The scope must be FIRM or MATTER.");

        int? matterId = null;
        if (request.Scope == TemplateScope.Firm)
        {
            if (!currentUser.IsSystemAdmin)
                return Error.Forbidden("Firm-wide templates are changed by an administrator.", "FIRM_TEMPLATE_ADMIN_ONLY");
            if (request.MatterId is not null)
                return Error.Validation("matterId", "NOT_ALLOWED", "A firm-wide template has no matter.");
        }
        else
        {
            if (request.MatterId is not { } m)
                return Error.Validation("matterId", "REQUIRED", "Choose the matter for this template.");
            if (await access.FindVisibleMatterAsync(m, ct) is null)
                return Error.Validation("matterId", "NOT_FOUND", "Select a matter.");
            matterId = m;
        }

        var template = new NoteTemplate { ScopeCode = request.Scope, MatterId = matterId };
        var applied = await ApplyAsync(template, request, existingTags: [], ct);
        if (applied.IsFailure)
            return applied.Error!;

        db.Set<NoteTemplate>().Add(template);
        audit.Write(new AuditEntry { EventType = "NOTE_TEMPLATE_CREATED", ObjectType = ObjectType, ObjectIdFactory = () => NoteSupport.Id(template.Id), MatterId = matterId, Summary = template.Name });
        var saved = await SaveWithTagsAsync(template, applied.Value, ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(template.Id, ct);
    }

    public async Task<Result<NoteTemplateResponse>> UpdateAsync(int id, UpdateNoteTemplateRequest request, CancellationToken ct)
    {
        var template = await FindReadableAsync(id, tracked: true, ct);
        if (template is null)
            return NoteSupport.NotFound("Template");
        var allowed = RequireWrite(template);
        if (allowed.IsFailure)
            return allowed.Error!;

        var version = NoteSupport.CheckRowVersion(template.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var current = await db.Set<NoteTemplateTag>().Where(l => l.NoteTemplateId == id).ToListAsync(ct);
        var applied = await ApplyAsync(template, request, current.Select(l => l.NoteTagId).ToList(), ct);
        if (applied.IsFailure)
            return applied.Error!;

        var wanted = applied.Value.Select(t => t.Id).ToHashSet();
        db.Set<NoteTemplateTag>().RemoveRange(current.Where(l => !wanted.Contains(l.NoteTagId)));
        var have = current.Select(l => l.NoteTagId).ToHashSet();
        db.Set<NoteTemplateTag>().AddRange(wanted.Where(w => !have.Contains(w)).Select(w => new NoteTemplateTag { NoteTemplateId = id, NoteTagId = w }));
        audit.Write(new AuditEntry { EventType = "NOTE_TEMPLATE_EDITED", ObjectType = ObjectType, ObjectId = NoteSupport.Id(id), MatterId = template.MatterId, Summary = template.Name });
        NoteSupport.TrackOriginalRowVersion(db, template, request.RowVersion);
        var saved = await SaveAsync(template, ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(id, ct);
    }

    public async Task<Result<NoteTemplateResponse>> DuplicateAsync(int id, DuplicateNoteTemplateRequest request, CancellationToken ct)
    {
        var source = await FindReadableAsync(id, tracked: false, ct);
        if (source is null)
            return NoteSupport.NotFound("Template");

        var firm = request.KeepFirmScope && source.ScopeCode == TemplateScope.Firm;
        if (firm && !currentUser.IsSystemAdmin)
            return Error.Forbidden("Firm-wide templates are changed by an administrator.", "FIRM_TEMPLATE_ADMIN_ONLY");

        int? matterId = null;
        if (!firm)
        {
            matterId = request.MatterId ?? source.MatterId;
            if (matterId is not { } m)
                return Error.Validation("matterId", "REQUIRED", "Choose the matter for the copy.");
            if (await access.FindVisibleMatterAsync(m, ct) is null)
                return Error.Validation("matterId", "NOT_FOUND", "Select a matter.");
        }

        var name = NoteSupport.Clean(request.Name) ?? $"{source.Name} (copy)";
        if (name.Length > 100)
            name = name[..100].TrimEnd();

        var copy = new NoteTemplate
        {
            ScopeCode = firm ? TemplateScope.Firm : TemplateScope.Matter,
            MatterId = matterId,
            Name = name,
            Description = source.Description,
            TitleTemplate = source.TitleTemplate,
            BodyHtml = source.BodyHtml,
        };
        var tagIds = await db.Set<NoteTemplateTag>().AsNoTracking().Where(l => l.NoteTemplateId == id).Select(l => l.NoteTagId).ToListAsync(ct);
        var tags = await db.Set<NoteTag>().AsNoTracking().Where(t => tagIds.Contains(t.Id) && t.IsActive).ToListAsync(ct);
        if (await NameTakenAsync(copy, exceptId: null, ct))
            return NoteSupport.Duplicate("name", $"A template named '{name}' already exists here.");

        db.Set<NoteTemplate>().Add(copy);
        audit.Write(new AuditEntry { EventType = "NOTE_TEMPLATE_CREATED", ObjectType = ObjectType, ObjectIdFactory = () => NoteSupport.Id(copy.Id), MatterId = matterId, Summary = $"{name} (copy of {source.Name})" });
        var saved = await SaveWithTagsAsync(copy, tags, ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(copy.Id, ct);
    }

    public async Task<Result> DeleteAsync(int id, string? rowVersion, CancellationToken ct)
    {
        var template = await FindReadableAsync(id, tracked: true, ct);
        if (template is null)
            return NoteSupport.NotFound("Template");
        var allowed = RequireWrite(template);
        if (allowed.IsFailure)
            return allowed;
        if (string.IsNullOrWhiteSpace(rowVersion))
            return Error.Validation("rowVersion", "REQUIRED", "rowVersion is required.");

        var version = NoteSupport.CheckRowVersion(template.RowVersion, rowVersion);
        if (version.IsFailure)
            return version.Error!;

        audit.Write(new AuditEntry { EventType = "NOTE_TEMPLATE_DELETED", ObjectType = ObjectType, ObjectId = NoteSupport.Id(id), MatterId = template.MatterId, Summary = template.Name });
        NoteSupport.TrackOriginalRowVersion(db, template, rowVersion);
        db.Set<NoteTemplate>().Remove(template);
        return await SaveAsync(template, ct);
    }

    /// <summary>Counts one use of the template (the client copies the text into a new note) and returns it.</summary>
    public async Task<Result<NoteTemplateResponse>> UseAsync(int id, CancellationToken ct)
    {
        var template = await FindReadableAsync(id, tracked: true, ct);
        if (template is null)
            return NoteSupport.NotFound("Template");

        // A counter, not an edit: no concurrency check and no "last changed" stamp, so two people using it at once both count.
        await db.Set<NoteTemplate>().Where(t => t.Id == id).ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedCount, t => t.UsedCount + 1), ct);
        db.ChangeTracker.Clear();
        return await GetAsync(id, ct);
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>A firm template is readable by everyone who reads notes; a matter template only when its matter is visible.</summary>
    private async Task<NoteTemplate?> FindReadableAsync(int id, bool tracked, CancellationToken ct)
    {
        var templates = tracked ? db.Set<NoteTemplate>() : db.Set<NoteTemplate>().AsNoTracking();
        var template = await templates.SingleOrDefaultAsync(t => t.Id == id, ct);
        if (template is null)
            return null;
        if (template.MatterId is { } matterId && !await access.CanSeeMatterAsync(matterId, ct))
            return null;
        return template;
    }

    private Result RequireWrite(NoteTemplate template) =>
        template.ScopeCode == TemplateScope.Firm && !currentUser.IsSystemAdmin
            ? Error.Forbidden("Firm-wide templates are changed by an administrator.", "FIRM_TEMPLATE_ADMIN_ONLY")
            : Result.Success();

    private async Task<Result<IReadOnlyList<NoteTag>>> ApplyAsync(NoteTemplate template, NoteTemplateInput input, IReadOnlyCollection<int> existingTags, CancellationToken ct)
    {
        var name = input.Name.Trim();
        if (name.Length == 0)
            return Error.Validation("name", "REQUIRED", "Enter a name.");

        var body = NoteContent.Process(input.BodyHtml);
        if (body.IsFailure)
            return body.Error!;

        var ids = (input.TagIds ?? []).Distinct().ToList();
        if (ids.Count > NoteService.MaxTags)
            return Error.Validation("tagIds", "TOO_MANY_TAGS", $"A template can offer at most {NoteService.MaxTags} tags.");
        var tags = ids.Count == 0 ? [] : await db.Set<NoteTag>().AsNoTracking().Where(t => ids.Contains(t.Id)).ToListAsync(ct);
        if (tags.Count != ids.Count)
            return Error.Validation("tagIds", "NOT_FOUND", "A tag no longer exists.");
        if (tags.FirstOrDefault(t => !t.IsActive && !existingTags.Contains(t.Id)) is { } inactive)
            return Error.Conflict("TAG_INACTIVE", $"The tag '{inactive.Name}' is no longer in use.");

        template.Name = name;
        template.Description = NoteSupport.Clean(input.Description);
        template.TitleTemplate = NoteSupport.Clean(input.TitleTemplate);
        template.BodyHtml = NoteContent.StripReferences(body.Value.Html);
        if (await NameTakenAsync(template, template.Id == 0 ? null : template.Id, ct))
            return NoteSupport.Duplicate("name", $"A template named '{name}' already exists here.");

        return Result<IReadOnlyList<NoteTag>>.Success(tags);
    }

    private Task<bool> NameTakenAsync(NoteTemplate t, int? exceptId, CancellationToken ct) =>
        db.Set<NoteTemplate>().AnyAsync(
            x => x.Name == t.Name && (exceptId == null || x.Id != exceptId)
                && (t.ScopeCode == TemplateScope.Firm ? x.ScopeCode == TemplateScope.Firm : x.MatterId == t.MatterId),
            ct);

    private async Task<Result> SaveWithTagsAsync(NoteTemplate template, IReadOnlyList<NoteTag> tags, CancellationToken ct)
    {
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await db.SaveChangesAsync(ct);
            db.Set<NoteTemplateTag>().AddRange(tags.Select(t => new NoteTemplateTag { NoteTemplateId = template.Id, NoteTagId = t.Id }));
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return Result.Success();
        }
        catch (DbUpdateException ex) when (NoteSupport.IsUniqueViolation(ex, "NoteTemplate"))
        {
            db.ChangeTracker.Clear();
            return NoteSupport.Duplicate("name", "A template with this name already exists here.");
        }
    }

    private async Task<Result> SaveAsync(NoteTemplate template, CancellationToken ct)
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
        catch (DbUpdateException ex) when (NoteSupport.IsUniqueViolation(ex, "NoteTemplate"))
        {
            db.ChangeTracker.Clear();
            return NoteSupport.Duplicate("name", $"A template named '{template.Name}' already exists here.");
        }
    }

    private async Task<IReadOnlyList<NoteTemplateResponse>> ToResponsesAsync(IReadOnlyList<NoteTemplate> rows, CancellationToken ct)
    {
        var tags = await access.TagsOfTemplatesAsync([.. rows.Select(r => r.Id)], ct);
        var names = await access.NamesAsync(rows.Select(r => r.ModifiedByUserId ?? r.CreatedByUserId), ct);
        return [.. rows.Select(t =>
        {
            var by = t.ModifiedByUserId ?? t.CreatedByUserId;
            return new NoteTemplateResponse(
                t.Id,
                t.ScopeCode,
                t.MatterId,
                t.Name,
                t.Description,
                t.TitleTemplate,
                t.BodyHtml,
                tags.GetValueOrDefault(t.Id) ?? [],
                t.UsedCount,
                t.ScopeCode == TemplateScope.Matter || currentUser.IsSystemAdmin,
                NoteSupport.Utc(t.ModifiedAtUtc ?? t.CreatedAtUtc),
                by,
                by is { } u && names.TryGetValue(u, out var n) ? n : null,
                NoteSupport.Encode(t.RowVersion));
        })];
    }
}
