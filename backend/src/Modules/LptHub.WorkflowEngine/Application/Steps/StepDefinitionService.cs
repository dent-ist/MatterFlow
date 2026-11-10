using System.ComponentModel.DataAnnotations;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkflowEngine.Contracts;
using MatterFlow.WorkflowEngine.Domain;
using MatterFlow.WorkflowEngine.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkflowEngine.Application.Steps;

/// <summary>A library step in a list.</summary>
/// <param name="StepDefinitionId">Step id.</param>
/// <param name="Title">Title (unique among active steps).</param>
/// <param name="Description">Short description.</param>
/// <param name="DocumentationUrl">Optional documentation link.</param>
/// <param name="IsActive">False = hidden from new workflow drafts; published versions are untouched.</param>
/// <param name="UsedInVersions">Number of workflow versions (any status) that contain a copy of this step.</param>
/// <param name="UsedInWorkflows">Number of distinct workflows with a version (any status) that contains a copy of this step.</param>
/// <param name="Tags">The step's tags (display names) in the order they were entered.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64).</param>
/// <param name="PublishedFormVersionId">The published input form version a new workflow version would pin; null when the step has no published inputs.</param>
/// <param name="DraftFormFieldCount">Fields in the open input form draft (0 when there is none), the same number as on the detail.</param>
public sealed record StepDefinitionSummary(
    [property: Required] int StepDefinitionId,
    [property: Required] string Title,
    string? Description,
    string? DocumentationUrl,
    [property: Required] bool IsActive,
    [property: Required] int UsedInVersions,
    [property: Required] int UsedInWorkflows,
    [property: Required] IReadOnlyList<string> Tags,
    [property: Required] string RowVersion,
    int? PublishedFormVersionId = null,
    [property: Required] int DraftFormFieldCount = 0);

/// <summary>Counts of the whole step library for the health strip, independent of the list's filters and paging.</summary>
/// <param name="Total">All steps.</param>
/// <param name="Active">Active steps (the number on the tab).</param>
/// <param name="Inactive">Inactive steps.</param>
/// <param name="NotUsed">Active steps that no workflow version (any status) contains.</param>
/// <param name="InputsInDraft">Active steps whose input form has an open draft with at least one field (<c>draftFormFieldCount</c> above 0).</param>
public sealed record StepListSummary(
    [property: Required] int Total,
    [property: Required] int Active,
    [property: Required] int Inactive,
    [property: Required] int NotUsed,
    [property: Required] int InputsInDraft);

/// <summary>One page of the step list with the library-wide counts of the health strip.</summary>
/// <param name="Items">The steps of this page.</param>
/// <param name="Total">All steps matching the filters (not the library total: see <paramref name="Summary"/>).</param>
/// <param name="Page">1-based page.</param>
/// <param name="PageSize">Page size.</param>
/// <param name="Summary">Counts over all steps, ignoring every filter.</param>
public sealed record StepDefinitionListPage(
    [property: Required] IReadOnlyList<StepDefinitionSummary> Items,
    [property: Required] int Total,
    [property: Required] int Page,
    [property: Required] int PageSize,
    [property: Required] StepListSummary Summary);

/// <summary>An existing tag with the number of steps that carry it.</summary>
/// <param name="Name">Display name (the spelling of the first time the tag was entered).</param>
/// <param name="StepCount">Steps carrying the tag (limited to active or inactive steps when the request says so).</param>
public sealed record StepTagSummary(
    [property: Required] string Name,
    [property: Required] int StepCount);

/// <summary>Where a library step is used.</summary>
/// <param name="WorkflowDefinitionId">The workflow.</param>
/// <param name="WorkflowName">Its name.</param>
/// <param name="WorkflowVersionId">The version containing the copy.</param>
/// <param name="VersionNo">Its number.</param>
/// <param name="Status">Its status.</param>
public sealed record StepUsage(
    [property: Required] int WorkflowDefinitionId,
    [property: Required] string WorkflowName,
    [property: Required] int WorkflowVersionId,
    [property: Required] int VersionNo,
    [property: Required] WorkflowVersionStatus Status);

/// <summary>A library step with everything the editor needs.</summary>
/// <param name="StepDefinitionId">Step id.</param>
/// <param name="Title">Title.</param>
/// <param name="Description">Short description.</param>
/// <param name="Instructions">Detailed procedure (plain multi-line text).</param>
/// <param name="DocumentationUrl">Optional documentation link.</param>
/// <param name="IsActive">Active flag.</param>
/// <param name="FormDefinitionId">The step's input form (edit it with the form designer under <c>/api/v1/forms</c>); null only if it was never provisioned.</param>
/// <param name="PublishedFormVersionId">The published input form version a new workflow version would pin, if any.</param>
/// <param name="DraftFormFieldCount">Fields in the open form draft (0 when there is none).</param>
/// <param name="Usage">Workflow versions using the step, newest first.</param>
/// <param name="Tags">The step's tags (display names) in the order they were entered.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64).</param>
public sealed record StepDefinitionDetail(
    [property: Required] int StepDefinitionId,
    [property: Required] string Title,
    string? Description,
    string? Instructions,
    string? DocumentationUrl,
    [property: Required] bool IsActive,
    int? FormDefinitionId,
    int? PublishedFormVersionId,
    [property: Required] int DraftFormFieldCount,
    [property: Required] IReadOnlyList<StepUsage> Usage,
    [property: Required] IReadOnlyList<string> Tags,
    [property: Required] string RowVersion);

/// <summary>Body to create a library step. An empty input form is provisioned with it.</summary>
public sealed record CreateStepDefinitionRequest
{
    /// <summary>Title, unique among active steps.</summary>
    [Required, StringLength(200)]
    public required string Title { get; init; }

    /// <summary>Short description.</summary>
    [StringLength(1000)]
    public string? Description { get; init; }

    /// <summary>Detailed instructions.</summary>
    [StringLength(MaxInstructions)]
    public string? Instructions { get; init; }

    /// <summary>Optional http(s) documentation link.</summary>
    [StringLength(1000)]
    public string? DocumentationUrl { get; init; }

    /// <summary>
    /// Free-form tags (library metadata, not part of published workflow versions). Each is trimmed, inner whitespace collapsed, at most 40
    /// characters, no control characters; at most 20 per step; duplicates ignoring case keep the first spelling. Errors:
    /// <c>TAG_TOO_LONG</c>, <c>TOO_MANY_TAGS</c>, <c>TAG_INVALID</c>.
    /// </summary>
    public IReadOnlyList<string>? Tags { get; init; }

    /// <summary>Longest instructions text.</summary>
    public const int MaxInstructions = 20000;
}

/// <summary>Body to change a library step. Editing never changes published workflow versions.</summary>
public sealed record UpdateStepDefinitionRequest
{
    /// <summary>Title, unique among active steps.</summary>
    [Required, StringLength(200)]
    public required string Title { get; init; }

    /// <summary>Short description.</summary>
    [StringLength(1000)]
    public string? Description { get; init; }

    /// <summary>Detailed instructions.</summary>
    [StringLength(CreateStepDefinitionRequest.MaxInstructions)]
    public string? Instructions { get; init; }

    /// <summary>Optional http(s) documentation link.</summary>
    [StringLength(1000)]
    public string? DocumentationUrl { get; init; }

    /// <summary>Active flag; false hides the step from new workflow drafts.</summary>
    [Required]
    public required bool IsActive { get; init; }

    /// <summary>
    /// Replaces the tags (omit to leave them unchanged, send an empty list to remove all). Free-form tags (library metadata, not part of published workflow versions). Each is trimmed, inner whitespace collapsed, at most 40
    /// characters, no control characters; at most 20 per step; duplicates ignoring case keep the first spelling. Errors:
    /// <c>TAG_TOO_LONG</c>, <c>TOO_MANY_TAGS</c>, <c>TAG_INVALID</c>.
    /// </summary>
    public IReadOnlyList<string>? Tags { get; init; }

    /// <summary>The row version the client saw (base64).</summary>
    [Required]
    public required string RowVersion { get; init; }
}

/// <summary>Body of the activate/deactivate actions.</summary>
public sealed record StepActiveRequest
{
    /// <summary>The row version the client saw (base64).</summary>
    [Required]
    public required string RowVersion { get; init; }
}

/// <summary>Step library list filters.</summary>
public sealed class StepDefinitionListQuery
{
    internal static readonly string[] Keys = ["page", "pageSize", "q", "title", "description", "isActive", "sort", "tags", "tagMatch", "used"];

    /// <summary>Sort fields accepted by <see cref="Sort"/> (prefix with <c>-</c> for descending).</summary>
    internal static readonly string[] SortFields = ["title", "-title", "usedInVersions", "-usedInVersions", "usedInWorkflows", "-usedInWorkflows", "status", "-status"];

    /// <summary>One of <c>title</c> (default), <c>-title</c>, <c>usedInVersions</c>, <c>-usedInVersions</c>, <c>usedInWorkflows</c>, <c>-usedInWorkflows</c>, <c>status</c> (active first) or <c>-status</c> (inactive first).</summary>
    [StringLength(30)]
    public string? Sort { get; init; }

    /// <summary>Title, description or tag text fragment.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Column filter: fragment of the title only.</summary>
    [StringLength(200)]
    public string? Title { get; init; }

    /// <summary>Column filter: fragment of the description only.</summary>
    [StringLength(200)]
    public string? Description { get; init; }

    /// <summary>True: only steps used in at least one workflow version; false: only steps no workflow version uses.</summary>
    public bool? Used { get; init; }

    /// <summary>Only steps with these tags (case-insensitive); repeat the parameter for several. See <see cref="TagMatch"/>.</summary>
    public string[]? Tags { get; init; }

    /// <summary><c>all</c> (default): steps having every selected tag; <c>any</c>: steps having at least one.</summary>
    [StringLength(3)]
    public string? TagMatch { get; init; }

    /// <summary>Filter by active state; omit for all.</summary>
    public bool? IsActive { get; init; }

    /// <summary>1-based page.</summary>
    public int? Page { get; init; }

    /// <summary>Page size (default 25, max 100).</summary>
    public int? PageSize { get; init; }
}

/// <summary>Filters of the tag suggestions list.</summary>
public sealed class StepTagListQuery
{
    internal static readonly string[] Keys = ["q", "isActive", "limit"];

    /// <summary>Largest number of tags returned.</summary>
    public const int MaxLimit = 200;

    /// <summary>Tag text fragment (case-insensitive).</summary>
    [StringLength(100)]
    public string? Q { get; init; }

    /// <summary>Count only active (true) or only inactive (false) steps; omit for all steps.</summary>
    public bool? IsActive { get; init; }

    /// <summary>How many tags to return (default 50, max 200).</summary>
    public int? Limit { get; init; }
}

/// <summary>
/// The step library (baseline 9.2): CRUD without hard delete (deactivate instead, because published workflow versions refer to the step).
/// Callers are authorized with <c>Workflow.Manage</c> at the endpoint. Changes are audited by the Data layer (field level).
/// </summary>
public sealed class StepDefinitionService(DbContext db, IFormDefinitionResolver forms, IAuditWriter audit)
{
    public async Task<Result<StepDefinitionListPage>> ListAsync(StepDefinitionListQuery query, CancellationToken ct)
    {
        var paging = PageRequest.Create(query.Page, query.PageSize);
        if (paging.IsFailure)
        {
            return paging.Error!;
        }

        if (query.Sort is not null && !StepDefinitionListQuery.SortFields.Contains(query.Sort))
        {
            return Error.Validation("sort", "INVALID", $"sort must be one of: {string.Join(", ", StepDefinitionListQuery.SortFields)}.");
        }

        var steps = db.Set<StepDefinition>().AsNoTracking();
        if (query.IsActive is { } active)
        {
            steps = steps.Where(s => s.IsActive == active);
        }

        var q = query.Q?.Trim();
        if (!string.IsNullOrEmpty(q))
        {
            var tagLinks = db.Set<StepDefinitionTag>().AsNoTracking();
            steps = steps.Where(s =>
                s.Title.Contains(q)
                || (s.Description != null && s.Description.Contains(q))
                || tagLinks.Any(t => t.StepDefinitionId == s.Id && t.Tag.Key.Contains(q)));
        }

        // Column filters (each box searches its own column, parameterised Contains; % and _ are literal).
        if (query.Title?.Trim() is { Length: > 0 } titleFragment)
        {
            steps = steps.Where(s => s.Title.Contains(titleFragment));
        }

        if (query.Description?.Trim() is { Length: > 0 } descriptionFragment)
        {
            steps = steps.Where(s => s.Description != null && s.Description.Contains(descriptionFragment));
        }

        if (query.Used is { } used)
        {
            var uses = db.Set<WorkflowVersionStep>().AsNoTracking();
            steps = used
                ? steps.Where(s => uses.Any(v => v.SourceStepDefinitionId == s.Id))
                : steps.Where(s => !uses.Any(v => v.SourceStepDefinitionId == s.Id));
        }

        var tagMatch = query.TagMatch?.Trim().ToLowerInvariant();
        if (tagMatch is not (null or "" or "all" or "any"))
        {
            return Error.Validation("tagMatch", "INVALID", "tagMatch must be 'all' or 'any'.");
        }

        var wanted = FilterKeys(query.Tags);
        if (wanted.IsFailure)
        {
            return wanted.Error!;
        }

        if (wanted.Value.Count > 0)
        {
            var links = db.Set<StepDefinitionTag>().AsNoTracking();
            if (tagMatch == "any")
            {
                var keys = wanted.Value;
                steps = steps.Where(s => links.Any(t => t.StepDefinitionId == s.Id && keys.Contains(t.Tag.Key)));
            }
            else
            {
                // Match all: one EXISTS per selected tag (at most 20), each answered by the (StepTagId, StepDefinitionId) index.
                foreach (var key in wanted.Value)
                {
                    var k = key;
                    steps = steps.Where(s => links.Any(t => t.StepDefinitionId == s.Id && t.Tag.Key == k));
                }
            }
        }

        var total = await steps.CountAsync(ct);
        var page = paging.Value;
        var usages = db.Set<WorkflowVersionStep>().AsNoTracking();
        var versionsOfWorkflows = db.Set<WorkflowVersion>().AsNoTracking();
        var withUsage = steps.Select(s => new
        {
            Step = s,
            Used = usages.Count(v => v.SourceStepDefinitionId == s.Id),
            // Distinct workflows: a workflow with several versions of the step counts once.
            Workflows = versionsOfWorkflows
                .Where(wv => usages.Any(v => v.WorkflowVersionId == wv.Id && v.SourceStepDefinitionId == s.Id))
                .Select(wv => wv.WorkflowDefinitionId)
                .Distinct()
                .Count(),
        });
        var ordered = query.Sort switch
        {
            "-title" => withUsage.OrderByDescending(r => r.Step.Title).ThenBy(r => r.Step.Id),
            "usedInVersions" => withUsage.OrderBy(r => r.Used).ThenBy(r => r.Step.Title).ThenBy(r => r.Step.Id),
            "-usedInVersions" => withUsage.OrderByDescending(r => r.Used).ThenBy(r => r.Step.Title).ThenBy(r => r.Step.Id),
            "usedInWorkflows" => withUsage.OrderBy(r => r.Workflows).ThenBy(r => r.Step.Title).ThenBy(r => r.Step.Id),
            "-usedInWorkflows" => withUsage.OrderByDescending(r => r.Workflows).ThenBy(r => r.Step.Title).ThenBy(r => r.Step.Id),
            "status" => withUsage.OrderByDescending(r => r.Step.IsActive).ThenBy(r => r.Step.Title).ThenBy(r => r.Step.Id),
            "-status" => withUsage.OrderBy(r => r.Step.IsActive).ThenBy(r => r.Step.Title).ThenBy(r => r.Step.Id),
            _ => withUsage.OrderBy(r => r.Step.Title).ThenBy(r => r.Step.Id),
        };
        var rows = await ordered.Skip(page.Skip).Take(page.PageSize).ToListAsync(ct);
        var tagsByStep = await TagsOfAsync(rows.Select(r => r.Step.Id).ToList(), ct);
        var states = await forms.GetOwnerStatesAsync(FormOwnerKind.Step, [.. rows.Select(r => r.Step.Id)], ct);
        var items = rows.Select(r => ToSummary(r.Step, r.Used, r.Workflows, tagsByStep.GetValueOrDefault(r.Step.Id) ?? [], states.GetValueOrDefault(r.Step.Id))).ToList();
        return new StepDefinitionListPage(items, total, page.Page, page.PageSize, await ListSummaryAsync(ct));
    }

    /// <summary>The health-strip counts over the whole library (two statements: the steps with their usage flag, and the input form states; no filter applies).</summary>
    private async Task<StepListSummary> ListSummaryAsync(CancellationToken ct)
    {
        var usages = db.Set<WorkflowVersionStep>().AsNoTracking();
        var steps = await db.Set<StepDefinition>().AsNoTracking()
            .Select(s => new { s.Id, s.IsActive, Used = usages.Any(u => u.SourceStepDefinitionId == s.Id) })
            .ToListAsync(ct);
        var active = steps.Where(s => s.IsActive).ToList();
        IReadOnlyDictionary<int, FormOwnerState> states = active.Count == 0 ? new Dictionary<int, FormOwnerState>() : await forms.GetOwnerStatesAsync(FormOwnerKind.Step, null, ct);
        return new StepListSummary(
            steps.Count,
            active.Count,
            steps.Count - active.Count,
            active.Count(s => !s.Used),
            active.Count(s => states.TryGetValue(s.Id, out var state) && state.DraftFieldCount > 0));
    }

    /// <summary>Existing tags with the number of steps carrying each: prefix matches first, then the most used, then by name.</summary>
    public async Task<Result<IReadOnlyList<StepTagSummary>>> ListTagsAsync(StepTagListQuery query, CancellationToken ct)
    {
        var limit = query.Limit ?? 50;
        if (limit is < 1 or > StepTagListQuery.MaxLimit)
        {
            return Error.Validation("limit", "INVALID", $"limit must be between 1 and {StepTagListQuery.MaxLimit}.");
        }

        var links = db.Set<StepDefinitionTag>().AsNoTracking();
        if (query.IsActive is { } active)
        {
            var steps = db.Set<StepDefinition>().AsNoTracking();
            links = links.Where(l => steps.Any(s => s.Id == l.StepDefinitionId && s.IsActive == active));
        }

        var q = query.Q is null ? null : StepTagRules.KeyOf(string.Join(' ', query.Q.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)));
        var counted = links
            .GroupBy(l => new { l.Tag.Key, l.Tag.Name })
            .Select(g => new { g.Key.Key, g.Key.Name, Count = g.Count() });
        if (!string.IsNullOrEmpty(q))
        {
            counted = counted.Where(t => t.Key.Contains(q));
        }

        var rows = await counted
            .OrderBy(t => !string.IsNullOrEmpty(q) && t.Key.StartsWith(q) ? 0 : 1)
            .ThenByDescending(t => t.Count)
            .ThenBy(t => t.Key)
            .Take(limit)
            .ToListAsync(ct);
        return rows.Select(t => new StepTagSummary(t.Name, t.Count)).ToList();
    }

    public async Task<Result<StepDefinitionDetail>> GetAsync(int id, CancellationToken ct)
    {
        var step = await db.Set<StepDefinition>().AsNoTracking().SingleOrDefaultAsync(s => s.Id == id, ct);
        return step is null ? Error.NotFound($"Step {id} does not exist.") : await ToDetailAsync(step, ct);
    }

    public async Task<Result<StepDefinitionDetail>> CreateAsync(CreateStepDefinitionRequest request, CancellationToken ct)
    {
        var fields = Clean(request.Title, request.Description, request.Instructions, request.DocumentationUrl);
        if (fields.IsFailure)
        {
            return fields.Error!;
        }

        var tags = request.Tags is null ? null : StepTagRules.NormalizeAll(request.Tags);
        if (tags is { IsFailure: true })
        {
            return tags.Error!;
        }

        var f = fields.Value;
        if (await TitleTakenAsync(f.Title, null, ct))
        {
            return DuplicateTitle(f.Title);
        }

        await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        var step = new StepDefinition { Title = f.Title, Description = f.Description, Instructions = f.Instructions, DocumentationUrl = f.DocumentationUrl, IsActive = true };
        db.Set<StepDefinition>().Add(step);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (WorkflowSupport.IsDuplicateKey(ex))
        {
            return DuplicateTitle(f.Title);
        }

        // The step's input form (kind Step) is provisioned empty so the form designer can open it straight away.
        var form = await forms.EnsureDefinitionAsync(FormOwnerKind.Step, step.Id, ct);
        if (form.IsFailure)
        {
            return form.Error!;
        }

        if (tags is { Value.Count: > 0 })
        {
            try
            {
                await ApplyTagsAsync(step, tags.Value, ct);
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (WorkflowSupport.IsDuplicateKey(ex) || WorkflowSupport.IsForeignKey(ex))
            {
                return WorkflowSupport.Concurrency();
            }
        }

        if (tx is not null)
        {
            await tx.CommitAsync(ct);
        }

        return await ToDetailAsync(step, ct);
    }

    public async Task<Result<StepDefinitionDetail>> UpdateAsync(int id, UpdateStepDefinitionRequest request, CancellationToken ct)
    {
        var fields = Clean(request.Title, request.Description, request.Instructions, request.DocumentationUrl);
        if (fields.IsFailure)
        {
            return fields.Error!;
        }

        var tags = request.Tags is null ? null : StepTagRules.NormalizeAll(request.Tags);
        if (tags is { IsFailure: true })
        {
            return tags.Error!;
        }

        var step = await db.Set<StepDefinition>().SingleOrDefaultAsync(s => s.Id == id, ct);
        if (step is null)
        {
            return Error.NotFound($"Step {id} does not exist.");
        }

        if (WorkflowSupport.ExpectVersion(db, step, request.RowVersion) is { } stale)
        {
            return stale;
        }

        var f = fields.Value;
        if (request.IsActive && await TitleTakenAsync(f.Title, id, ct))
        {
            return DuplicateTitle(f.Title);
        }

        step.Title = f.Title;
        step.Description = f.Description;
        step.Instructions = f.Instructions;
        step.DocumentationUrl = f.DocumentationUrl;
        step.IsActive = request.IsActive;
        if (tags is not null && await ApplyTagsAsync(step, tags.Value, ct))
        {
            // A change of tags alone must still move the row version and the modified stamps (the step row itself did not change).
            db.Entry(step).Property(x => x.Title).IsModified = true;
        }

        return await SaveAsync(step, f.Title, ct);
    }

    /// <summary>Hides the step from new workflow drafts. Published workflow versions are not touched.</summary>
    public Task<Result<StepDefinitionDetail>> DeactivateAsync(int id, StepActiveRequest request, CancellationToken ct) => SetActiveAsync(id, false, request, ct);

    /// <summary>Makes the step available again (its title must not clash with another active step).</summary>
    public Task<Result<StepDefinitionDetail>> ActivateAsync(int id, StepActiveRequest request, CancellationToken ct) => SetActiveAsync(id, true, request, ct);

    private async Task<Result<StepDefinitionDetail>> SetActiveAsync(int id, bool active, StepActiveRequest request, CancellationToken ct)
    {
        var step = await db.Set<StepDefinition>().SingleOrDefaultAsync(s => s.Id == id, ct);
        if (step is null)
        {
            return Error.NotFound($"Step {id} does not exist.");
        }

        if (WorkflowSupport.ExpectVersion(db, step, request.RowVersion) is { } stale)
        {
            return stale;
        }

        if (active && await TitleTakenAsync(step.Title, id, ct))
        {
            return DuplicateTitle(step.Title);
        }

        step.IsActive = active;
        return await SaveAsync(step, step.Title, ct);
    }

    private async Task<Result<StepDefinitionDetail>> SaveAsync(StepDefinition step, string title, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return WorkflowSupport.Concurrency();
        }
        catch (DbUpdateException ex) when (WorkflowSupport.IsDuplicateOf(ex, WorkflowConstraints.StepTitle))
        {
            return DuplicateTitle(title);
        }
        catch (DbUpdateException ex) when (WorkflowSupport.IsDuplicateKey(ex) || WorkflowSupport.IsForeignKey(ex))
        {
            // Another administrator added or removed the same tag at the same moment.
            return WorkflowSupport.Concurrency();
        }

        return await ToDetailAsync(step, ct);
    }

    /// <summary>
    /// Makes the step's tags exactly <paramref name="wanted"/> (order included): links that are gone are removed, new tags are created
    /// (an existing tag keeps its display spelling, so "relativity" and "Relativity" stay one tag), and a tag no step carries any more is
    /// deleted. Queues one audit entry (field <c>Tags</c>) with the old and new lists. Returns false when nothing changed.
    /// </summary>
    private async Task<bool> ApplyTagsAsync(StepDefinition step, IReadOnlyList<NormalizedTag> wanted, CancellationToken ct)
    {
        var current = await db.Set<StepDefinitionTag>().Include(l => l.Tag).Where(l => l.StepDefinitionId == step.Id).OrderBy(l => l.SortOrder).ToListAsync(ct);
        if (current.Select(l => l.Tag.Key).SequenceEqual(wanted.Select(w => w.Key)))
        {
            return false;
        }

        var wantedKeys = wanted.Select(w => w.Key).ToList();
        var known = await db.Set<StepTag>().Where(t => wantedKeys.Contains(t.Key)).ToDictionaryAsync(t => t.Key, ct);
        var existingLinks = current.ToDictionary(l => l.Tag.Key);

        foreach (var link in current.Where(l => !wantedKeys.Contains(l.Tag.Key)).ToList())
        {
            db.Set<StepDefinitionTag>().Remove(link);
            var stillUsed = await db.Set<StepDefinitionTag>().AnyAsync(l => l.StepTagId == link.StepTagId && l.StepDefinitionId != step.Id, ct);
            if (!stillUsed)
            {
                db.Set<StepTag>().Remove(link.Tag);
            }
        }

        for (var i = 0; i < wanted.Count; i++)
        {
            if (existingLinks.TryGetValue(wanted[i].Key, out var link))
            {
                link.SortOrder = i;
                continue;
            }

            if (!known.TryGetValue(wanted[i].Key, out var tag))
            {
                tag = new StepTag { Key = wanted[i].Key, Name = wanted[i].Name };
                db.Set<StepTag>().Add(tag);
                known[tag.Key] = tag;
            }

            db.Set<StepDefinitionTag>().Add(new StepDefinitionTag { StepDefinitionId = step.Id, Tag = tag, SortOrder = i });
        }

        var oldNames = current.Select(l => l.Tag.Name).ToList();
        var newNames = wanted.Select(w => known[w.Key].Name).ToList();
        audit.Write(new AuditEntry
        {
            EventType = AuditEventTypes.FieldChanged,
            ObjectType = "StepDefinition",
            ObjectId = step.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            FieldKey = "Tags",
            OldValue = oldNames.Count == 0 ? null : string.Join(", ", oldNames),
            NewValue = newNames.Count == 0 ? null : string.Join(", ", newNames),
            Summary = "Tags changed",
        });
        return true;
    }

    private static Result<IReadOnlyList<string>> FilterKeys(string[]? tags)
    {
        var keys = new List<string>();
        foreach (var raw in tags ?? [])
        {
            // A filter value that is not a valid tag (blank, too long) simply matches nothing; blank ones are ignored.
            var text = string.Join(' ', (raw ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
            if (text.Length == 0)
            {
                continue;
            }

            var key = StepTagRules.KeyOf(text);
            if (!keys.Contains(key))
            {
                keys.Add(key);
            }
        }

        return keys.Count > StepTagRules.MaxPerStep
            ? Error.Validation("tags", ErrorCodes.TooManyTags, $"Filter by at most {StepTagRules.MaxPerStep} tags.", ErrorCodes.TooManyTags)
            : keys;
    }

    private async Task<Dictionary<int, List<string>>> TagsOfAsync(IReadOnlyCollection<int> stepIds, CancellationToken ct)
    {
        if (stepIds.Count == 0)
        {
            return [];
        }

        var rows = await db.Set<StepDefinitionTag>().AsNoTracking()
            .Where(l => stepIds.Contains(l.StepDefinitionId))
            .OrderBy(l => l.StepDefinitionId).ThenBy(l => l.SortOrder)
            .Select(l => new { l.StepDefinitionId, l.Tag.Name })
            .ToListAsync(ct);
        return rows.GroupBy(r => r.StepDefinitionId).ToDictionary(g => g.Key, g => g.Select(r => r.Name).ToList());
    }

    private Task<bool> TitleTakenAsync(string title, int? exceptId, CancellationToken ct) =>
        db.Set<StepDefinition>().AnyAsync(s => s.IsActive && s.Title == title && (exceptId == null || s.Id != exceptId), ct);

    private static Error DuplicateTitle(string title) => WorkflowSupport.Duplicate("title", $"An active step titled '{title}' exists.");

    private static Result<(string Title, string? Description, string? Instructions, string? DocumentationUrl)> Clean(
        string? title,
        string? description,
        string? instructions,
        string? url)
    {
        var t = WorkflowSupport.RequiredText(title, "title", "Enter a title.", 200);
        if (t.IsFailure)
        {
            return t.Error!;
        }

        var d = WorkflowSupport.OptionalText(description, "description", 1000);
        if (d.IsFailure)
        {
            return d.Error!;
        }

        var i = WorkflowSupport.OptionalText(instructions, "instructions", CreateStepDefinitionRequest.MaxInstructions);
        if (i.IsFailure)
        {
            return i.Error!;
        }

        var u = WorkflowSupport.OptionalUrl(url, "documentationUrl", 1000);
        if (u.IsFailure)
        {
            return u.Error!;
        }

        return (t.Value, d.Value, i.Value, u.Value);
    }

    private static StepDefinitionSummary ToSummary(StepDefinition s, int used, int workflows, IReadOnlyList<string> tags, FormOwnerState? form) =>
        new(s.Id, s.Title, s.Description, s.DocumentationUrl, s.IsActive, used, workflows, tags, WorkflowSupport.FormatRowVersion(s.RowVersion), form?.Published?.FormVersionId, form?.DraftFieldCount ?? 0);

    private async Task<StepDefinitionDetail> ToDetailAsync(StepDefinition step, CancellationToken ct)
    {
        var state = await forms.GetOwnerStateAsync(FormOwnerKind.Step, step.Id, ct);
        var usage = await (
            from v in db.Set<WorkflowVersionStep>().AsNoTracking()
            where v.SourceStepDefinitionId == step.Id
            join wv in db.Set<WorkflowVersion>().AsNoTracking() on v.WorkflowVersionId equals wv.Id
            join wd in db.Set<WorkflowDefinition>().AsNoTracking() on wv.WorkflowDefinitionId equals wd.Id
            orderby wd.Name, wv.VersionNo descending
            select new StepUsage(wd.Id, wd.Name, wv.Id, wv.VersionNo, wv.Status)).ToListAsync(ct);
        return new StepDefinitionDetail(
            step.Id,
            step.Title,
            step.Description,
            step.Instructions,
            step.DocumentationUrl,
            step.IsActive,
            state.FormDefinitionId,
            state.Published?.FormVersionId,
            state.DraftFieldCount,
            usage,
            (await TagsOfAsync([step.Id], ct)).GetValueOrDefault(step.Id) ?? [],
            WorkflowSupport.FormatRowVersion(step.RowVersion));
    }
}
