using MatterFlow.Configuration.Contracts;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Application;
using MatterFlow.WorkManagement.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.WorkManagement;

public class TaskDueParserTests
{
    private static readonly UserTimeZone Chicago = UserTimeZone.Resolve("America/Chicago");

    [Fact]
    public void No_date_is_asap()
    {
        var due = TaskDueParser.Parse(null, null, Chicago.ToUtc);

        due.IsSuccess.ShouldBeTrue();
        due.Value.IsAsap.ShouldBeTrue();
        due.Value.DueSortKey.ShouldBeNull();
        due.Value.IsOverdue(DateTime.UtcNow.AddYears(50), Chicago.Zone).ShouldBeFalse();
    }

    [Fact]
    public void A_time_without_a_date_is_rejected_on_the_due_time_field()
    {
        var due = TaskDueParser.Parse(null, "09:00", Chicago.ToUtc);

        due.IsFailure.ShouldBeTrue();
        due.Error!.FieldErrors!.ContainsKey("dueTime").ShouldBeTrue();
    }

    [Fact]
    public void A_date_alone_is_a_floating_date_sorted_at_the_end_of_that_day()
    {
        var due = TaskDueParser.Parse(new DateOnly(2030, 3, 4), "  ", Chicago.ToUtc).Value;

        due.AtUtc.ShouldBeNull();
        due.Date.ShouldBe(new DateOnly(2030, 3, 4));
        due.DueSortKey!.Value.Date.ShouldBe(new DateTime(2030, 3, 4));
        due.DueSortKey.Value.TimeOfDay.ShouldBeGreaterThan(TimeSpan.FromHours(23));
    }

    [Theory]
    [InlineData("14:30", 20, 30)]
    [InlineData("4:05", 10, 5)]
    [InlineData("14:30:15", 20, 30)]
    public void A_date_with_a_time_is_the_instant_in_the_callers_zone(string time, int utcHour, int utcMinute)
    {
        var due = TaskDueParser.Parse(new DateOnly(2030, 1, 15), time, Chicago.ToUtc).Value;

        due.AtUtc.ShouldNotBeNull();
        due.AtUtc!.Value.Hour.ShouldBe(utcHour);
        due.AtUtc.Value.Minute.ShouldBe(utcMinute);
        due.AtUtc.Value.Kind.ShouldBe(DateTimeKind.Utc);
        due.DueSortKey.ShouldBe(due.AtUtc);
    }

    [Theory]
    [InlineData("25:00")]
    [InlineData("noon")]
    [InlineData("14.30")]
    public void An_unreadable_time_is_rejected(string time)
    {
        var due = TaskDueParser.Parse(new DateOnly(2030, 1, 15), time, Chicago.ToUtc);

        due.IsFailure.ShouldBeTrue();
        due.Error!.FieldErrors!.ContainsKey("dueTime").ShouldBeTrue();
    }
}

public class TaskActionRulesTests
{
    private static readonly string[] All =
    [
        "Task.View", "Task.Edit", "Task.Assign", "Task.SetPriority", "Task.ChangeStatus", "Task.Complete", "Task.Cancel", "Task.Reopen",
        "Task.Comment", "Workflow.Execute", "Workflow.StepReopen",
    ];

    private static TaskAllowedActions Compute(TaskStatusCode status, bool matterActive = true, params string[] without) =>
        TaskActionRules.Compute(status, matterActive, code => All.Contains(code) && !without.Contains(code));

    [Theory]
    [InlineData(TaskStatusCode.New, "START,HOLD,COMPLETE,CANCEL")]
    [InlineData(TaskStatusCode.InProgress, "HOLD,COMPLETE,CANCEL")]
    [InlineData(TaskStatusCode.OnHold, "RESUME,CANCEL")]
    [InlineData(TaskStatusCode.Completed, "REOPEN")]
    [InlineData(TaskStatusCode.Cancelled, "REOPEN")]
    public void Transitions_follow_the_matrix(TaskStatusCode status, string expected)
    {
        var actions = Compute(status);

        actions.Transitions.Select(t => t.Action).ShouldBe(expected.Split(','), ignoreOrder: true);
        actions.Transitions.ShouldAllBe(t => t.Permitted);
    }

    [Fact]
    public void Cancel_and_hold_require_a_comment_and_name_their_permission()
    {
        var actions = Compute(TaskStatusCode.InProgress);

        actions.Transitions.Single(t => t.Action == "CANCEL").RequiresComment.ShouldBeTrue();
        actions.Transitions.Single(t => t.Action == "HOLD").RequiresComment.ShouldBeTrue();
        actions.Transitions.Single(t => t.Action == "COMPLETE").RequiresComment.ShouldBeFalse();
        actions.Transitions.Single(t => t.Action == "CANCEL").RequiredPermission.ShouldBe("Task.Cancel");
        actions.Transitions.Single(t => t.Action == "COMPLETE").RequiredPermission.ShouldBe("Task.Complete");
    }

    [Fact]
    public void A_missing_permission_blocks_just_that_transition()
    {
        var actions = Compute(TaskStatusCode.InProgress, true, "Task.Cancel");

        var cancel = actions.Transitions.Single(t => t.Action == "CANCEL");
        cancel.Permitted.ShouldBeFalse();
        cancel.BlockedReason.ShouldBe(ErrorCodes.PermissionDenied);
        actions.Transitions.Single(t => t.Action == "HOLD").Permitted.ShouldBeTrue();
    }

    [Fact]
    public void Reopening_is_blocked_while_the_matter_is_inactive_and_a_completed_task_offers_nothing_else()
    {
        var actions = Compute(TaskStatusCode.Completed, matterActive: false);

        var reopen = actions.Transitions.Single(t => t.Action == "REOPEN");
        reopen.Permitted.ShouldBeFalse();
        reopen.BlockedReason.ShouldBe(ErrorCodes.MatterInactive);
        actions.Transitions.Count.ShouldBe(1);
        actions.CanReopenSteps.ShouldBeFalse();
    }

    [Theory]
    [InlineData(TaskStatusCode.New, true, true, true, true)]
    [InlineData(TaskStatusCode.InProgress, true, true, true, true)]
    [InlineData(TaskStatusCode.OnHold, true, true, false, false)]
    [InlineData(TaskStatusCode.Completed, false, false, false, true)]
    [InlineData(TaskStatusCode.Cancelled, false, false, false, false)]
    public void Edit_assign_and_step_flags_follow_the_editability_table(TaskStatusCode status, bool edit, bool assign, bool execute, bool reopenSteps)
    {
        var actions = Compute(status);

        actions.CanEdit.ShouldBe(edit);
        actions.CanAssign.ShouldBe(assign);
        actions.CanSetPriority.ShouldBe(assign);
        actions.CanExecuteSteps.ShouldBe(execute);
        actions.CanReopenSteps.ShouldBe(reopenSteps);
        actions.CanComment.ShouldBeTrue();
    }

    [Fact]
    public void Without_any_permission_nothing_is_offered_except_blocked_transitions()
    {
        var actions = TaskActionRules.Compute(TaskStatusCode.InProgress, true, _ => false);

        actions.CanEdit.ShouldBeFalse();
        actions.CanAssign.ShouldBeFalse();
        actions.CanComment.ShouldBeFalse();
        actions.CanExecuteSteps.ShouldBeFalse();
        actions.Transitions.ShouldAllBe(t => !t.Permitted && t.BlockedReason == ErrorCodes.PermissionDenied);
    }
}

public class TaskSupportTests
{
    [Fact]
    public void Comments_are_escaped_and_line_breaks_kept()
    {
        TaskSupport.ToSafeHtml("  <script>alert(1)</script> & \"quotes\"\r\nnext\nline ").ShouldBe(
            "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;<br>next<br>line</p>");
    }

    [Fact]
    public void Row_version_checks_distinguish_garbage_stale_and_current_tokens()
    {
        byte[] current = [1, 2, 3, 4, 5, 6, 7, 8];
        var token = Convert.ToBase64String(current);

        TaskSupport.CheckRowVersion(current, token).IsSuccess.ShouldBeTrue();

        var stale = TaskSupport.CheckRowVersion(current, Convert.ToBase64String([9, 9, 9, 9, 9, 9, 9, 9]));
        stale.Error!.Code.ShouldBe(ErrorCodes.ConcurrencyConflict);
        stale.Error.Meta!["currentRowVersion"].ShouldBe(token);

        TaskSupport.CheckRowVersion(current, "***").Error!.Code.ShouldBe(ErrorCodes.ValidationFailed);
        TaskSupport.CheckRowVersion(current, string.Empty).Error!.Code.ShouldBe(ErrorCodes.ConcurrencyConflict);
    }

    [Fact]
    public void Status_filters_accept_case_insensitive_codes_and_reject_unknown_ones()
    {
        TaskSupport.ParseStatuses("new, in_progress").Value.ShouldBe([TaskStatusCode.New, TaskStatusCode.InProgress]);
        TaskSupport.ParseStatuses(null).Value.ShouldBeEmpty();
        TaskSupport.ParseStatuses("NEW,DONE").Error!.FieldErrors!.ContainsKey("status").ShouldBeTrue();
    }

    [Fact]
    public void Text_validation_reports_each_bad_field()
    {
        TaskSupport.ValidateTexts("Title", null, "Pat", null).ShouldBeNull();

        var error = TaskSupport.ValidateTexts(" ", new string('x', 20001), "", "nope");
        error!.FieldErrors!.Keys.ShouldBe(["title", "description", "requestorName", "requestorEmail"], ignoreOrder: true);
    }

    [Fact]
    public void The_priority_rank_expression_maps_ids_to_sort_orders_and_unknown_ids_last()
    {
        var rank = TaskService.PriorityRank(
        [
            new PriorityInfo(7, "Critical", 1, "critical", true, false),
            new PriorityInfo(3, "Normal", 3, "normal", true, true),
            new PriorityInfo(9, "High", 2, "high", true, false),
        ]).Compile();

        rank(new WorkTask { PriorityId = 7 }).ShouldBe(1);
        rank(new WorkTask { PriorityId = 9 }).ShouldBe(2);
        rank(new WorkTask { PriorityId = 3 }).ShouldBe(3);
        rank(new WorkTask { PriorityId = 42 }).ShouldBe(int.MaxValue);
    }
}
