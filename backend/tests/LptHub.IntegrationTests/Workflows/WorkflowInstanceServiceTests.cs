using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkflowEngine.Contracts;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Workflows.WorkflowInstanceHarness;

namespace MatterFlow.IntegrationTests.Workflows;

/// <summary>
/// Ticket #39 part 2 acceptance against a real SQL Server: instantiation snapshots (SCN-014), the step state machine through the persisted
/// service (SCN-010 to 013), form values, all-or-nothing bulk completion (addendum K), optimistic concurrency and transactional audit.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class WorkflowInstanceServiceTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private WorkflowInstanceHarness _h = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new WorkflowInstanceHarness(_factory);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static void ShouldFailWith<T>(Result<T> result, string code)
    {
        result.IsFailure.ShouldBeTrue("expected a failure");
        result.Error!.Code.ShouldBe(code);
    }

    private async Task<(long InstanceId, int[] StepIds)> PublishAndStartAsync(string name, bool ordered, int steps, Func<int, Place>? place = null)
    {
        var placements = new List<Place>();
        for (var i = 1; i <= steps; i++)
        {
            var id = await _h.CreateStepAsync($"{name} step {i}");
            placements.Add(place?.Invoke(id) ?? new Place(id));
        }

        var (_, versionId) = await _h.CreatePublishedWorkflowAsync(name, ordered, [.. placements]);
        var instanceId = await _h.InstantiateAsync(versionId);
        var view = await _h.GetAsync(instanceId);
        return (instanceId, [.. view.Steps.Select(s => s.StepInstanceId)]);
    }

    [Fact]
    public async Task Instantiate_copies_the_snapshot_and_starts_every_step_pending()
    {
        var a = await _h.CreateStepAsync("Intake", withInputForm: true, instructions: "Open the box.");
        var b = await _h.CreateStepAsync("Load");
        var (workflowId, versionId) = await _h.CreatePublishedWorkflowAsync("Standard", ordered: true, new Place(a), new Place(b, Skippable: true, CommentRequired: true));

        var instanceId = await _h.InstantiateAsync(versionId);
        var view = await _h.GetAsync(instanceId);

        view.WorkflowVersionId.ShouldBe(versionId);
        view.WorkflowDefinitionId.ShouldBe(workflowId);
        view.IsOrdered.ShouldBeTrue();
        view.RowVersion.ShouldNotBeNullOrEmpty();
        view.Steps.Select(s => s.Title).ShouldBe(["Intake", "Load"]);
        view.Steps.Select(s => s.SequenceNo).ShouldBe([1, 2]);
        view.Steps.ShouldAllBe(s => s.Status == StepInstanceStatus.Pending && !s.HasBeenResolved);
        view.Steps[0].Instructions.ShouldBe("Open the box.");
        view.Steps[0].InputFormVersionId.ShouldNotBeNull();
        view.Steps[0].RequiredInputsSatisfied.ShouldBeFalse();
        view.Steps[1].InputFormVersionId.ShouldBeNull();
        view.Steps[1].RequiredInputsSatisfied.ShouldBeTrue();
        (view.Steps[1].IsSkippable, view.Steps[1].SkipCommentRequired).ShouldBe((true, true));
        view.Progress.Total.ShouldBe(2);
        view.Progress.Pending.ShouldBe(2);
        view.Progress.CurrentStepInstanceId.ShouldBe(view.Steps[0].StepInstanceId);
        view.Steps[0].IsCurrent.ShouldBeTrue();

        ShouldFailWith(await _h.WithServiceAsync(s => s.InstantiateAsync(987654)), ErrorCodes.NotFound);
        ShouldFailWith(await _h.WithServiceAsync(s => s.GetAsync(987654)), ErrorCodes.NotFound);
    }

    [Fact]
    public async Task Scn014_a_running_instance_keeps_its_version_when_a_new_version_is_published()
    {
        var a = await _h.CreateStepAsync("Receive", instructions: "v2 instructions");
        var b = await _h.CreateStepAsync("Process");
        var (workflowId, v2) = await _h.CreatePublishedWorkflowAsync("Versioned", ordered: true, new Place(a), new Place(b));
        var existing = await _h.InstantiateAsync(v2);
        await _h.StartAsync(existing, (await _h.GetAsync(existing)).Steps[0].StepInstanceId);

        // v3: library text changed, a step added, order changed.
        var c = await _h.CreateStepAsync("QC");
        await _h.RenameStepAsync(a, "Receive and log", "v3 instructions");
        var v3 = await _h.PublishNextVersionAsync(workflowId, ordered: false, new Place(b), new Place(c), new Place(a));

        var old = await _h.GetAsync(existing);
        old.WorkflowVersionId.ShouldBe(v2);
        old.IsOrdered.ShouldBeTrue();
        old.Steps.Select(s => s.Title).ShouldBe(["Receive", "Process"]);
        old.Steps[0].Instructions.ShouldBe("v2 instructions");
        old.Steps[0].Status.ShouldBe(StepInstanceStatus.InProgress);

        var fresh = await _h.GetAsync(await _h.InstantiateAsync(v3));
        fresh.WorkflowVersionId.ShouldBe(v3);
        fresh.IsOrdered.ShouldBeFalse();
        fresh.Steps.Select(s => s.Title).ShouldBe(["Process", "QC", "Receive and log"]);
        fresh.Steps[2].Instructions.ShouldBe("v3 instructions");

        // v2 is RETIRED now: still readable through the instance, but no longer offered for new instances.
        ShouldFailWith(await _h.WithServiceAsync(s => s.InstantiateAsync(v2)), ErrorCodes.WorkflowNotPublished);
        (await _h.WithServiceAsync(s => s.StartStepAsync(existing, old.Steps[1].StepInstanceId, Ctx()))).IsFailure.ShouldBeTrue(); // order guard of the pinned ordered v2 still applies
    }

    [Fact]
    public async Task Scn010_ordered_workflow_blocks_a_never_resolved_step_until_earlier_steps_are_resolved()
    {
        var (id, steps) = await PublishAndStartAsync("Ordered", true, 4);

        var blocked = await _h.WithServiceAsync(s => s.CompleteStepAsync(id, steps[2], null, Ctx()));
        ShouldFailWith(blocked, ErrorCodes.StepOrderViolation);
        blocked.Error!.Meta!["blockingStepIds"].ShouldBe(new List<int> { steps[0], steps[1] });
        ShouldFailWith(await _h.WithServiceAsync(s => s.StartStepAsync(id, steps[1], Ctx())), ErrorCodes.StepOrderViolation);
        (await _h.GetAsync(id)).Progress.Pending.ShouldBe(4);
        (await _h.AuditAsync()).ShouldBeEmpty();

        await _h.StartAsync(id, steps[0]);
        ShouldFailWith(await _h.WithServiceAsync(s => s.StartStepAsync(id, steps[0], Ctx())), ErrorCodes.InvalidStatusTransition);
        await _h.CompleteAsync(id, steps[0]);
        await _h.CompleteAsync(id, steps[1]);
        var view = await _h.GetAsync(id);
        view.Progress.Completed.ShouldBe(2);
        view.Progress.CurrentStepInstanceId.ShouldBe(steps[2]);
        view.Steps[0].ResolvedAtUtc.ShouldNotBeNull();
        (await _h.AuditAsync("STEP_COMPLETED")).Count.ShouldBe(2);
    }

    [Fact]
    public async Task Unordered_workflow_has_no_ordering_guard()
    {
        var (id, steps) = await PublishAndStartAsync("Unordered", false, 3);
        await _h.CompleteAsync(id, steps[2]);
        (await _h.GetAsync(id)).Progress.Completed.ShouldBe(1);
    }

    [Fact]
    public async Task Scn011_skip_comment_is_required_when_configured_and_stored()
    {
        var (id, steps) = await PublishAndStartAsync("Skip", false, 1, s => new Place(s, Skippable: true, CommentRequired: true));

        ShouldFailWith(await _h.WithServiceAsync(s => s.SkipStepAsync(id, steps[0], null, Ctx())), ErrorCodes.SkipCommentRequired);
        ShouldFailWith(await _h.WithServiceAsync(s => s.SkipStepAsync(id, steps[0], "   ", Ctx())), ErrorCodes.SkipCommentRequired);
        (await _h.GetAsync(id)).Steps[0].Status.ShouldBe(StepInstanceStatus.Pending);

        await _h.SkipAsync(id, steps[0], "Client already provided it");
        var step = (await _h.GetAsync(id)).Steps[0];
        step.Status.ShouldBe(StepInstanceStatus.Skipped);
        step.SkipComment.ShouldBe("Client already provided it");
        var audit = (await _h.AuditAsync("STEP_SKIPPED")).ShouldHaveSingleItem();
        audit.TaskId.ShouldBe(4242);
        audit.MatterId.ShouldBe(7);
        audit.Summary!.ShouldContain("Client already provided it");
    }

    [Fact]
    public async Task Scn012_a_non_skippable_step_cannot_be_skipped()
    {
        var (id, steps) = await PublishAndStartAsync("NoSkip", false, 1);
        ShouldFailWith(await _h.WithServiceAsync(s => s.SkipStepAsync(id, steps[0], "please", Ctx())), ErrorCodes.StepNotSkippable);
        (await _h.GetAsync(id)).Steps[0].Status.ShouldBe(StepInstanceStatus.Pending);
    }

    [Fact]
    public async Task Scn013_reopen_keeps_downstream_steps_flags_the_prerequisite_and_still_guards_never_resolved_steps()
    {
        var (id, steps) = await PublishAndStartAsync("Reopen", true, 5);
        foreach (var step in steps.Take(4))
        {
            await _h.CompleteAsync(id, step);
        }

        var reopened = await _h.ReopenAsync(id, steps[1]);
        reopened.Effect.ShouldBe(TaskEffect.None);
        var view = await _h.GetAsync(id);
        view.Steps.Select(s => s.Status).ShouldBe([
            StepInstanceStatus.Completed,
            StepInstanceStatus.InProgress,
            StepInstanceStatus.Completed,
            StepInstanceStatus.Completed,
            StepInstanceStatus.Pending,
        ]);
        view.Steps[1].IsReopenedPrerequisite.ShouldBeTrue();
        view.Steps[1].HasBeenResolved.ShouldBeTrue();
        view.Progress.ReopenedPrerequisiteStepInstanceIds.ShouldBe([steps[1]]);
        view.Progress.CurrentStepInstanceId.ShouldBe(steps[1]);
        (await _h.AuditAsync("STEP_REOPENED")).ShouldHaveSingleItem().OldValue.ShouldBe("COMPLETED");

        // Step 5 never resolved: blocked until step 2 is resolved again. Step 2 itself can be re-completed without the ordering guard.
        ShouldFailWith(await _h.WithServiceAsync(s => s.StartStepAsync(id, steps[4], Ctx())), ErrorCodes.StepOrderViolation);
        await _h.CompleteAsync(id, steps[1]);
        await _h.StartAsync(id, steps[4]);
        (await _h.GetAsync(id)).Progress.ReopenedPrerequisiteStepInstanceIds.ShouldBeEmpty();

        // Reopening a pending step is invalid.
        ShouldFailWith(await _h.WithServiceAsync(s => s.ReopenStepAsync(id, steps[4], Ctx())), ErrorCodes.InvalidStatusTransition);
    }

    [Fact]
    public async Task Task_status_guard_reopen_on_a_completed_task_returns_the_move_to_in_progress_effect()
    {
        var (id, steps) = await PublishAndStartAsync("Guard", false, 2);
        await _h.CompleteAsync(id, steps[0]);
        await _h.CompleteAsync(id, steps[1]);

        foreach (var blocked in new[] { TaskStatusCode.OnHold, TaskStatusCode.Cancelled })
        {
            ShouldFailWith(await _h.WithServiceAsync(s => s.ReopenStepAsync(id, steps[0], Ctx(blocked))), ErrorCodes.TaskNotEditable);
            ShouldFailWith(await _h.WithServiceAsync(s => s.StartStepAsync(id, steps[0], Ctx(blocked))), ErrorCodes.TaskNotEditable);
        }

        ShouldFailWith(await _h.WithServiceAsync(s => s.SkipStepAsync(id, steps[0], null, Ctx(TaskStatusCode.Completed))), ErrorCodes.TaskNotEditable);
        ShouldFailWith(await _h.WithServiceAsync(s => s.BulkCompleteUnresolvedAsync(id, Ctx(TaskStatusCode.Completed))), ErrorCodes.TaskNotEditable);

        var outcome = await _h.ReopenAsync(id, steps[0], Ctx(TaskStatusCode.Completed));
        outcome.Effect.ShouldBe(TaskEffect.MoveTaskToInProgress);
        outcome.AffectedStepInstanceIds.ShouldBe([steps[0]]);
        outcome.Instance.Steps[0].Status.ShouldBe(StepInstanceStatus.InProgress);
    }

    [Fact]
    public async Task Values_are_validated_against_the_pinned_form_hidden_values_dropped_and_required_inputs_enforced_on_complete()
    {
        var input = await _h.CreateStepAsync("Needs input", withInputForm: true);
        var plain = await _h.CreateStepAsync("Plain");
        var (_, versionId) = await _h.CreatePublishedWorkflowAsync("Inputs", false, new Place(input), new Place(plain));
        var id = await _h.InstantiateAsync(versionId);
        var steps = (await _h.GetAsync(id)).Steps.Select(s => s.StepInstanceId).ToArray();

        // Draft save: type-valid only, required not enforced; PENDING becomes IN_PROGRESS; hidden value dropped.
        var first = Ok(await _h.WithServiceAsync(s => s.SaveStepValuesAsync(id, steps[0], Values("""{"has_extra":true,"extra":"shown"}"""), null, Ctx())));
        first.Instance.Steps[0].Values["extra"].GetString().ShouldBe("shown");
        var saved = Ok(await _h.WithServiceAsync(s => s.SaveStepValuesAsync(id, steps[0], Values("""{"has_extra":false}"""), null, Ctx())));
        saved.DroppedFields.ShouldBe(["extra"]);
        saved.Instance.Steps[0].Status.ShouldBe(StepInstanceStatus.InProgress);
        saved.Instance.Steps[0].Values.ContainsKey("extra").ShouldBeFalse();
        saved.Instance.Steps[0].RequiredInputsSatisfied.ShouldBeFalse();

        // Unknown field and a step without a form are validation failures; nothing changes.
        (await _h.WithServiceAsync(s => s.SaveStepValuesAsync(id, steps[0], Values("""{"nope":1}"""), null, Ctx()))).IsFailure.ShouldBeTrue();
        ShouldFailWith(await _h.WithServiceAsync(s => s.SaveStepValuesAsync(id, steps[1], Values("""{"note":"x"}"""), null, Ctx())), ErrorCodes.ValidationFailed);

        // Complete without the required note: FORM_VALIDATION_FAILED with the field error; still IN_PROGRESS.
        var missing = await _h.WithServiceAsync(s => s.CompleteStepAsync(id, steps[0], null, Ctx()));
        ShouldFailWith(missing, ErrorCodes.FormValidationFailed);
        missing.Error!.FieldErrors!.Keys.ShouldContain("form:note");
        (await _h.GetAsync(id)).Steps[0].Status.ShouldBe(StepInstanceStatus.InProgress);

        // Values may come with the complete call.
        var done = await _h.CompleteAsync(id, steps[0], """{"note":"all good"}""");
        done.Instance.Steps[0].Status.ShouldBe(StepInstanceStatus.Completed);
        done.Instance.Steps[0].Values["note"].GetString().ShouldBe("all good");
        done.Instance.Steps[0].Values["has_extra"].GetBoolean().ShouldBeFalse();

        // A resolved step's values need a reopen first.
        ShouldFailWith(await _h.WithServiceAsync(s => s.SaveStepValuesAsync(id, steps[0], Values("""{"note":"edit"}"""), null, Ctx())), ErrorCodes.InvalidStatusTransition);
        await _h.ReopenAsync(id, steps[0]);
        Ok(await _h.WithServiceAsync(s => s.SaveStepValuesAsync(id, steps[0], Values("""{"note":"edited"}"""), null, Ctx())));

        var edits = await _h.AuditAsync("STEP_VALUES_EDITED");
        edits.Count.ShouldBe(4); // two draft saves, the values sent with complete, the edit after reopen
        edits[3].Summary!.ShouldContain("note");
        (await _h.AuditAsync("STEP_STARTED")).Count.ShouldBe(1);
    }

    [Fact]
    public async Task Bulk_complete_is_all_or_nothing_and_in_workflow_order()
    {
        var s1 = await _h.CreateStepAsync("One");
        var s2 = await _h.CreateStepAsync("Two (input)", withInputForm: true);
        var s3 = await _h.CreateStepAsync("Three");
        var s4 = await _h.CreateStepAsync("Four");
        var (_, versionId) = await _h.CreatePublishedWorkflowAsync("Bulk", true, new Place(s1), new Place(s2), new Place(s3, Skippable: true), new Place(s4));
        var id = await _h.InstantiateAsync(versionId);
        var steps = (await _h.GetAsync(id)).Steps.Select(s => s.StepInstanceId).ToArray();
        await _h.CompleteAsync(id, steps[0]);
        var before = await _h.GetAsync(id);

        // Evaluate: step 2 is missing its required input, so the set is blocked.
        var evaluation = Ok(await _h.WithServiceAsync(s => s.EvaluateCompletionAsync(id)));
        evaluation.IsReady.ShouldBeFalse();
        evaluation.CanBulkComplete.ShouldBeFalse();
        evaluation.Unresolved.Select(r => r.StepInstanceId).ShouldBe([steps[1], steps[2], steps[3]]);
        evaluation.Blocked.Select(r => r.StepInstanceId).ShouldBe([steps[1]]);
        evaluation.Blocked[0].Title.ShouldBe("Two (input)");
        evaluation.BulkCompletable.Select(r => r.StepInstanceId).ShouldBe([steps[2], steps[3]]);

        var auditBefore = (await _h.AuditAsync()).Count;
        var blocked = await _h.WithServiceAsync(s => s.BulkCompleteUnresolvedAsync(id, Ctx(TaskStatusCode.New)));
        ShouldFailWith(blocked, ErrorCodes.CompletionBlocked);
        blocked.Error!.Meta!["stepsMissingInputs"].ShouldBe(new List<int> { steps[1] });
        var after = await _h.GetAsync(id);
        after.Steps.Select(s => s.Status).ShouldBe(before.Steps.Select(s => s.Status));
        after.RowVersion.ShouldBe(before.RowVersion); // nothing was written
        (await _h.AuditAsync()).Count.ShouldBe(auditBefore);

        // Fill the missing input (draft save, not complete); now everything can be bulk-completed.
        Ok(await _h.WithServiceAsync(s => s.SaveStepValuesAsync(id, steps[1], Values("""{"note":"filled"}"""), null, Ctx())));
        Ok(await _h.WithServiceAsync(s => s.EvaluateCompletionAsync(id))).CanBulkComplete.ShouldBeTrue();

        var outcome = Ok(await _h.WithServiceAsync(s => s.BulkCompleteUnresolvedAsync(id, Ctx(TaskStatusCode.New))));
        outcome.AffectedStepInstanceIds.ShouldBe([steps[1], steps[2], steps[3]]);
        outcome.Instance.Steps.ShouldAllBe(s => s.Status == StepInstanceStatus.Completed); // Completed, never Skipped
        outcome.Instance.Progress.AllResolved.ShouldBeTrue();
        Ok(await _h.WithServiceAsync(s => s.EvaluateCompletionAsync(id))).IsReady.ShouldBeTrue();

        var bulk = (await _h.AuditAsync("STEP_COMPLETED")).Skip(1).ToList(); // the first completion (step 1) was individual
        bulk.Select(a => a.ObjectId).ShouldBe(steps.Skip(1).Select(s => s.ToString()));
        bulk.ShouldAllBe(a => a.Summary!.Contains("bulk=true"));
        bulk.Select(a => a.CorrelationId).Distinct().Count().ShouldBe(1);
        (await _h.AuditAsync("STEP_COMPLETED"))[0].Summary!.ShouldContain("bulk=false");

        // Nothing left: bulk complete is a no-op success.
        Ok(await _h.WithServiceAsync(s => s.BulkCompleteUnresolvedAsync(id, Ctx()))).AffectedStepInstanceIds.ShouldBeEmpty();
    }

    [Fact]
    public async Task A_stale_row_version_and_a_real_race_both_yield_concurrency_conflict()
    {
        var (id, steps) = await PublishAndStartAsync("Race", false, 4);
        var stale = (await _h.GetAsync(id)).RowVersion;

        await _h.StartAsync(id, steps[0]);
        ShouldFailWith(await _h.WithServiceAsync(s => s.StartStepAsync(id, steps[1], Ctx(rowVersion: stale))), ErrorCodes.ConcurrencyConflict);
        ShouldFailWith(await _h.WithServiceAsync(s => s.StartStepAsync(id, steps[1], Ctx(rowVersion: "not-base64!"))), ErrorCodes.ValidationFailed);
        var current = (await _h.GetAsync(id)).RowVersion;
        current.ShouldNotBe(stale);
        await _h.StartAsync(id, steps[1], Ctx(rowVersion: current));

        // Two simultaneous completions of different steps on the same instance: every outcome is a success or a conflict, and the stored state
        // matches exactly the successes (no lost update).
        var results = await Task.WhenAll(
            _h.WithServiceAsync(s => s.CompleteStepAsync(id, steps[2], null, Ctx())),
            _h.WithServiceAsync(s => s.CompleteStepAsync(id, steps[3], null, Ctx())));
        results.Count(r => r.IsSuccess).ShouldBeGreaterThanOrEqualTo(1);
        results.Where(r => r.IsFailure).ShouldAllBe(r => r.Error!.Code == ErrorCodes.ConcurrencyConflict);
        var view = await _h.GetAsync(id);
        view.Progress.Completed.ShouldBe(results.Count(r => r.IsSuccess));
        (await _h.AuditAsync("STEP_COMPLETED")).Count.ShouldBe(results.Count(r => r.IsSuccess));
    }

    [Fact]
    public async Task Audit_rows_and_state_commit_or_roll_back_together_with_the_callers_transaction()
    {
        var input = await _h.CreateStepAsync("Input", withInputForm: true);
        var second = await _h.CreateStepAsync("Second", withInputForm: true);
        var (_, versionId) = await _h.CreatePublishedWorkflowAsync("Tx", true, new Place(input), new Place(second));
        var id = await _h.InstantiateAsync(versionId);
        var steps = (await _h.GetAsync(id)).Steps.Select(s => s.StepInstanceId).ToArray();

        // Rolled back by the caller: no state, no values, no audit.
        var started = await _h.InTransactionAsync(async (_, svc) => await svc.StartStepAsync(id, steps[0], Ctx()), commit: false);
        started.IsSuccess.ShouldBeTrue();
        (await _h.GetAsync(id)).Steps[0].Status.ShouldBe(StepInstanceStatus.Pending);
        (await _h.AuditAsync()).ShouldBeEmpty();

        // Committed: the state change and its audit row land together.
        await _h.InTransactionAsync(async (_, svc) => await svc.StartStepAsync(id, steps[0], Ctx()), commit: true);
        (await _h.GetAsync(id)).Steps[0].Status.ShouldBe(StepInstanceStatus.InProgress);
        (await _h.AuditAsync("STEP_STARTED")).ShouldHaveSingleItem();

        // A failing operation inside the caller's transaction rolls back only itself (savepoint): the values it saved before failing the
        // ordering guard are gone, while the caller's earlier successful operation in the same transaction commits.
        var (earlier, failed) = await _h.InTransactionAsync(
            async (_, svc) =>
            {
                var ok = await svc.SaveStepValuesAsync(id, steps[0], Values("""{"note":"kept"}"""), null, Ctx());
                var bad = await svc.CompleteStepAsync(id, steps[1], Values("""{"note":"discarded"}"""), Ctx());
                return (ok, bad);
            },
            commit: true);
        earlier.IsSuccess.ShouldBeTrue();
        ShouldFailWith(failed, ErrorCodes.StepOrderViolation);
        var view = await _h.GetAsync(id);
        view.Steps[0].Values["note"].GetString().ShouldBe("kept");
        view.Steps[1].Values.ShouldBeEmpty();
        view.Steps[1].Status.ShouldBe(StepInstanceStatus.Pending);

        // The database enforces the snapshot: a step instance's configuration cannot be rewritten behind the service's back.
        var rewrite = await Should.ThrowAsync<Exception>(() => _factory.WithDbAsync(db =>
            db.Database.ExecuteSqlRawAsync("UPDATE dbo.StepInstance SET Title = N'Hacked' WHERE StepInstanceId = {0}", steps[0])));
        rewrite.ToString().ShouldContain("snapshot");
    }

    [Fact]
    public async Task Step_instances_are_unique_per_sequence_and_the_pinned_version_cannot_move()
    {
        var (id, _) = await PublishAndStartAsync("Pin", true, 2);
        var move = await Should.ThrowAsync<Exception>(() => _factory.WithDbAsync(db =>
            db.Database.ExecuteSqlRawAsync("UPDATE dbo.WorkflowInstance SET IsOrdered = 0 WHERE WorkflowInstanceId = {0}", id)));
        move.ToString().ShouldContain("pinned");
    }

    private static T Ok<T>(Result<T> result)
    {
        result.IsSuccess.ShouldBeTrue($"{result.Error?.Code}: {result.Error?.Message}");
        return result.Value;
    }
}
