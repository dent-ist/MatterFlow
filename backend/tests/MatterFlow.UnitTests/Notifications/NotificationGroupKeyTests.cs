using MatterFlow.Notifications.Application;
using MatterFlow.Notifications.Contracts;
using Shouldly;

namespace MatterFlow.UnitTests.Notifications;

/// <summary>The grouping key of the overdue notices (PM v2, #884): display only, set for exactly two kinds of notice.</summary>
public class NotificationGroupKeyTests
{
    private static readonly DateTime Created = new(2026, 10, 22, 14, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void The_overdue_notices_of_the_managers_and_of_the_assignee_get_a_key_by_day_and_kind()
    {
        NotificationService.GroupKeyOf(nameof(NotificationEventType.MatterTaskOverdue), "overdue:42:2026-10-19", Created).ShouldBe("overdue:2026-10-22:manager");
        NotificationService.GroupKeyOf(nameof(NotificationEventType.TaskDue), "overdue:2026-10-19", Created).ShouldBe("overdue:2026-10-22:assignee");
    }

    [Fact]
    public void Every_other_notice_has_no_key()
    {
        NotificationService.GroupKeyOf(nameof(NotificationEventType.TaskDue), "soon:2026-10-23", Created).ShouldBeNull();
        NotificationService.GroupKeyOf(nameof(NotificationEventType.TaskAssigned), "assigned:1", Created).ShouldBeNull();
        NotificationService.GroupKeyOf(nameof(NotificationEventType.MatterTaskStalled), "hold:1", Created).ShouldBeNull();
    }

    [Fact]
    public void Two_notices_of_one_day_share_a_key_and_another_day_does_not()
    {
        var a = NotificationService.GroupKeyOf(nameof(NotificationEventType.MatterTaskOverdue), "overdue:1:2026-10-19", Created);
        var b = NotificationService.GroupKeyOf(nameof(NotificationEventType.MatterTaskOverdue), "overdue:2:2026-10-20", Created.AddHours(2));
        var c = NotificationService.GroupKeyOf(nameof(NotificationEventType.MatterTaskOverdue), "overdue:3:2026-10-20", Created.AddDays(1));
        a.ShouldBe(b);
        a.ShouldNotBe(c);
    }
}
