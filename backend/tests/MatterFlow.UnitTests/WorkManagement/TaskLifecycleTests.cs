using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.WorkManagement;

public class TaskLifecycleTests
{
    private const TaskStatusCode N = TaskStatusCode.New;
    private const TaskStatusCode P = TaskStatusCode.InProgress;
    private const TaskStatusCode H = TaskStatusCode.OnHold;
    private const TaskStatusCode C = TaskStatusCode.Completed;
    private const TaskStatusCode X = TaskStatusCode.Cancelled;

    // Expected permission per cell (null = forbidden). Written out independently of the implementation (architecture 8.3).
    private static readonly Dictionary<(TaskStatusCode, TaskStatusCode), string> Allowed = new()
    {
        [(N, P)] = "Task.ChangeStatus",
        [(N, H)] = "Task.ChangeStatus",
        [(N, C)] = "Task.Complete",
        [(N, X)] = "Task.Cancel",
        [(P, H)] = "Task.ChangeStatus",
        [(P, C)] = "Task.Complete",
        [(P, X)] = "Task.Cancel",
        [(H, P)] = "Task.ChangeStatus",
        [(H, X)] = "Task.Cancel",
        [(C, P)] = "Task.Reopen",
        [(C, X)] = "Task.Cancel",
        [(X, P)] = "Task.Reopen",
    };

    private static readonly TaskStatusCode[] All = [N, P, H, C, X];

    public static IEnumerable<object[]> Cells() =>
        from f in All from t in All select new object[] { f, t };

    private static bool NeedsComment(TaskStatusCode to) => to is TaskStatusCode.Cancelled or TaskStatusCode.OnHold;

    private static string CommentCode(TaskStatusCode to) => to == TaskStatusCode.Cancelled ? "CANCEL_COMMENT_REQUIRED" : "HOLD_COMMENT_REQUIRED";

    [Theory]
    [MemberData(nameof(Cells))]
    public void Every_cell_under_every_context(TaskStatusCode from, TaskStatusCode to)
    {
        foreach (var matter in new[] { true, false })
            foreach (var comment in new[] { true, false })
                foreach (var ready in new[] { true, false })
                {
                    var d = TaskLifecycle.Evaluate(from, to, new TransitionContext(matter, comment, ready));

                    if (!Allowed.TryGetValue((from, to), out var permission))
                    {
                        d.Allowed.ShouldBeFalse();
                        d.ErrorCode.ShouldBe("INVALID_STATUS_TRANSITION");
                        d.RequiredPermission.ShouldBeNull();
                        d.Effects.ShouldBeNull();
                        continue;
                    }

                    var isReopen = permission == "Task.Reopen";
                    var isComplete = to == C;

                    string? expectedError = null;
                    if (isReopen && !matter)
                        expectedError = "MATTER_INACTIVE";
                    else if (NeedsComment(to) && !comment)
                        expectedError = CommentCode(to);
                    else if (isComplete && !ready)
                        expectedError = "COMPLETION_BLOCKED";

                    d.ErrorCode.ShouldBe(expectedError, $"{from}->{to} matter={matter} comment={comment} ready={ready}");
                    d.Allowed.ShouldBe(expectedError is null);

                    if (expectedError is null)
                    {
                        d.RequiredPermission.ShouldBe(permission);
                        d.Effects.ShouldNotBeNull();
                        d.Effects!.UpdateStatusChangedAt.ShouldBeTrue();
                        d.Effects.SetCompletedAt.ShouldBe(to == C);
                        d.Effects.ClearCompletedAt.ShouldBe(from == C);
                        d.Effects.RequiredCommentPurpose.ShouldBe(
                            to == X ? TaskCommentPurpose.Cancel : to == H ? TaskCommentPurpose.OnHold : (TaskCommentPurpose?)null);
                    }
                    else
                    {
                        d.RequiredPermission.ShouldBeNull();
                        d.Effects.ShouldBeNull();
                    }
                }
    }

    [Fact]
    public void Matrix_has_exactly_twelve_allowed_cells()
    {
        var count = (from f in All from t in All where TaskLifecycle.IsStructurallyAllowed(f, t) select 1).Count();
        count.ShouldBe(12);
        count.ShouldBe(Allowed.Count);
    }

    [Theory]
    [InlineData(TaskStatusCode.New)]
    [InlineData(TaskStatusCode.InProgress)]
    [InlineData(TaskStatusCode.OnHold)]
    [InlineData(TaskStatusCode.Completed)]
    [InlineData(TaskStatusCode.Cancelled)]
    public void Same_status_is_invalid_even_with_full_context(TaskStatusCode s)
    {
        var d = TaskLifecycle.Evaluate(s, s, new TransitionContext(true, true, true));
        d.ErrorCode.ShouldBe("INVALID_STATUS_TRANSITION");
    }

    [Fact]
    public void Completed_to_cancelled_is_direct_and_clears_completed_at()
    {
        var d = TaskLifecycle.Evaluate(C, X, new TransitionContext(false, true));
        d.Allowed.ShouldBeTrue();
        d.Effects!.ClearCompletedAt.ShouldBeTrue();
    }

    [Fact]
    public void Cancel_and_hold_do_not_require_an_active_matter()
    {
        TaskLifecycle.Evaluate(P, X, new TransitionContext(false, true)).Allowed.ShouldBeTrue();
        TaskLifecycle.Evaluate(P, H, new TransitionContext(false, true)).Allowed.ShouldBeTrue();
    }

    [Fact]
    public void Resume_needs_no_comment()
    {
        TaskLifecycle.Evaluate(H, P, new TransitionContext(true, false)).Allowed.ShouldBeTrue();
    }

    [Fact]
    public void Matter_inactive_takes_precedence_over_other_blockers_for_reopen()
    {
        TaskLifecycle.Evaluate(X, P, new TransitionContext(false, false, false)).ErrorCode.ShouldBe("MATTER_INACTIVE");
    }

    [Fact]
    public void Assignment_cause_is_only_valid_for_new_to_in_progress_and_uses_assign_permission()
    {
        var ctx = new TransitionContext(Cause: TransitionCause.Assignment);
        var ok = TaskLifecycle.Evaluate(N, P, ctx);
        ok.Allowed.ShouldBeTrue();
        ok.RequiredPermission.ShouldBe("Task.Assign");

        foreach (var f in All)
            foreach (var t in All)
            {
                if (f == N && t == P)
                    continue;
                TaskLifecycle.Evaluate(f, t, new TransitionContext(true, true, true, TransitionCause.Assignment)).Allowed.ShouldBeFalse();
            }
    }

    [Fact]
    public void Step_reopen_cause_is_only_valid_for_completed_to_in_progress_and_uses_step_reopen_permission()
    {
        var ok = TaskLifecycle.Evaluate(C, P, new TransitionContext(Cause: TransitionCause.StepReopen));
        ok.Allowed.ShouldBeTrue();
        ok.RequiredPermission.ShouldBe("Workflow.StepReopen");
        ok.Effects!.ClearCompletedAt.ShouldBeTrue();

        TaskLifecycle.Evaluate(C, P, new TransitionContext(MatterActive: false, Cause: TransitionCause.StepReopen))
            .ErrorCode.ShouldBe("MATTER_INACTIVE");

        // A step reopen cannot reopen a cancelled task, nor do anything else.
        foreach (var f in All)
            foreach (var t in All)
            {
                if (f == C && t == P)
                    continue;
                TaskLifecycle.Evaluate(f, t, new TransitionContext(true, true, true, TransitionCause.StepReopen)).Allowed.ShouldBeFalse();
            }
    }

    [Fact]
    public void Status_codes_round_trip_and_open_states()
    {
        foreach (var s in All)
        {
            TaskStatusCodeExtensions.TryParse(s.ToCode(), out var back).ShouldBeTrue();
            back.ShouldBe(s);
        }

        TaskStatusCodeExtensions.TryParse("new", out _).ShouldBeFalse();
        TaskStatusCodeExtensions.TryParse(null, out _).ShouldBeFalse();
        All.Where(s => s.IsOpen()).ShouldBe([N, P, H]);
        N.ToCode().ShouldBe("NEW");
        P.ToCode().ShouldBe("IN_PROGRESS");
    }

    [Fact]
    public void Comment_purposes_cancel_and_on_hold_are_not_deletable()
    {
        TaskCommentPurpose.Normal.IsDeletable().ShouldBeTrue();
        TaskCommentPurpose.Cancel.IsDeletable().ShouldBeFalse();
        TaskCommentPurpose.OnHold.IsDeletable().ShouldBeFalse();
        TaskCommentPurpose.Normal.ToCode().ShouldBe("NORMAL");
        TaskCommentPurpose.Cancel.ToCode().ShouldBe("CANCEL");
        TaskCommentPurpose.OnHold.ToCode().ShouldBe("ON_HOLD");
    }
}
