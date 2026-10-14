using MatterFlow.SharedKernel.Tasks;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.WorkManagement;

public class TaskEditabilityTests
{
    private const bool Y = true;
    private const bool No = false;

    // Rows follow architecture 8.3 rule 5; columns NEW, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED.
    [Theory]
    [InlineData(TaskOperation.EditDetails, Y, Y, Y, No, No)]
    [InlineData(TaskOperation.AssignOrPrioritize, Y, Y, Y, No, No)]
    [InlineData(TaskOperation.LinkAssets, Y, Y, Y, No, No)]
    [InlineData(TaskOperation.StepAction, Y, Y, No, No, No)]
    [InlineData(TaskOperation.StepReopen, No, Y, No, Y, No)]
    [InlineData(TaskOperation.Comment, Y, Y, Y, Y, Y)]
    public void Editability_table(TaskOperation op, bool n, bool p, bool h, bool c, bool x)
    {
        TaskEditability.IsAllowed(TaskStatusCode.New, op).ShouldBe(n);
        TaskEditability.IsAllowed(TaskStatusCode.InProgress, op).ShouldBe(p);
        TaskEditability.IsAllowed(TaskStatusCode.OnHold, op).ShouldBe(h);
        TaskEditability.IsAllowed(TaskStatusCode.Completed, op).ShouldBe(c);
        TaskEditability.IsAllowed(TaskStatusCode.Cancelled, op).ShouldBe(x);
    }

    [Fact]
    public void Check_returns_task_not_editable_when_blocked()
    {
        TaskEditability.Check(TaskStatusCode.Completed, TaskOperation.EditDetails).ShouldBe("TASK_NOT_EDITABLE");
        TaskEditability.Check(TaskStatusCode.New, TaskOperation.EditDetails).ShouldBeNull();
    }
}

public class TaskAssignmentTests
{
    [Fact]
    public void Assigning_a_user_to_a_new_task_starts_it()
    {
        var o = TaskAssignment.Apply(TaskStatusCode.New, 7, 1, true);
        o.Status.ShouldBe(TaskStatusCode.InProgress);
        o.AutoStarted.ShouldBeTrue();
        o.UserNotInPodWarning.ShouldBeFalse();
    }

    [Fact]
    public void Pod_only_assignment_does_not_start()
    {
        var o = TaskAssignment.Apply(TaskStatusCode.New, null, 1, null);
        o.Status.ShouldBe(TaskStatusCode.New);
        o.AutoStarted.ShouldBeFalse();
    }

    [Fact]
    public void Unassigning_never_reverts()
    {
        TaskAssignment.Apply(TaskStatusCode.InProgress, null, null, null).Status.ShouldBe(TaskStatusCode.InProgress);
        TaskAssignment.Apply(TaskStatusCode.OnHold, null, 2, null).Status.ShouldBe(TaskStatusCode.OnHold);
    }

    [Theory]
    [InlineData(TaskStatusCode.InProgress)]
    [InlineData(TaskStatusCode.OnHold)]
    public void Assigning_in_other_open_states_keeps_status(TaskStatusCode s)
    {
        var o = TaskAssignment.Apply(s, 7, null, null);
        o.Status.ShouldBe(s);
        o.AutoStarted.ShouldBeFalse();
    }

    [Fact]
    public void User_outside_pod_is_allowed_with_a_warning()
    {
        var o = TaskAssignment.Apply(TaskStatusCode.New, 7, 1, false);
        o.Status.ShouldBe(TaskStatusCode.InProgress);
        o.UserNotInPodWarning.ShouldBeTrue();
    }

    [Fact]
    public void No_warning_without_a_pod_or_without_a_user()
    {
        TaskAssignment.Apply(TaskStatusCode.New, 7, null, false).UserNotInPodWarning.ShouldBeFalse();
        TaskAssignment.Apply(TaskStatusCode.New, null, 1, false).UserNotInPodWarning.ShouldBeFalse();
    }
}

public class TaskDueTests
{
    private static readonly TimeZoneInfo NewYork = UserTimeZone.Resolve("America/New_York").Zone;
    private static readonly TimeZoneInfo LosAngeles = UserTimeZone.Resolve("America/Los_Angeles").Zone;
    private static readonly TimeZoneInfo Tokyo = UserTimeZone.Resolve("Asia/Tokyo").Zone;

    private static DateTime Utc(int y, int m, int d, int h = 0, int min = 0, int s = 0) => new(y, m, d, h, min, s, DateTimeKind.Utc);

    [Fact]
    public void Asap_is_never_overdue_and_has_no_sort_key()
    {
        var due = TaskDue.Asap;
        due.IsAsap.ShouldBeTrue();
        due.DueSortKey.ShouldBeNull();
        due.IsOverdue(Utc(2099, 1, 1), NewYork).ShouldBeFalse();
        due.IsOverdue(TaskStatusCode.New, Utc(2099, 1, 1), Tokyo).ShouldBeFalse();
        default(TaskDue).IsAsap.ShouldBeTrue();
    }

    [Fact]
    public void Date_only_boundary_in_viewer_zone()
    {
        var due = TaskDue.OnDate(new DateOnly(2026, 10, 14));
        due.IsOverdue(Utc(2026, 10, 15, 3, 59, 59), NewYork).ShouldBeFalse();
        due.IsOverdue(Utc(2026, 10, 15, 4, 0, 0), NewYork).ShouldBeTrue();
    }

    [Fact]
    public void Viewers_in_different_zones_can_disagree_on_date_only()
    {
        var due = TaskDue.OnDate(new DateOnly(2026, 10, 14));
        var now = Utc(2026, 10, 15, 5, 0, 0);
        due.IsOverdue(now, NewYork).ShouldBeTrue();
        due.IsOverdue(now, LosAngeles).ShouldBeFalse();
        due.IsOverdue(now, Tokyo).ShouldBeTrue();
    }

    [Fact]
    public void Timed_due_is_an_absolute_instant_for_every_viewer()
    {
        var due = TaskDue.At(new DateOnly(2026, 10, 14), Utc(2026, 10, 14, 15, 0, 0));
        foreach (var zone in new[] { NewYork, LosAngeles, Tokyo })
        {
            due.IsOverdue(Utc(2026, 10, 14, 15, 0, 0), zone).ShouldBeFalse();
            due.IsOverdue(Utc(2026, 10, 14, 15, 0, 1), zone).ShouldBeTrue();
        }
    }

    [Fact]
    public void Timed_due_overrides_the_date_end_of_day()
    {
        // 09:00 on the due date has passed even though the calendar day has not ended.
        var due = TaskDue.At(new DateOnly(2026, 10, 14), Utc(2026, 10, 14, 13, 0, 0));
        due.IsOverdue(Utc(2026, 10, 14, 20, 0, 0), NewYork).ShouldBeTrue();
    }

    [Fact]
    public void Dst_spring_forward_day_and_fall_back_day()
    {
        // US DST starts 2026-03-08 (23-hour day): midnight local on the 9th is 04:00Z (EDT).
        var spring = TaskDue.OnDate(new DateOnly(2026, 3, 8));
        spring.IsOverdue(Utc(2026, 3, 9, 3, 59, 59), NewYork).ShouldBeFalse();
        spring.IsOverdue(Utc(2026, 3, 9, 4, 0, 0), NewYork).ShouldBeTrue();

        // US DST ends 2026-11-01 (25-hour day): midnight local on the 2nd is 05:00Z (EST).
        var fall = TaskDue.OnDate(new DateOnly(2026, 11, 1));
        fall.IsOverdue(Utc(2026, 11, 2, 4, 59, 59), NewYork).ShouldBeFalse();
        fall.IsOverdue(Utc(2026, 11, 2, 5, 0, 0), NewYork).ShouldBeTrue();
    }

    [Theory]
    [InlineData(TaskStatusCode.New, true)]
    [InlineData(TaskStatusCode.InProgress, true)]
    [InlineData(TaskStatusCode.OnHold, true)]
    [InlineData(TaskStatusCode.Completed, false)]
    [InlineData(TaskStatusCode.Cancelled, false)]
    public void Only_open_tasks_are_overdue(TaskStatusCode status, bool expected)
    {
        var due = TaskDue.OnDate(new DateOnly(2020, 1, 1));
        due.IsOverdue(status, Utc(2026, 1, 1), NewYork).ShouldBe(expected);
    }

    [Fact]
    public void Sort_key_matches_shared_helper()
    {
        var d = new DateOnly(2026, 10, 14);
        TaskDue.OnDate(d).DueSortKey.ShouldBe(DueDates.SortKey(d, null));
        TaskDue.OnDate(d).DueSortKey!.Value.TimeOfDay.ShouldBe(TimeOnly.MaxValue.ToTimeSpan());
        var at = Utc(2026, 10, 14, 15, 0, 0);
        TaskDue.At(d, at).DueSortKey.ShouldBe(at);
    }

    [Fact]
    public void From_stored_rejects_time_without_date_and_normalizes_kind()
    {
        Should.Throw<ArgumentException>(() => TaskDue.FromStored(null, Utc(2026, 1, 1)));
        var due = TaskDue.FromStored(new DateOnly(2026, 1, 1), new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Unspecified));
        due.AtUtc!.Value.Kind.ShouldBe(DateTimeKind.Utc);
        TaskDue.FromStored(null, null).IsAsap.ShouldBeTrue();
    }
}

public class TaskNumberTests
{
    [Fact]
    public void Formats_from_sequence()
    {
        TaskNumber.Format(1042).ShouldBe("TSK-1042");
        TaskNumber.Format(1).ShouldBe("TSK-1");
        Should.Throw<ArgumentOutOfRangeException>(() => TaskNumber.Format(0));
    }

    [Theory]
    [InlineData("TSK-1042", 1042)]
    [InlineData("tsk-7", 7)]
    [InlineData(" 1042 ", 1042)]
    public void Parses(string input, long expected)
    {
        TaskNumber.TryParse(input, out var v).ShouldBeTrue();
        v.ShouldBe(expected);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("TSK-")]
    [InlineData("TSK-0")]
    [InlineData("TSK-12a")]
    [InlineData("-5")]
    [InlineData("12345678901234567890")]
    public void Rejects(string? input)
    {
        TaskNumber.TryParse(input, out _).ShouldBeFalse();
    }
}

public class TaskValidationTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Title_required(string? v) => TaskValidation.ValidateTitle(v)!.Code.ShouldBe("REQUIRED");

    [Fact]
    public void Title_length()
    {
        TaskValidation.ValidateTitle(new string('a', 200)).ShouldBeNull();
        TaskValidation.ValidateTitle(new string('a', 201))!.Code.ShouldBe("TOO_LONG");
    }

    [Fact]
    public void Description_optional_with_limit()
    {
        TaskValidation.ValidateDescription(null).ShouldBeNull();
        TaskValidation.ValidateDescription(new string('a', 20000)).ShouldBeNull();
        TaskValidation.ValidateDescription(new string('a', 20001))!.Code.ShouldBe("TOO_LONG");
    }

    [Fact]
    public void Requestor_name_required()
    {
        TaskValidation.ValidateRequestorName(" ")!.Code.ShouldBe("REQUIRED");
        TaskValidation.ValidateRequestorName("Jane Doe").ShouldBeNull();
        TaskValidation.ValidateRequestorName(new string('a', 201))!.Code.ShouldBe("TOO_LONG");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("jane@firm.com")]
    [InlineData("jane.doe+x@mail.firm.co.uk")]
    public void Email_valid_or_absent(string? v) => TaskValidation.ValidateRequestorEmail(v).ShouldBeNull();

    [Theory]
    [InlineData("jane")]
    [InlineData("jane@")]
    [InlineData("@firm.com")]
    [InlineData("jane@firm")]
    [InlineData("a@b@c.com")]
    [InlineData("jane doe@firm.com")]
    [InlineData("Jane <jane@firm.com>")]
    [InlineData("jane@firm..com")]
    public void Email_invalid(string v) => TaskValidation.ValidateRequestorEmail(v)!.Code.ShouldBe("INVALID_EMAIL");

    [Fact]
    public void Email_too_long()
    {
        TaskValidation.ValidateRequestorEmail(new string('a', 250) + "@b.co")!.Code.ShouldBe("TOO_LONG");
    }
}
