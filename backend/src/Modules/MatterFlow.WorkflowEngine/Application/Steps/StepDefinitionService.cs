using System.ComponentModel.DataAnnotations;
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
/// <param name="RowVersion">Optimistic-concurrency token (base64).</param>
public sealed record StepDefinitionSummary(
    [property: Required] int StepDefinitionId,
    [property: Required] string Title,
    string? Description,
    string? DocumentationUrl,
    [property: Required] bool IsActive,
    [property: Required] int UsedInVersions,
    [property: Required] string RowVersion);

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
    internal static readonly string[] Keys = ["page", "pageSize", "q", "isActive"];

    /// <summary>Title or description fragment.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Filter by active state; omit for all.</summary>
    public bool? IsActive { get; init; }

    /// <summary>1-based page.</summary>
    public int? Page { get; init; }

    /// <summary>Page size (default 25, max 100).</summary>
    public int? PageSize { get; init; }
}

/// <summary>
/// The step library (baseline 9.2): CRUD without hard delete (deactivate instead, because published workflow versions refer to the step).
/// Callers are authorized with <c>Workflow.Manage</c> at the endpoint. Changes are audited by the Data layer (field level).
/// </summary>
public sealed class StepDefinitionService(DbContext db, IFormDefinitionResolver forms)
{
    public async Task<Result<PagedResult<StepDefinitionSummary>>> ListAsync(StepDefinitionListQuery query, CancellationToken ct)
    {
        var paging = PageRequest.Create(query.Page, query.PageSize);
        if (paging.IsFailure)
        {
            return paging.Error!;
        }

        var steps = db.Set<StepDefinition>().AsNoTracking();
        if (query.IsActive is { } active)
        {
            steps = steps.Where(s => s.IsActive == active);
        }

        var q = query.Q?.Trim();
        if (!string.IsNullOrEmpty(q))
        {
            steps = steps.Where(s => s.Title.Contains(q) || (s.Description != null && s.Description.Contains(q)));
        }

        var total = await steps.CountAsync(ct);
        var page = paging.Value;
        var rows = await steps
            .OrderBy(s => s.Title).ThenBy(s => s.Id)
            .Skip(page.Skip).Take(page.PageSize)
            .Select(s => new
            {
                Step = s,
                Used = db.Set<WorkflowVersionStep>().Count(v => v.SourceStepDefinitionId == s.Id),
            })
            .ToListAsync(ct);
        var items = rows.Select(r => ToSummary(r.Step, r.Used)).ToList();
        return new PagedResult<StepDefinitionSummary>(items, total, page.Page, page.PageSize);
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
        catch (DbUpdateException ex) when (WorkflowSupport.IsDuplicateKey(ex))
        {
            return DuplicateTitle(title);
        }

        return await ToDetailAsync(step, ct);
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

    private static StepDefinitionSummary ToSummary(StepDefinition s, int used) =>
        new(s.Id, s.Title, s.Description, s.DocumentationUrl, s.IsActive, used, WorkflowSupport.FormatRowVersion(s.RowVersion));

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
            WorkflowSupport.FormatRowVersion(step.RowVersion));
    }
}
