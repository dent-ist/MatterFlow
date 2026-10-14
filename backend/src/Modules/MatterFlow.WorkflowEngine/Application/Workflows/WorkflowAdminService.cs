using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkflowEngine.Contracts;
using MatterFlow.WorkflowEngine.Domain;
using MatterFlow.WorkflowEngine.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkflowEngine.Application.Workflows;

/// <summary>
/// Workflow definitions and their versions (architecture 8.1): create, edit a draft, publish (validated, snapshotting the library steps),
/// retire, discard. A version that is not a draft is never edited; changing a published workflow means editing a new draft.
/// Designing operations need <c>Workflow.Manage</c>; reading a published or retired version needs only what the endpoint requires.
/// </summary>
public sealed class WorkflowAdminService(
    DbContext db,
    IFormDefinitionResolver forms,
    IPermissionChecker permissions,
    ICurrentUser currentUser,
    IClock clock,
    IAuditWriter audit)
{
    private const int MaxSteps = 200;
    private const string ObjectType = nameof(WorkflowDefinition);

    // ---- workflows

    public async Task<Result<PagedResult<WorkflowSummary>>> ListAsync(WorkflowListQuery query, CancellationToken ct)
    {
        var paging = PageRequest.Create(query.Page, query.PageSize);
        if (paging.IsFailure)
        {
            return paging.Error!;
        }

        var workflows = db.Set<WorkflowDefinition>().AsNoTracking();
        if (query.IsActive is { } active)
        {
            workflows = workflows.Where(w => w.IsActive == active);
        }

        var q = query.Q?.Trim();
        if (!string.IsNullOrEmpty(q))
        {
            workflows = workflows.Where(w => w.Name.Contains(q) || (w.Description != null && w.Description.Contains(q)));
        }

        var total = await workflows.CountAsync(ct);
        var page = paging.Value;
        var defs = await workflows.OrderBy(w => w.Name).ThenBy(w => w.Id).Skip(page.Skip).Take(page.PageSize).ToListAsync(ct);
        var items = await SummariesAsync(defs, ct);
        return new PagedResult<WorkflowSummary>(items, total, page.Page, page.PageSize);
    }

    public async Task<Result<WorkflowDetail>> GetAsync(int id, CancellationToken ct)
    {
        var definition = await db.Set<WorkflowDefinition>().AsNoTracking().SingleOrDefaultAsync(w => w.Id == id, ct);
        return definition is null ? NotFound(id) : await ReadDetailAsync(definition, ct);
    }

    public async Task<Result<WorkflowDetail>> CreateAsync(CreateWorkflowRequest request, CancellationToken ct)
    {
        var name = WorkflowSupport.RequiredText(request.Name, "name", "Enter a name.", 200);
        if (name.IsFailure)
        {
            return name.Error!;
        }

        var description = WorkflowSupport.OptionalText(request.Description, "description", 1000);
        if (description.IsFailure)
        {
            return description.Error!;
        }

        if (await db.Set<WorkflowDefinition>().AnyAsync(w => w.Name == name.Value, ct))
        {
            return DuplicateName(name.Value);
        }

        await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        var definition = new WorkflowDefinition { Name = name.Value, Description = description.Value, IsActive = true };
        db.Set<WorkflowDefinition>().Add(definition);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (WorkflowSupport.IsDuplicateKey(ex))
        {
            return DuplicateName(name.Value);
        }

        var draft = new WorkflowVersion { WorkflowDefinitionId = definition.Id, VersionNo = 1, Status = WorkflowVersionStatus.Draft, IsOrdered = request.IsOrdered };
        db.Set<WorkflowVersion>().Add(draft);
        audit.Write(new AuditEntry
        {
            EventType = "WORKFLOW_DRAFT_CREATED",
            ObjectType = ObjectType,
            ObjectId = WorkflowSupport.Text(definition.Id),
            Summary = "v1",
        });
        await db.SaveChangesAsync(ct);
        if (tx is not null)
        {
            await tx.CommitAsync(ct);
        }

        return await ReadDetailAsync(definition, ct);
    }

    public async Task<Result<WorkflowDetail>> UpdateAsync(int id, UpdateWorkflowRequest request, CancellationToken ct)
    {
        var name = WorkflowSupport.RequiredText(request.Name, "name", "Enter a name.", 200);
        if (name.IsFailure)
        {
            return name.Error!;
        }

        var description = WorkflowSupport.OptionalText(request.Description, "description", 1000);
        if (description.IsFailure)
        {
            return description.Error!;
        }

        var definition = await db.Set<WorkflowDefinition>().SingleOrDefaultAsync(w => w.Id == id, ct);
        if (definition is null)
        {
            return NotFound(id);
        }

        if (WorkflowSupport.ExpectVersion(db, definition, request.RowVersion) is { } stale)
        {
            return stale;
        }

        if (await db.Set<WorkflowDefinition>().AnyAsync(w => w.Name == name.Value && w.Id != id, ct))
        {
            return DuplicateName(name.Value);
        }

        definition.Name = name.Value;
        definition.Description = description.Value;
        definition.IsActive = request.IsActive;
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
            return DuplicateName(name.Value);
        }

        return await ReadDetailAsync(definition, ct);
    }

    // ---- reading versions

    /// <summary>A version with its steps. A draft needs the design permission; published and retired versions are readable by the endpoint's audience.</summary>
    public async Task<Result<WorkflowVersionDetail>> GetVersionAsync(int workflowId, int versionId, CancellationToken ct)
    {
        var version = await db.Set<WorkflowVersion>().AsNoTracking().SingleOrDefaultAsync(v => v.Id == versionId && v.WorkflowDefinitionId == workflowId, ct);
        if (version is null)
        {
            return Error.NotFound($"Version {versionId} is not a version of workflow {workflowId}.");
        }

        if (version.Status == WorkflowVersionStatus.Draft && permissions.Require(Permissions.Workflow.Manage) is { IsFailure: true } denied)
        {
            return Result<WorkflowVersionDetail>.Failure(denied.Error!);
        }

        return await ReadVersionAsync(version, ct);
    }

    // ---- drafts

    /// <summary>Starts the workflow's draft by copying a version (default: the published one, else the newest).</summary>
    public async Task<Result<WorkflowVersionDetail>> CreateDraftAsync(int workflowId, CreateWorkflowDraftRequest request, CancellationToken ct)
    {
        if (await db.Set<WorkflowDefinition>().AnyAsync(w => w.Id == workflowId, ct) is false)
        {
            return NotFound(workflowId);
        }

        var versions = await db.Set<WorkflowVersion>().AsNoTracking()
            .Where(v => v.WorkflowDefinitionId == workflowId)
            .Select(v => new { v.Id, v.VersionNo, v.Status, v.IsOrdered })
            .ToListAsync(ct);
        if (versions.FirstOrDefault(v => v.Status == WorkflowVersionStatus.Draft) is { } open)
        {
            return DraftExists(open.Id);
        }

        var source = request.FromVersionId is { } requested
            ? versions.FirstOrDefault(v => v.Id == requested)
            : versions.FirstOrDefault(v => v.Status == WorkflowVersionStatus.Published) ?? versions.OrderByDescending(v => v.VersionNo).FirstOrDefault();
        if (request.FromVersionId is not null && source is null)
        {
            return Error.Validation("fromVersionId", "NOT_FOUND", $"Version {request.FromVersionId} is not a version of this workflow.");
        }

        var sourceSteps = source is null
            ? []
            : await db.Set<WorkflowVersionStep>().AsNoTracking().Where(s => s.WorkflowVersionId == source.Id).OrderBy(s => s.SequenceNo).ToListAsync(ct);

        await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        var draft = new WorkflowVersion
        {
            WorkflowDefinitionId = workflowId,
            VersionNo = (versions.Count == 0 ? 0 : versions.Max(v => v.VersionNo)) + 1,
            Status = WorkflowVersionStatus.Draft,
            IsOrdered = source?.IsOrdered ?? true,
        };
        db.Set<WorkflowVersion>().Add(draft);
        audit.Write(new AuditEntry
        {
            EventType = "WORKFLOW_DRAFT_CREATED",
            ObjectType = ObjectType,
            ObjectId = WorkflowSupport.Text(workflowId),
            Summary = $"v{draft.VersionNo}" + (source is null ? string.Empty : $" from version {source.VersionNo}"),
        });
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (WorkflowSupport.IsDuplicateKey(ex))
        {
            return Error.Conflict(ErrorCodes.WorkflowDraftExists, "The workflow already has a draft.");
        }

        db.Set<WorkflowVersionStep>().AddRange(sourceSteps.Select(s => new WorkflowVersionStep
        {
            WorkflowVersionId = draft.Id,
            SequenceNo = s.SequenceNo,
            SourceStepDefinitionId = s.SourceStepDefinitionId,
            Title = s.Title,
            Description = s.Description,
            Instructions = s.Instructions,
            DocumentationUrl = s.DocumentationUrl,
            StepFormVersionId = s.StepFormVersionId,
            IsSkippable = s.IsSkippable,
            SkipCommentRequired = s.SkipCommentRequired,
        }));
        await db.SaveChangesAsync(ct);
        if (tx is not null)
        {
            await tx.CommitAsync(ct);
        }

        return await ReadVersionAsync(draft, ct);
    }

    /// <summary>
    /// Replaces the content of a draft with the given ordered placements. A step already in the draft keeps its copied content; a newly
    /// added step is copied from the library as it is now (and must be active). Any other status is WORKFLOW_VERSION_IMMUTABLE.
    /// </summary>
    public async Task<Result<WorkflowVersionDetail>> SaveDraftAsync(int workflowId, int versionId, SaveWorkflowDraftRequest request, CancellationToken ct)
    {
        var loaded = await LoadVersionAsync(workflowId, versionId, ct);
        if (loaded.IsFailure)
        {
            return Result<WorkflowVersionDetail>.Failure(loaded.Error!);
        }

        var version = loaded.Value;
        if (version.Status != WorkflowVersionStatus.Draft)
        {
            return Immutable(version);
        }

        if (WorkflowSupport.ExpectVersion(db, version, request.RowVersion) is { } stale)
        {
            return stale;
        }

        if (request.Steps.Count > MaxSteps)
        {
            return Error.Validation("steps", "TOO_MANY", $"A workflow has at most {MaxSteps} steps.");
        }

        var shape = CheckPlacements(request.Steps);
        if (shape is not null)
        {
            return shape;
        }

        var ids = request.Steps.Select(p => p.SourceStepDefinitionId).ToList();
        var library = await db.Set<StepDefinition>().AsNoTracking().Where(s => ids.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        var existing = version.Steps.ToDictionary(s => s.SourceStepDefinitionId);
        var rows = new List<WorkflowVersionStep>();
        for (var i = 0; i < request.Steps.Count; i++)
        {
            var placement = request.Steps[i];
            var key = $"steps[{i}].sourceStepDefinitionId";
            if (!library.TryGetValue(placement.SourceStepDefinitionId, out var step))
            {
                return Error.Validation(key, "NOT_FOUND", $"Step {placement.SourceStepDefinitionId} does not exist.");
            }

            var row = new WorkflowVersionStep
            {
                WorkflowVersionId = versionId,
                SequenceNo = i + 1,
                SourceStepDefinitionId = step.Id,
                IsSkippable = placement.IsSkippable,
                SkipCommentRequired = placement.SkipCommentRequired,
            };
            if (existing.TryGetValue(step.Id, out var current))
            {
                row.Title = current.Title;
                row.Description = current.Description;
                row.Instructions = current.Instructions;
                row.DocumentationUrl = current.DocumentationUrl;
                row.StepFormVersionId = current.StepFormVersionId;
            }
            else
            {
                if (!step.IsActive)
                {
                    return Error.Validation(key, "STEP_INACTIVE", $"'{step.Title}' is deactivated and cannot be added to a workflow.");
                }

                var form = await forms.GetOwnerStateAsync(FormOwnerKind.Step, step.Id, ct);
                row.Title = step.Title;
                row.Description = step.Description;
                row.Instructions = step.Instructions;
                row.DocumentationUrl = step.DocumentationUrl;
                row.StepFormVersionId = form.Published?.FormVersionId;
            }

            rows.Add(row);
        }

        // A SQL Server deadlock (error 1205) rolls the transaction back and is safe to repeat: the unit of work is run once more from a clean
        // change tracker. The audit entry is queued only once: a failed save puts it back in the buffer, so the retry must not add it again.
        var auditQueued = false;
        for (var attempt = 1; ; attempt++)
        {
            await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
            try
            {
                version.IsOrdered = request.IsOrdered;
                db.Entry(version).State = EntityState.Modified; // always touch the row so the row version moves for concurrent editors
                db.Set<WorkflowVersionStep>().RemoveRange(version.Steps.ToList());
                await db.SaveChangesAsync(ct);
                if (!auditQueued)
                {
                    audit.Write(new AuditEntry
                    {
                        EventType = "WORKFLOW_DRAFT_SAVED",
                        ObjectType = ObjectType,
                        ObjectId = WorkflowSupport.Text(workflowId),
                        Summary = $"v{version.VersionNo}: {rows.Count} step(s), {(request.IsOrdered ? "ordered" : "unordered")}",
                    });
                    auditQueued = true;
                }

                db.Set<WorkflowVersionStep>().AddRange(rows);
                await db.SaveChangesAsync(ct);
                if (tx is not null)
                {
                    await tx.CommitAsync(ct);
                }

                break;
            }
            catch (DbUpdateConcurrencyException)
            {
                return WorkflowSupport.Concurrency();
            }
            catch (Exception ex) when (attempt == 1 && tx is not null && WorkflowSupport.IsDeadlock(ex))
            {
                await tx.RollbackAsync(CancellationToken.None);
                db.ChangeTracker.Clear();
                var reloaded = await LoadVersionAsync(workflowId, versionId, ct);
                if (reloaded.IsFailure)
                {
                    return Result<WorkflowVersionDetail>.Failure(reloaded.Error!);
                }

                version = reloaded.Value;
                if (version.Status != WorkflowVersionStatus.Draft)
                {
                    return Immutable(version);
                }

                if (WorkflowSupport.ExpectVersion(db, version, request.RowVersion) is { } changed)
                {
                    return changed;
                }

                foreach (var row in rows)
                {
                    row.Id = 0;
                }
            }
        }

        return await ReadVersionAsync(version, ct);
    }

    /// <summary>Deletes an open draft and its steps. Published and retired versions are never deleted.</summary>
    public async Task<Result> DiscardDraftAsync(int workflowId, int versionId, CancellationToken ct)
    {
        var loaded = await LoadVersionAsync(workflowId, versionId, ct);
        if (loaded.IsFailure)
        {
            return Result.Failure(loaded.Error!);
        }

        var version = loaded.Value;
        if (version.Status != WorkflowVersionStatus.Draft)
        {
            return Immutable(version);
        }

        db.Set<WorkflowVersionStep>().RemoveRange(version.Steps.ToList());
        db.Set<WorkflowVersion>().Remove(version);
        audit.Write(new AuditEntry
        {
            EventType = "WORKFLOW_DRAFT_DISCARDED",
            ObjectType = ObjectType,
            ObjectId = WorkflowSupport.Text(workflowId),
            Summary = $"v{version.VersionNo}",
        });
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    // ---- publish and retire

    /// <summary>
    /// Publishes the draft atomically: validates it, retires the current published version, re-copies every step from the library as it is
    /// now and pins its published input form version, then marks the draft PUBLISHED. Existing tasks stay on the versions they were created with.
    /// </summary>
    public async Task<Result<WorkflowVersionDetail>> PublishAsync(int workflowId, int versionId, WorkflowVersionActionRequest request, CancellationToken ct)
    {
        var loaded = await LoadVersionAsync(workflowId, versionId, ct);
        if (loaded.IsFailure)
        {
            return Result<WorkflowVersionDetail>.Failure(loaded.Error!);
        }

        var version = loaded.Value;
        if (version.Status != WorkflowVersionStatus.Draft)
        {
            return Immutable(version);
        }

        if (WorkflowSupport.ExpectVersion(db, version, request.RowVersion) is { } stale)
        {
            return stale;
        }

        var ids = version.Steps.Select(s => s.SourceStepDefinitionId).ToList();
        var library = await db.Set<StepDefinition>().AsNoTracking().Where(s => ids.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        var formStates = new Dictionary<int, FormOwnerState>();
        var candidates = new List<PublishCandidateStep>();
        foreach (var row in version.Steps.OrderBy(s => s.SequenceNo))
        {
            var step = library[row.SourceStepDefinitionId];
            var form = await forms.GetOwnerStateAsync(FormOwnerKind.Step, step.Id, ct);
            formStates[step.Id] = form;
            var readiness = form.Published is not null
                ? StepFormReadiness.Published
                : form.DraftFieldCount > 0 ? StepFormReadiness.DraftOnly : StepFormReadiness.Empty;
            candidates.Add(new PublishCandidateStep(row.SequenceNo, step.Id, step.Title, row.IsSkippable, row.SkipCommentRequired, readiness));
        }

        var issues = WorkflowPublishValidator.Validate(candidates);
        if (issues.Count > 0)
        {
            return PublishFailed(issues);
        }

        await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            var current = await db.Set<WorkflowVersion>().SingleOrDefaultAsync(v => v.WorkflowDefinitionId == workflowId && v.Status == WorkflowVersionStatus.Published, ct);
            if (current is not null)
            {
                // Retire first: only one PUBLISHED version may exist at any moment (filtered unique index).
                current.Status = WorkflowVersionStatus.Retired;
                audit.Write(new AuditEntry { EventType = "WORKFLOW_RETIRED", ObjectType = ObjectType, ObjectId = WorkflowSupport.Text(workflowId), Summary = $"v{current.VersionNo} superseded" });
                await db.SaveChangesAsync(ct);
            }

            // Snapshot: the content as the library has it right now (editing the library later never reaches this version).
            foreach (var row in version.Steps)
            {
                var step = library[row.SourceStepDefinitionId];
                row.Title = step.Title;
                row.Description = step.Description;
                row.Instructions = step.Instructions;
                row.DocumentationUrl = step.DocumentationUrl;
                row.StepFormVersionId = formStates[step.Id].Published?.FormVersionId;
            }

            await db.SaveChangesAsync(ct);

            version.Status = WorkflowVersionStatus.Published;
            version.PublishedAt = clock.UtcNow;
            version.PublishedByUserId = currentUser.UserId;
            audit.Write(new AuditEntry
            {
                EventType = "WORKFLOW_PUBLISHED",
                ObjectType = ObjectType,
                ObjectId = WorkflowSupport.Text(workflowId),
                Summary = $"v{version.VersionNo}: {version.Steps.Count} step(s)",
            });
            await db.SaveChangesAsync(ct);
            if (tx is not null)
            {
                await tx.CommitAsync(ct);
            }
        }
        catch (DbUpdateConcurrencyException)
        {
            return WorkflowSupport.Concurrency();
        }
        catch (DbUpdateException ex) when (WorkflowSupport.IsDuplicateKey(ex))
        {
            return WorkflowSupport.Concurrency("Another version was published at the same time. Reload and try again.");
        }

        return await ReadVersionAsync(version, ct);
    }

    /// <summary>Retires the published version: new tasks can no longer use the workflow until another version is published. Existing tasks are unaffected.</summary>
    public async Task<Result<WorkflowVersionDetail>> RetireAsync(int workflowId, int versionId, WorkflowVersionActionRequest request, CancellationToken ct)
    {
        var loaded = await LoadVersionAsync(workflowId, versionId, ct);
        if (loaded.IsFailure)
        {
            return Result<WorkflowVersionDetail>.Failure(loaded.Error!);
        }

        var version = loaded.Value;
        if (version.Status != WorkflowVersionStatus.Published)
        {
            return Error.Conflict(ErrorCodes.InvalidStatusTransition, "Only the published version can be retired.");
        }

        if (WorkflowSupport.ExpectVersion(db, version, request.RowVersion) is { } stale)
        {
            return stale;
        }

        version.Status = WorkflowVersionStatus.Retired;
        audit.Write(new AuditEntry { EventType = "WORKFLOW_RETIRED", ObjectType = ObjectType, ObjectId = WorkflowSupport.Text(workflowId), Summary = $"v{version.VersionNo}" });
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return WorkflowSupport.Concurrency();
        }

        return await ReadVersionAsync(version, ct);
    }

    // ---- helpers

    private async Task<Result<WorkflowVersion>> LoadVersionAsync(int workflowId, int versionId, CancellationToken ct)
    {
        var denied = permissions.Require(Permissions.Workflow.Manage);
        if (denied.IsFailure)
        {
            return Result<WorkflowVersion>.Failure(denied.Error!);
        }

        var version = await db.Set<WorkflowVersion>().Include(v => v.Steps).SingleOrDefaultAsync(v => v.Id == versionId && v.WorkflowDefinitionId == workflowId, ct);
        return version is null ? Error.NotFound($"Version {versionId} is not a version of workflow {workflowId}.") : version;
    }

    private static Error? CheckPlacements(IReadOnlyList<WorkflowStepPlacement> steps)
    {
        var seen = new HashSet<int>();
        for (var i = 0; i < steps.Count; i++)
        {
            if (!seen.Add(steps[i].SourceStepDefinitionId))
            {
                return Error.Validation($"steps[{i}].sourceStepDefinitionId", "DUPLICATE_STEP", "A step can be in a workflow only once.");
            }

            if (steps[i].SkipCommentRequired && !steps[i].IsSkippable)
            {
                return Error.Validation($"steps[{i}].skipCommentRequired", "SKIP_COMMENT_REQUIRES_SKIPPABLE", "A skip comment can only be required when the step is skippable.");
            }
        }

        return null;
    }

    private static Error PublishFailed(IReadOnlyList<PublishIssue> issues)
    {
        var fieldErrors = issues
            .GroupBy(i => i.SequenceNo is { } n ? $"steps[{n}]" : "steps", StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<FieldError>)[.. g.Select(i => new FieldError(i.Code, i.Message))]);
        return new Error(
            ErrorType.Validation,
            ErrorCodes.PublishValidationFailed,
            $"The workflow cannot be published: {issues.Count} problem(s).",
            fieldErrors);
    }

    private static Error Immutable(WorkflowVersion version) =>
        Error.Conflict(ErrorCodes.WorkflowVersionImmutable, $"Version {version.VersionNo} is {version.Status.ToString().ToUpperInvariant()} and cannot be changed. Create a new draft instead.");

    private static Error DraftExists(int draftVersionId) =>
        Error.Conflict(ErrorCodes.WorkflowDraftExists, "The workflow already has a draft.", new Dictionary<string, object?> { ["draftVersionId"] = draftVersionId });

    private static Error DuplicateName(string name) => WorkflowSupport.Duplicate("name", $"A workflow named '{name}' exists.");

    private static Error NotFound(int id) => Error.NotFound($"Workflow {id} does not exist.");

    private async Task<WorkflowDetail> ReadDetailAsync(WorkflowDefinition definition, CancellationToken ct)
    {
        var summary = (await SummariesAsync([definition], ct))[0];
        var versions = await db.Set<WorkflowVersion>().AsNoTracking()
            .Where(v => v.WorkflowDefinitionId == definition.Id)
            .OrderByDescending(v => v.VersionNo)
            .Select(v => new { Version = v, StepCount = v.Steps.Count })
            .ToListAsync(ct);
        return new WorkflowDetail(summary, versions.Select(v => ToSummary(v.Version, v.StepCount)).ToList());
    }

    private async Task<IReadOnlyList<WorkflowSummary>> SummariesAsync(IReadOnlyList<WorkflowDefinition> definitions, CancellationToken ct)
    {
        var ids = definitions.Select(d => d.Id).ToList();
        var versions = await db.Set<WorkflowVersion>().AsNoTracking()
            .Where(v => ids.Contains(v.WorkflowDefinitionId) && v.Status != WorkflowVersionStatus.Retired)
            .Select(v => new { v.Id, v.WorkflowDefinitionId, v.VersionNo, v.Status, StepCount = v.Steps.Count })
            .ToListAsync(ct);
        return
        [
            .. definitions.Select(d =>
            {
                var published = versions.FirstOrDefault(v => v.WorkflowDefinitionId == d.Id && v.Status == WorkflowVersionStatus.Published);
                var draft = versions.FirstOrDefault(v => v.WorkflowDefinitionId == d.Id && v.Status == WorkflowVersionStatus.Draft);
                return new WorkflowSummary(
                    d.Id,
                    d.Name,
                    d.Description,
                    d.IsActive,
                    published?.Id,
                    published?.VersionNo,
                    published?.StepCount,
                    draft?.Id,
                    draft?.VersionNo,
                    WorkflowSupport.FormatRowVersion(d.RowVersion));
            }),
        ];
    }

    private static WorkflowVersionSummary ToSummary(WorkflowVersion v, int stepCount) =>
        new(v.Id, v.VersionNo, v.Status, v.IsOrdered, stepCount, v.CreatedAtUtc, v.PublishedAt, v.PublishedByUserId, WorkflowSupport.FormatRowVersion(v.RowVersion));

    private async Task<WorkflowVersionDetail> ReadVersionAsync(WorkflowVersion version, CancellationToken ct)
    {
        var name = await db.Set<WorkflowDefinition>().AsNoTracking().Where(w => w.Id == version.WorkflowDefinitionId).Select(w => w.Name).SingleAsync(ct);
        var steps = await (
            from s in db.Set<WorkflowVersionStep>().AsNoTracking()
            where s.WorkflowVersionId == version.Id
            join src in db.Set<StepDefinition>().AsNoTracking() on s.SourceStepDefinitionId equals src.Id
            orderby s.SequenceNo
            select new WorkflowVersionStepModel(
                s.Id,
                s.SequenceNo,
                s.SourceStepDefinitionId,
                s.Title,
                s.Description,
                s.Instructions,
                s.DocumentationUrl,
                s.StepFormVersionId,
                s.IsSkippable,
                s.SkipCommentRequired,
                src.IsActive)).ToListAsync(ct);
        // Re-read the row version: saves move it, and the tracked entity has it refreshed by EF.
        return new WorkflowVersionDetail(version.WorkflowDefinitionId, name, ToSummary(version, steps.Count), steps);
    }
}
