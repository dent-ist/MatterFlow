using System.Globalization;
using System.Text.Json;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkflowEngine.Contracts;
using MatterFlow.WorkflowEngine.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace MatterFlow.WorkflowEngine.Application.Instances;

/// <summary>
/// Workflow execution (<see cref="IWorkflowInstanceService"/>): persists the pure domain state machine (<see cref="WorkflowInstance"/>),
/// the form values of each step (through the forms engine) and the semantic audit events, in the caller's transaction.
/// </summary>
internal sealed class WorkflowInstanceService(
    DbContext db,
    IWorkflowCatalog catalog,
    IFormDefinitionResolver forms,
    IFormSubmissionValidator validator,
    IFormValueStore valueStore,
    IAuditWriter audit,
    ICurrentUser currentUser,
    IClock clock) : IWorkflowInstanceService
{
    private const string StepObjectType = "StepInstance";
    private const string StepStartedEvent = "STEP_STARTED";
    private const string StepValuesEditedEvent = "STEP_VALUES_EDITED";

    private static readonly IReadOnlyDictionary<string, JsonElement> NoValues = new Dictionary<string, JsonElement>();

    /// <summary>A loaded, tracked instance with its domain model.</summary>
    private sealed record Loaded(WorkflowInstanceRecord Record, WorkflowInstance Domain, Dictionary<int, StepInstanceRecord> Steps, TaskEffect Effect);

    // ---- instantiate

    public async Task<Result<long>> InstantiateAsync(int workflowVersionId, CancellationToken cancellationToken = default)
    {
        var version = await catalog.GetVersionAsync(workflowVersionId, cancellationToken);
        if (version is null)
        {
            return Error.NotFound($"Workflow version {workflowVersionId} does not exist.");
        }

        if (version.Status != WorkflowVersionStatus.Published)
        {
            return Error.Conflict(ErrorCodes.WorkflowNotPublished, $"Workflow version {workflowVersionId} is not published.");
        }

        var created = WorkflowInstance.Create(
            version.IsOrdered,
            version.Steps.Select(s => new StepSpec(s.WorkflowVersionStepId, s.SequenceNo, s.IsSkippable, s.SkipCommentRequired)));
        if (created.IsFailure)
        {
            return Result<long>.Failure(created.Error!);
        }

        var record = new WorkflowInstanceRecord { WorkflowVersionId = version.WorkflowVersionId, IsOrdered = version.IsOrdered };
        foreach (var step in version.Steps.OrderBy(s => s.SequenceNo))
        {
            int? definitionId = null;
            if (step.StepFormVersionId is { } formVersionId)
            {
                var form = await forms.GetVersionAsync(formVersionId, cancellationToken);
                if (form.IsFailure)
                {
                    return Result<long>.Failure(form.Error!);
                }

                definitionId = form.Value.FormDefinitionId;
            }

            record.Steps.Add(new StepInstanceRecord
            {
                WorkflowVersionStepId = step.WorkflowVersionStepId,
                SequenceNo = step.SequenceNo,
                Title = step.Title,
                Description = step.Description,
                Instructions = step.Instructions,
                DocumentationUrl = step.DocumentationUrl,
                IsSkippable = step.IsSkippable,
                SkipCommentRequired = step.SkipCommentRequired,
                InputFormVersionId = step.StepFormVersionId,
                InputFormDefinitionId = definitionId,
                Status = StepStatus.Pending,
            });
        }

        db.Set<WorkflowInstanceRecord>().Add(record);
        await db.SaveChangesAsync(cancellationToken);
        return record.Id;
    }

    // ---- reads

    public async Task<Result<WorkflowInstanceView>> GetAsync(long workflowInstanceId, CancellationToken cancellationToken = default)
    {
        var record = await db.Set<WorkflowInstanceRecord>().AsNoTracking().Include(i => i.Steps).SingleOrDefaultAsync(i => i.Id == workflowInstanceId, cancellationToken);
        return record is null ? NotFoundInstance(workflowInstanceId) : await BuildViewAsync(record, cancellationToken);
    }

    public async Task<Result<WorkflowCompletionEvaluation>> EvaluateCompletionAsync(long workflowInstanceId, CancellationToken cancellationToken = default)
    {
        var record = await db.Set<WorkflowInstanceRecord>().AsNoTracking().Include(i => i.Steps).SingleOrDefaultAsync(i => i.Id == workflowInstanceId, cancellationToken);
        if (record is null)
        {
            return NotFoundInstance(workflowInstanceId);
        }

        var domain = ToDomain(record);
        if (domain.IsFailure)
        {
            return Result<WorkflowCompletionEvaluation>.Failure(domain.Error!);
        }

        var inputs = await InputChecksAsync(record.Steps.Where(s => !IsResolved(s)), cancellationToken);
        if (inputs.IsFailure)
        {
            return Result<WorkflowCompletionEvaluation>.Failure(inputs.Error!);
        }

        return ToEvaluation(domain.Value.EvaluateTaskCompletion(StepInputCheck.From(id => inputs.Value[id].IsValid)), record.Steps.ToDictionary(s => s.Id), WorkflowSupport.FormatRowVersion(record.RowVersion));
    }

    // ---- actions

    public Task<Result<StepActionOutcome>> StartStepAsync(long workflowInstanceId, int stepInstanceId, StepActionContext context, CancellationToken cancellationToken = default) =>
        RunAsync(workflowInstanceId, StepAction.Start, context, (loaded, ct) => Task.FromResult(Plan(loaded.Domain.Start(stepInstanceId))), cancellationToken);

    public Task<Result<StepActionOutcome>> SaveStepValuesAsync(
        long workflowInstanceId,
        int stepInstanceId,
        IReadOnlyDictionary<string, JsonElement>? values,
        string? skipComment,
        StepActionContext context,
        CancellationToken cancellationToken = default) =>
        RunAsync(workflowInstanceId, StepAction.Save, context, async (loaded, ct) =>
        {
            var events = loaded.Domain.SaveValues(stepInstanceId, skipComment);
            if (events.IsFailure)
            {
                return Result<ActionPlan>.Failure(events.Error!);
            }

            var saved = await SaveValuesAsync(loaded.Steps[stepInstanceId], values, context.MatterId, ct);
            return saved.IsFailure ? Result<ActionPlan>.Failure(saved.Error!) : new ActionPlan(events.Value, saved.Value.Dropped, saved.Value);
        }, cancellationToken);

    public Task<Result<StepActionOutcome>> CompleteStepAsync(
        long workflowInstanceId,
        int stepInstanceId,
        IReadOnlyDictionary<string, JsonElement>? values,
        StepActionContext context,
        CancellationToken cancellationToken = default) =>
        RunAsync(workflowInstanceId, StepAction.Complete, context, async (loaded, ct) =>
        {
            var step = loaded.Steps.GetValueOrDefault(stepInstanceId);
            if (step is null)
            {
                return Error.NotFound($"Step {stepInstanceId} was not found in this workflow.");
            }

            var dropped = (IReadOnlyList<string>)[];
            var changed = (IReadOnlyList<string>)[];
            if (values is { Count: > 0 })
            {
                var saved = await SaveValuesAsync(step, values, context.MatterId, ct);
                if (saved.IsFailure)
                {
                    return Result<ActionPlan>.Failure(saved.Error!);
                }

                (dropped, changed) = saved.Value;
            }

            var inputs = await InputChecksAsync([step], ct);
            if (inputs.IsFailure)
            {
                return Result<ActionPlan>.Failure(inputs.Error!);
            }

            var events = loaded.Domain.Complete(stepInstanceId, StepInputCheck.From(id => inputs.Value[id].IsValid));
            if (events.IsFailure)
            {
                // Field-level errors of the form beat the generic "required inputs are missing".
                var detailed = inputs.Value[stepInstanceId].ToError();
                return detailed is not null && events.Error!.FieldErrors?.ContainsKey($"step:{stepInstanceId}") == true
                    ? Result<ActionPlan>.Failure(detailed)
                    : Result<ActionPlan>.Failure(events.Error!);
            }

            return new ActionPlan(events.Value, dropped, new SavedValues(dropped, changed));
        }, cancellationToken);

    public Task<Result<StepActionOutcome>> SkipStepAsync(long workflowInstanceId, int stepInstanceId, string? comment, StepActionContext context, CancellationToken cancellationToken = default) =>
        RunAsync(workflowInstanceId, StepAction.Skip, context, (loaded, ct) => Task.FromResult(Plan(loaded.Domain.Skip(stepInstanceId, comment))), cancellationToken);

    public Task<Result<StepActionOutcome>> ReopenStepAsync(long workflowInstanceId, int stepInstanceId, StepActionContext context, CancellationToken cancellationToken = default) =>
        RunAsync(workflowInstanceId, StepAction.Reopen, context, (loaded, ct) => Task.FromResult(Plan(loaded.Domain.Reopen(stepInstanceId))), cancellationToken);

    public Task<Result<StepActionOutcome>> BulkCompleteUnresolvedAsync(long workflowInstanceId, StepActionContext context, CancellationToken cancellationToken = default) =>
        RunAsync(workflowInstanceId, StepAction.BulkComplete, context, async (loaded, ct) =>
        {
            var inputs = await InputChecksAsync(loaded.Steps.Values.Where(s => !IsResolved(s)), ct);
            if (inputs.IsFailure)
            {
                return Result<ActionPlan>.Failure(inputs.Error!);
            }

            var events = loaded.Domain.BulkCompleteUnresolved(StepInputCheck.From(id => inputs.Value[id].IsValid));
            return Plan(events);
        }, cancellationToken);

    // ---- execution

    private static Result<ActionPlan> Plan(Result<IReadOnlyList<WorkflowDomainEvent>> events) =>
        events.IsFailure ? Result<ActionPlan>.Failure(events.Error!) : new ActionPlan(events.Value, []);

    private sealed record SavedValues(IReadOnlyList<string> Dropped, IReadOnlyList<string> Changed);

    private sealed record ActionPlan(IReadOnlyList<WorkflowDomainEvent> Events, IReadOnlyList<string> Dropped, SavedValues? Saved = null);

    /// <summary>
    /// Shared pipeline: load tracked, Task guard, optimistic check, domain operation (which may save form values), apply the new state and
    /// audit rows, one SaveChanges, commit. Any failure rolls back what the operation wrote.
    /// </summary>
    private async Task<Result<StepActionOutcome>> RunAsync(
        long workflowInstanceId,
        StepAction action,
        StepActionContext context,
        Func<Loaded, CancellationToken, Task<Result<ActionPlan>>> operation,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);

        var effect = TaskStepGuard.StepActionsAllowed(context.TaskStatus, action);
        if (effect.IsFailure)
        {
            return Result<StepActionOutcome>.Failure(effect.Error!);
        }

        await using var unit = await Unit.BeginAsync(db, cancellationToken);
        WorkflowInstanceRecord? tracked = null;
        try
        {
            tracked = await db.Set<WorkflowInstanceRecord>().Include(i => i.Steps).SingleOrDefaultAsync(i => i.Id == workflowInstanceId, cancellationToken);
            if (tracked is null)
            {
                return NotFoundInstance(workflowInstanceId);
            }

            if (context.ExpectedRowVersion is not null)
            {
                var expected = WorkflowSupport.ParseRowVersion(context.ExpectedRowVersion);
                if (expected is null)
                {
                    return WorkflowSupport.InvalidRowVersion();
                }

                if (!tracked.RowVersion.AsSpan().SequenceEqual(expected))
                {
                    return WorkflowSupport.Concurrency("The workflow was changed by someone else. Reload and try again.");
                }
            }

            var domain = ToDomain(tracked);
            if (domain.IsFailure)
            {
                return Result<StepActionOutcome>.Failure(domain.Error!);
            }

            var loaded = new Loaded(tracked, domain.Value, tracked.Steps.ToDictionary(s => s.Id), effect.Value);
            var plan = await operation(loaded, cancellationToken);
            if (plan.IsFailure)
            {
                return Result<StepActionOutcome>.Failure(plan.Error!);
            }

            var affected = Apply(loaded, plan.Value, context);
            if (affected.Count > 0 || plan.Value.Saved is not null)
            {
                tracked.Revision++;
                await db.SaveChangesAsync(cancellationToken);
            }

            await unit.CommitAsync(cancellationToken);
            var view = await BuildViewAsync(tracked, cancellationToken);
            return view.IsFailure
                ? Result<StepActionOutcome>.Failure(view.Error!)
                : new StepActionOutcome(effect.Value, view.Value, affected, plan.Value.Dropped);
        }
        catch (DbUpdateConcurrencyException)
        {
            Detach(tracked);
            return WorkflowSupport.Concurrency("The workflow was changed by someone else. Reload and try again.");
        }
    }

    /// <summary>Copies the domain state onto the tracked rows and queues the audit events. Returns the ids of the steps that changed state.</summary>
    private List<int> Apply(Loaded loaded, ActionPlan plan, StepActionContext context)
    {
        var now = clock.UtcNow;
        var affected = new List<int>();
        foreach (var e in plan.Events)
        {
            var row = loaded.Steps[e.StepId];
            var step = loaded.Domain.Find(e.StepId)!;
            row.Status = step.Status;
            row.SkipComment = step.SkipComment;
            if (e is StepCompleted or StepSkipped)
            {
                row.FirstResolvedAt ??= now;
                row.ResolvedAt = now;
                row.ResolvedByUserId = currentUser.UserId;
            }

            if (e.From != e.To)
            {
                affected.Add(e.StepId);
            }

            WriteAudit(row, e, plan, context);
        }

        // A values-only save keeps its row in the affected list so the caller sees what was touched.
        foreach (var e in plan.Events.OfType<StepValuesSaved>().Where(e => e.From == e.To))
        {
            affected.Add(e.StepId);
        }

        return affected;
    }

    private void WriteAudit(StepInstanceRecord row, WorkflowDomainEvent e, ActionPlan plan, StepActionContext context)
    {
        AuditEntry Entry(string type, string? summary) => new()
        {
            EventType = type,
            ObjectType = StepObjectType,
            ObjectId = row.Id.ToString(CultureInfo.InvariantCulture),
            MatterId = context.MatterId,
            TaskId = context.TaskId,
            FieldKey = "status",
            OldValue = Code(e.From),
            NewValue = Code(e.To),
            Summary = summary,
        };

        switch (e)
        {
            case StepStarted:
                audit.Write(Entry(StepStartedEvent, $"Step '{row.Title}' started"));
                break;
            case StepValuesSaved saved:
                if (saved.From == StepStatus.Pending)
                {
                    audit.Write(Entry(StepStartedEvent, $"Step '{row.Title}' started (values saved)"));
                }

                audit.Write(Entry(StepValuesEditedEvent, ValuesSummary(row, plan.Saved)) with { FieldKey = "values", OldValue = null, NewValue = null });
                break;
            case StepCompleted completed:
                if (plan.Saved is { Changed.Count: > 0 })
                {
                    audit.Write(Entry(StepValuesEditedEvent, ValuesSummary(row, plan.Saved)) with { FieldKey = "values", OldValue = null, NewValue = null });
                }

                audit.Write(Entry(AuditEventTypes.StepCompleted, $"Step '{row.Title}' completed (bulk={(completed.Bulk ? "true" : "false")})"));
                break;
            case StepSkipped skipped:
                audit.Write(Entry(AuditEventTypes.StepSkipped, skipped.Comment is null ? $"Step '{row.Title}' skipped" : $"Step '{row.Title}' skipped: {skipped.Comment}"));
                break;
            case StepReopened:
                audit.Write(Entry(AuditEventTypes.StepReopened, $"Step '{row.Title}' reopened"));
                break;
            default:
                throw new InvalidOperationException($"Unhandled workflow event {e.GetType().Name}.");
        }
    }

    private static string ValuesSummary(StepInstanceRecord row, SavedValues? saved)
    {
        var changed = saved is { Changed.Count: > 0 } ? "fields: " + string.Join(", ", saved.Changed) : "skip comment or no field changes";
        var dropped = saved is { Dropped.Count: > 0 } ? "; hidden values dropped: " + string.Join(", ", saved.Dropped) : string.Empty;
        return $"Step '{row.Title}' values edited ({changed}{dropped})";
    }

    private static string Code(StepStatus status) => status switch
    {
        StepStatus.Pending => "PENDING",
        StepStatus.InProgress => "IN_PROGRESS",
        StepStatus.Completed => "COMPLETED",
        _ => "SKIPPED",
    };

    // ---- values and inputs

    /// <summary>Saves draft values through the forms engine (patch semantics, hidden values dropped). Null/empty values save nothing.</summary>
    private async Task<Result<SavedValues>> SaveValuesAsync(StepInstanceRecord step, IReadOnlyDictionary<string, JsonElement>? values, int? matterId, CancellationToken cancellationToken)
    {
        if (values is null || values.Count == 0)
        {
            return new SavedValues([], []);
        }

        if (step.InputFormVersionId is not { } formVersionId || step.InputFormDefinitionId is not { } definitionId)
        {
            return Error.Validation("values", "NO_INPUT_FORM", "This step has no input form.");
        }

        var existing = await valueStore.GetAsync(FormValueOwnerKind.StepInstance, step.Id, definitionId, cancellationToken);
        var saved = await valueStore.SaveAsync(
            FormValueOwnerKind.StepInstance,
            step.Id,
            formVersionId,
            values,
            new FormSaveOptions { Mode = FormSubmissionMode.Draft, ValidateOnlyChanged = true, References = new FormReferenceContext(matterId) },
            cancellationToken);
        return saved.IsFailure
            ? Result<SavedValues>.Failure(saved.Error!)
            : new SavedValues([.. saved.Value.DroppedFields], [.. FormSubmissionOptions.ChangedFieldsOf(values, existing?.Values)]);
    }

    /// <summary>Submit-mode validation of each step's stored values; steps without an input form are valid.</summary>
    private async Task<Result<Dictionary<int, FormSubmissionResult>>> InputChecksAsync(
        IEnumerable<StepInstanceRecord> steps,
        CancellationToken cancellationToken,
        IReadOnlyDictionary<long, StoredFormValues>? preloaded = null)
    {
        var results = new Dictionary<int, FormSubmissionResult>();
        var list = steps.ToList();
        // One read for the stored values of all the steps (the caller may already hold them).
        var storedByStep = preloaded ?? await StoredValuesAsync(list, cancellationToken);
        foreach (var step in list)
        {
            if (step.InputFormVersionId is not { } formVersionId || step.InputFormDefinitionId is null)
            {
                results[step.Id] = new FormSubmissionResult(0, 0, [], NoValues, [], []);
                continue;
            }

            storedByStep.TryGetValue(step.Id, out var stored);
            var result = await validator.ValidateAsync(formVersionId, stored?.Values ?? NoValues, new FormSubmissionOptions { Mode = FormSubmissionMode.Submit }, cancellationToken);
            if (result.IsFailure)
            {
                return Result<Dictionary<int, FormSubmissionResult>>.Failure(result.Error!);
            }

            results[step.Id] = result.Value;
        }

        return results;
    }

    /// <summary>The stored input values of the steps that have an input form, in one read.</summary>
    private async Task<IReadOnlyDictionary<long, StoredFormValues>> StoredValuesAsync(IEnumerable<StepInstanceRecord> steps, CancellationToken cancellationToken)
    {
        var owners = steps.Where(s => s.InputFormDefinitionId is not null).Select(s => ((long)s.Id, s.InputFormDefinitionId!.Value)).ToList();
        return await valueStore.GetManyAsync(FormValueOwnerKind.StepInstance, owners, cancellationToken);
    }

    // ---- mapping

    private static bool IsResolved(StepInstanceRecord s) => s.Status is StepStatus.Completed or StepStatus.Skipped;

    private static Error NotFoundInstance(long id) => Error.NotFound($"Workflow instance {id} does not exist.");

    private static Result<WorkflowInstance> ToDomain(WorkflowInstanceRecord record) =>
        WorkflowInstance.Rehydrate(
            record.IsOrdered,
            record.Steps.Select(s => new StepSnapshot(new StepSpec(s.Id, s.SequenceNo, s.IsSkippable, s.SkipCommentRequired), s.Status, s.FirstResolvedAt is not null, s.SkipComment)));

    private static Result<WorkflowCompletionEvaluation> ToEvaluation(TaskCompletionEvaluation e, Dictionary<int, StepInstanceRecord> steps, string rowVersion)
    {
        List<StepRef> Refs(IEnumerable<int> ids) => [.. ids.Select(id => new StepRef(id, steps[id].SequenceNo, steps[id].Title))];
        return new WorkflowCompletionEvaluation(Refs(e.UnresolvedStepIds), Refs(e.BulkCompletableStepIds), Refs(e.BlockedStepIds), rowVersion);
    }

    private async Task<Result<WorkflowInstanceView>> BuildViewAsync(WorkflowInstanceRecord record, CancellationToken cancellationToken)
    {
        var domain = ToDomain(record);
        if (domain.IsFailure)
        {
            return Result<WorkflowInstanceView>.Failure(domain.Error!);
        }

        var version = await db.Set<WorkflowVersion>().AsNoTracking()
            .Where(v => v.Id == record.WorkflowVersionId)
            .Select(v => new { v.WorkflowDefinitionId, v.VersionNo })
            .SingleAsync(cancellationToken);
        var storedByStep = await StoredValuesAsync(record.Steps, cancellationToken);
        var inputs = await InputChecksAsync(record.Steps.Where(s => !IsResolved(s)), cancellationToken, storedByStep);
        if (inputs.IsFailure)
        {
            return Result<WorkflowInstanceView>.Failure(inputs.Error!);
        }

        var progress = domain.Value.GetProgress();
        var views = new List<StepInstanceView>();
        foreach (var s in record.Steps.OrderBy(s => s.SequenceNo))
        {
            storedByStep.TryGetValue(s.Id, out var stored);
            var resolved = IsResolved(s);
            views.Add(new StepInstanceView(
                s.Id,
                s.WorkflowVersionStepId,
                s.SequenceNo,
                s.Title,
                s.Description,
                s.Instructions,
                s.DocumentationUrl,
                s.InputFormVersionId,
                s.IsSkippable,
                s.SkipCommentRequired,
                ToView(s.Status),
                s.FirstResolvedAt is not null,
                progress.CurrentStepId == s.Id,
                progress.ReopenedPrerequisiteStepIds.Contains(s.Id),
                resolved || inputs.Value[s.Id].IsValid,
                s.SkipComment,
                s.FirstResolvedAt,
                resolved ? s.ResolvedAt : null,
                resolved ? s.ResolvedByUserId : null,
                stored?.Values ?? NoValues));
        }

        return new WorkflowInstanceView(
            record.Id,
            record.WorkflowVersionId,
            version.WorkflowDefinitionId,
            version.VersionNo,
            record.IsOrdered,
            WorkflowSupport.FormatRowVersion(record.RowVersion),
            new WorkflowProgressView(
                progress.Total,
                progress.Pending,
                progress.InProgress,
                progress.Completed,
                progress.Skipped,
                progress.CurrentStepId,
                progress.ReopenedPrerequisiteStepIds),
            views);
    }

    private static StepInstanceStatus ToView(StepStatus status) => status switch
    {
        StepStatus.Pending => StepInstanceStatus.Pending,
        StepStatus.InProgress => StepInstanceStatus.InProgress,
        StepStatus.Completed => StepInstanceStatus.Completed,
        _ => StepInstanceStatus.Skipped,
    };

    private void Detach(WorkflowInstanceRecord? record)
    {
        if (record is null)
        {
            return;
        }

        foreach (var step in record.Steps)
        {
            db.Entry(step).State = EntityState.Detached;
        }

        db.Entry(record).State = EntityState.Detached;
    }

    /// <summary>
    /// The operation's transaction scope: its own transaction when the caller has none, otherwise a savepoint inside the caller's.
    /// Disposing without <see cref="CommitAsync"/> rolls back everything the operation wrote.
    /// </summary>
    private sealed class Unit : IAsyncDisposable
    {
        private readonly IDbContextTransaction _transaction;
        private readonly bool _own;
        private readonly string? _savepoint;
        private bool _completed;

        private Unit(IDbContextTransaction transaction, bool own, string? savepoint)
        {
            _transaction = transaction;
            _own = own;
            _savepoint = savepoint;
        }

        public static async Task<Unit> BeginAsync(DbContext db, CancellationToken cancellationToken)
        {
            if (db.Database.CurrentTransaction is { } current)
            {
                var name = "wf_" + Guid.NewGuid().ToString("N")[..16];
                await current.CreateSavepointAsync(name, cancellationToken);
                return new Unit(current, own: false, name);
            }

            return new Unit(await db.Database.BeginTransactionAsync(cancellationToken), own: true, null);
        }

        public async Task CommitAsync(CancellationToken cancellationToken)
        {
            if (_own)
            {
                await _transaction.CommitAsync(cancellationToken);
            }

            _completed = true;
        }

        public async ValueTask DisposeAsync()
        {
            if (!_completed && !_own && _savepoint is not null)
            {
                await _transaction.RollbackToSavepointAsync(_savepoint);
            }

            if (_own)
            {
                await _transaction.DisposeAsync();
            }
        }
    }
}
