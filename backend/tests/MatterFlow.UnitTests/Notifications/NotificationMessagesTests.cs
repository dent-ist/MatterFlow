using MatterFlow.Notifications.Contracts;
using Shouldly;

namespace MatterFlow.UnitTests.Notifications;

/// <summary>The wording of README section 3.1 (docs/ux/notifications-review): exact text, trimming and excerpts.</summary>
public class NotificationMessagesTests
{
    [Fact]
    public void Event_1_assigned_and_reassigned()
    {
        NotificationMessages.TaskAssigned("TSK-1042", "Review privilege log", "Acme v. Smith")
            .ShouldBe("Assigned to you - TSK-1042 \"Review privilege log\" on Acme v. Smith");
        NotificationMessages.TaskAssigned("TSK-1042", "Review privilege log", "Acme v. Smith", reassigned: true)
            .ShouldBe("Reassigned to you - TSK-1042 \"Review privilege log\" on Acme v. Smith");
    }

    [Fact]
    public void Event_2_due_soon_today_and_tomorrow_and_overdue()
    {
        var today = new DateOnly(2026, 10, 22);
        NotificationMessages.TaskDueSoon("TSK-1042", "Review privilege log", "Acme v. Smith", new DateOnly(2026, 10, 23), today)
            .ShouldBe("Due tomorrow - TSK-1042 \"Review privilege log\" on Acme v. Smith");
        NotificationMessages.TaskDueSoon("TSK-1042", "Review privilege log", "Acme v. Smith", today, today)
            .ShouldBe("Due today - TSK-1042 \"Review privilege log\" on Acme v. Smith");
        NotificationMessages.TaskOverdue("TSK-1042", "Review privilege log", "Acme v. Smith", new DateOnly(2026, 10, 19), today)
            .ShouldBe("Overdue by 3 days - TSK-1042 \"Review privilege log\" on Acme v. Smith");
        NotificationMessages.TaskOverdue("TSK-1042", "Review privilege log", "Acme v. Smith", new DateOnly(2026, 10, 21), today)
            .ShouldBe("Overdue by 1 day - TSK-1042 \"Review privilege log\" on Acme v. Smith");
        NotificationMessages.TaskOverdue("TSK-1042", "Review privilege log", "Acme v. Smith", today, today)
            .ShouldBe("Overdue - TSK-1042 \"Review privilege log\" on Acme v. Smith");
    }

    [Fact]
    public void Event_3_comment_and_mention_name_the_person_and_not_the_text()
    {
        NotificationMessages.TaskComment("Ann Lee", "TSK-1042", "Review privilege log", "Acme v. Smith")
            .ShouldBe("New comment from Ann Lee - TSK-1042 \"Review privilege log\" on Acme v. Smith");
        NotificationMessages.TaskMention("Ann Lee", "TSK-1042", "Review privilege log", "Acme v. Smith")
            .ShouldBe("Mentioned by Ann Lee - TSK-1042 \"Review privilege log\" on Acme v. Smith");
    }

    [Fact]
    public void Events_4_to_8()
    {
        NotificationMessages.MatterTaskOverdue("TSK-1042", "Review privilege log", "Acme v. Smith", new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 22))
            .ShouldBe("Overdue by 2 days - TSK-1042 \"Review privilege log\" on Acme v. Smith");
        NotificationMessages.MatterTaskCreated("TSK-1051", "Load production volume 3", "Acme v. Smith")
            .ShouldBe("New task on your matter - TSK-1051 \"Load production volume 3\" on Acme v. Smith");
        NotificationMessages.MatterTaskUnassigned("TSK-1042", "Review privilege log", "Acme v. Smith", 2)
            .ShouldBe("Unassigned for 2 days - TSK-1042 \"Review privilege log\" on Acme v. Smith");
        NotificationMessages.MatterTaskOnHold("TSK-1042", "Review privilege log", "Acme v. Smith", 6)
            .ShouldBe("On hold for 6 days - TSK-1042 \"Review privilege log\" on Acme v. Smith");
        NotificationMessages.MatterTaskOnHold("TSK-1042", "Review privilege log", "Acme v. Smith", 1)
            .ShouldBe("On hold for 1 day - TSK-1042 \"Review privilege log\" on Acme v. Smith");
        NotificationMessages.MatterManagerSet(true, "Acme v. Smith").ShouldBe("You are now Primary manager - Acme v. Smith");
        NotificationMessages.MatterManagerSet(false, "Acme v. Smith").ShouldBe("You are now Secondary manager - Acme v. Smith");
        NotificationMessages.PodTaskUnassigned("TSK-1042", "Review privilege log", "Acme v. Smith", "Demo Processing Pod")
            .ShouldBe("Unassigned in Demo Processing Pod - TSK-1042 \"Review privilege log\" on Acme v. Smith");
    }

    [Fact]
    public void No_message_ends_with_a_full_stop_and_the_reason_comes_first()
    {
        var today = new DateOnly(2026, 10, 22);
        string[] all =
        [
            NotificationMessages.TaskAssigned("TSK-1", "T", "M"),
            NotificationMessages.TaskDueSoon("TSK-1", "T", "M", today, today),
            NotificationMessages.TaskOverdue("TSK-1", "T", "M", today.AddDays(-2), today),
            NotificationMessages.TaskComment("Ann", "TSK-1", "T", "M"),
            NotificationMessages.TaskMention("Ann", "TSK-1", "T", "M"),
            NotificationMessages.MatterTaskOverdue("TSK-1", "T", "M", today.AddDays(-2), today),
            NotificationMessages.MatterTaskCreated("TSK-1", "T", "M"),
            NotificationMessages.MatterTaskUnassigned("TSK-1", "T", "M", 2),
            NotificationMessages.MatterTaskOnHold("TSK-1", "T", "M", 5),
            NotificationMessages.MatterManagerSet(true, "M"),
            NotificationMessages.PodTaskUnassigned("TSK-1", "T", "M", "P"),
        ];
        foreach (var message in all)
        {
            message.ShouldNotEndWith(".");
            message.IndexOf(" - ", StringComparison.Ordinal).ShouldBeGreaterThan(0, message);
        }
    }

    [Fact]
    public void A_long_title_is_cut_at_60_characters_with_an_ellipsis()
    {
        var title = new string('a', 100);
        var cut = NotificationMessages.Title(title);
        cut.Length.ShouldBe(NotificationMessages.TitleLimit);
        cut.ShouldEndWith("…");
        NotificationMessages.Title(new string('b', 60)).ShouldBe(new string('b', 60));
    }

    [Fact]
    public void A_long_excerpt_is_cut_at_80_characters_including_the_closing_dots()
    {
        var excerpt = NotificationMessages.Excerpt(new string('x', 200));
        excerpt.Length.ShouldBe(NotificationMessages.ExcerptLimit);
        excerpt.ShouldEndWith("...");
        NotificationMessages.Excerpt("  two\n\nlines\t here ").ShouldBe("two lines here");
    }

    [Fact]
    public void Text_is_single_line_without_angle_brackets_and_never_longer_than_300()
    {
        var message = NotificationMessages.TaskAssigned("TSK-1", "<script>alert(1)</script>\r\nTitle", new string('m', 400));
        message.ShouldNotContain("<");
        message.ShouldNotContain(">");
        message.ShouldNotContain("\n");
        message.Length.ShouldBeLessThanOrEqualTo(NotificationMessages.MaxLength);
        message.ShouldStartWith("Assigned to you - TSK-1 \"script");
    }
}
