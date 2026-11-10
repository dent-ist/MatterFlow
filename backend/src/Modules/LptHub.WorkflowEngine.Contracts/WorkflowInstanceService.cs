using System.Text.Json;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;

namespace MatterFlow.WorkflowEngine.Contracts;

/// <summary>Domain effect a permitted step action has on the Task (architecture 8.3 rule 5); the caller applies it.</summary>
public enum TaskEffect
{
    None,

    /// <summary>Reopening a step on a COMPLETED Task moves it to IN_PROGRESS in the same transaction (cause STEP_REOPEN).</summary>
    MoveTaskToInProgress,
}

/// <summary>Step instance states (architecture 8.2). "Resolved" means <see cref="Completed"/> or <see cref="Skipped"/>.</summary>
public enum StepInstanceStatus
{
    Pending,
    InProgress,
    Completed,
    Skipped,
}

/// <summary>What the caller (the Tasks module) knows about the Task a step action runs for.</summary>
/// <param name="TaskStatus">Current Task status; the engine applies the Task guard (ON_HOLD/CANCELLED block everything, COMPLETED allows only reopen).</param>
/// <param name="TaskId">Task id, stamped on the audit rows so they show in the Task's activity feed. Optional.</param>
/// <param name="MatterId">Matter id, stamped on the audit rows. Optional.</param>
/// <param name="ExpectedRowVersion">Instance row version (base64) the client last saw; a mismatch fails with 409 CONCURRENCY_CONFLICT. Null skips the early check (the save still detects concurrent changes).</param>
public sealed record StepActionContext(
    TaskStatusCode TaskStatus,
    long? TaskId = null,
    int? MatterId = null,
    string? ExpectedRowVersion = null);

/// <summary>Progress counts of an instance.</summary>
/// <param name="Total">Number of steps.</param>
/// <param name="Pending">Steps not started.</param>
/// <param name="InProgress">Steps started or reopened.</param>
/// <param name="Completed">Steps completed.</param>
/// <param name="Skipped">Steps skipped.</param>
/// <param name="CurrentStepInstanceId">First unresolved step in workflow order, or null when all are resolved.</param>
/// <param name="ReopenedPrerequisiteStepInstanceIds">Reopened, not yet re-resolved steps of an ordered workflow (the UI flags them).</param>
public sealed record WorkflowProgressView(
    int Total,
    int Pending,
    int InProgress,
    int Completed,
    int Skipped,
    int? CurrentStepInstanceId,
    IReadOnlyList<int> ReopenedPrerequisiteStepInstanceIds)
{
    public int Resolved => Completed + Skipped;

    public bool AllResolved => Total == Resolved;
}

/// <summary>One step of a running workflow: the snapshot text, the state, and the saved input values.</summary>
public sealed record StepInstanceView(
    int StepInstanceId,
    int WorkflowVersionStepId,
    int SequenceNo,
    string Title,
    string? Description,
    string? Instructions,
    string? DocumentationUrl,
    int? InputFormVersionId,
    bool IsSkippable,
    bool SkipCommentRequired,
    StepInstanceStatus Status,
    bool HasBeenResolved,
    bool IsCurrent,
    bool IsReopenedPrerequisite,
    bool RequiredInputsSatisfied,
    string? SkipComment,
    DateTime? FirstResolvedAtUtc,
    DateTime? ResolvedAtUtc,
    int? ResolvedByUserId,
    IReadOnlyDictionary<string, JsonElement> Values);

/// <summary>A running workflow with its steps in workflow order.</summary>
/// <param name="WorkflowInstanceId">Instance id.</param>
/// <param name="WorkflowVersionId">The pinned version.</param>
/// <param name="WorkflowDefinitionId">The workflow.</param>
/// <param name="VersionNo">Pinned version number.</param>
/// <param name="IsOrdered">Ordered flag snapshot.</param>
/// <param name="RowVersion">Instance row version (base64); send it back as <see cref="StepActionContext.ExpectedRowVersion"/>.</param>
/// <param name="Progress">Counts and current step.</param>
/// <param name="Steps">Steps in sequence order.</param>
public sealed record WorkflowInstanceView(
    long WorkflowInstanceId,
    int WorkflowVersionId,
    int WorkflowDefinitionId,
    int VersionNo,
    bool IsOrdered,
    string RowVersion,
    WorkflowProgressView Progress,
    IReadOnlyList<StepInstanceView> Steps);

/// <summary>Result of a successful step action.</summary>
/// <param name="Effect">What the caller must do to the Task in the same transaction.</param>
/// <param name="Instance">The instance after the action.</param>
/// <param name="AffectedStepInstanceIds">Steps that changed state (several for bulk complete, in workflow order).</param>
/// <param name="DroppedFields">Hidden-field keys whose values were dropped on a save.</param>
public sealed record StepActionOutcome(
    TaskEffect Effect,
    WorkflowInstanceView Instance,
    IReadOnlyList<int> AffectedStepInstanceIds,
    IReadOnlyList<string> DroppedFields);

/// <summary>A step named in a completion evaluation (the confirmation dialog lists them).</summary>
public sealed record StepRef(int StepInstanceId, int SequenceNo, string Title);

/// <summary>Task completion check (addendum K): ready, bulk-completable, or blocked by steps missing required inputs.</summary>
/// <param name="Unresolved">Steps not completed or skipped, in workflow order.</param>
/// <param name="BulkCompletable">Unresolved steps whose required inputs are all present.</param>
/// <param name="Blocked">Unresolved steps missing required inputs.</param>
/// <param name="RowVersion">The instance row version (base64) this evaluation was made against; a bulk completion confirmed by a user must send it back (SEC2-08).</param>
public sealed record WorkflowCompletionEvaluation(
    IReadOnlyList<StepRef> Unresolved,
    IReadOnlyList<StepRef> BulkCompletable,
    IReadOnlyList<StepRef> Blocked,
    string RowVersion = "")
{
    /// <summary>Every step is resolved; the Task may complete.</summary>
    public bool IsReady => Unresolved.Count == 0;

    /// <summary>Unresolved steps exist and every one has its required inputs: the user may confirm bulk completion.</summary>
    public bool CanBulkComplete => !IsReady && Blocked.Count == 0;

    /// <summary>409 COMPLETION_BLOCKED listing the unresolved steps and, in meta, those missing required inputs.</summary>
    public Error ToBlockedError() =>
        Error.Conflict(
            ErrorCodes.CompletionBlocked,
            "Every workflow step must be resolved before the task can be completed.",
            new Dictionary<string, object?>
            {
                ["unresolvedStepIds"] = Unresolved.Select(s => s.StepInstanceId).ToList(),
                ["stepsMissingInputs"] = Blocked.Select(s => s.StepInstanceId).ToList(),
            });
}

/// <summary>
/// Workflow execution for the Tasks module. Every method uses the scoped DbContext, so it joins the caller's unit of work:
/// <list type="bullet">
/// <item>If the caller has an open transaction (<c>db.Database.BeginTransactionAsync</c>, e.g. the per-Task UPDLOCK transaction) the
/// operation runs inside it behind a savepoint: on any failure result everything the operation wrote is rolled back, and the caller
/// then applies the Task status change (<see cref="StepActionOutcome.Effect"/>) with its own SaveChanges and commits.</item>
/// <item>Without one, the operation opens its own transaction and commits it before returning.</item>
/// </list>
/// An operation saves its step changes, audit rows and (through the forms engine) form values in the same transaction. Audit events share
/// the scope's correlation id, so a bulk completion and the Task completion that follows it correlate. All failures are
/// <see cref="Result"/> errors: 404 NOT_FOUND, 409 STEP_ORDER_VIOLATION, STEP_NOT_SKIPPABLE, INVALID_STATUS_TRANSITION, TASK_NOT_EDITABLE,
/// COMPLETION_BLOCKED, CONCURRENCY_CONFLICT, 400 SKIP_COMMENT_REQUIRED, FORM_VALIDATION_FAILED.
/// </summary>
public interface IWorkflowInstanceService
{
    /// <summary>
    /// Creates an instance from a PUBLISHED workflow version: copies the ordered flag and every step's snapshot (all PENDING) and saves it,
    /// so the returned id can be stored on the Task. Fails with NOT_FOUND for an unknown version and WORKFLOW_NOT_PUBLISHED for a draft or retired one.
    /// </summary>
    Task<Result<long>> InstantiateAsync(int workflowVersionId, CancellationToken cancellationToken = default);

    /// <summary>The instance with step states, progress, current step, reopened-prerequisite flags and saved values. Read-only.</summary>
    Task<Result<WorkflowInstanceView>> GetAsync(long workflowInstanceId, CancellationToken cancellationToken = default);

    /// <summary>PENDING to IN_PROGRESS (ordering guard applies). Audit STEP_STARTED.</summary>
    Task<Result<StepActionOutcome>> StartStepAsync(long workflowInstanceId, int stepInstanceId, StepActionContext context, CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves draft values (patch semantics, type-validated, required not enforced, hidden values dropped) and/or a skip comment on an
    /// unresolved step; a PENDING step becomes IN_PROGRESS. Audit STEP_VALUES_EDITED.
    /// </summary>
    Task<Result<StepActionOutcome>> SaveStepValuesAsync(
        long workflowInstanceId,
        int stepInstanceId,
        IReadOnlyDictionary<string, JsonElement>? values,
        string? skipComment,
        StepActionContext context,
        CancellationToken cancellationToken = default);

    /// <summary>Completes the step; optional <paramref name="values"/> are saved first. Needs the ordering guard and all required inputs. Audit STEP_COMPLETED (bulk=false).</summary>
    Task<Result<StepActionOutcome>> CompleteStepAsync(
        long workflowInstanceId,
        int stepInstanceId,
        IReadOnlyDictionary<string, JsonElement>? values,
        StepActionContext context,
        CancellationToken cancellationToken = default);

    /// <summary>Skips a skippable step, with a comment when the step requires one. Audit STEP_SKIPPED.</summary>
    Task<Result<StepActionOutcome>> SkipStepAsync(long workflowInstanceId, int stepInstanceId, string? comment, StepActionContext context, CancellationToken cancellationToken = default);

    /// <summary>
    /// COMPLETED/SKIPPED to IN_PROGRESS; no reason, no ordering guard, downstream steps untouched. Allowed on a COMPLETED Task, in which case the
    /// outcome's Effect is <see cref="TaskEffect.MoveTaskToInProgress"/>. Audit STEP_REOPENED.
    /// </summary>
    Task<Result<StepActionOutcome>> ReopenStepAsync(long workflowInstanceId, int stepInstanceId, StepActionContext context, CancellationToken cancellationToken = default);

    /// <summary>Ready / bulk-completable / blocked-missing-inputs. Read-only; ignores the Task status.</summary>
    Task<Result<WorkflowCompletionEvaluation>> EvaluateCompletionAsync(long workflowInstanceId, CancellationToken cancellationToken = default);

    /// <summary>
    /// All-or-nothing: completes every unresolved step in workflow order (never SKIPPED), each with its own STEP_COMPLETED audit row flagged
    /// bulk=true. If any unresolved step lacks required inputs nothing changes and 409 COMPLETION_BLOCKED is returned. With nothing unresolved it succeeds with no changes.
    /// </summary>
    Task<Result<StepActionOutcome>> BulkCompleteUnresolvedAsync(long workflowInstanceId, StepActionContext context, CancellationToken cancellationToken = default);
}
