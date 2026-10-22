using MatterFlow.Notifications.Contracts;
using Shouldly;

namespace MatterFlow.UnitTests.Notifications;

/// <summary>The wording of README section 3.1 (docs/ux/notifications-review): exact text, trimming and excerpts.</summary>
public class NotificationMessagesTests
{
    [Fact]
    public void Event_1_assigned()
    {
        NotificationMessages.TaskAssigned("Ann Lee", "TSK-1042", "Review privilege log", "Acme v. Smith")
            .ShouldBe("Ann Lee assigned you TSK-1042 \"Review privilege log\" (Acme v. Smith).");
    }

    [Fact]
    public void Event_2_due_soon_today_and_tomorrow_and_overdue()
    {
        var today = new DateOnly(2026, 10, 22);
        NotificationMessages.TaskDueSoon("TSK-1042", "Review privilege log", new DateOnly(2026, 10, 23), today)
            .ShouldBe("TSK-1042 \"Review privilege log\" is due tomorrow (Oct 23).");
        NotificationMessages.TaskDueSoon("TSK-1042", "Review privilege log", today, today)
            .ShouldBe("TSK-1042 \"Review privilege log\" is due today.");
        NotificationMessages.TaskOverdue("TSK-1042", "Review privilege log", new DateOnly(2026, 10, 20))
            .ShouldBe("TSK-1042 \"Review privilege log\" is overdue (due Oct 20).");
    }

    [Fact]
    public void Event_3_comment_and_mention()
    {
        NotificationMessages.TaskComment("Ann Lee", "TSK-1042", "Please re-run the search with the new terms...")
            .ShouldBe("Ann Lee commented on TSK-1042: \"Please re-run the search with the new terms...\"");
        NotificationMessages.TaskMention("Ann Lee", "TSK-1042", "...@Bo Chen can you confirm...")
            .ShouldBe("Ann Lee mentioned you in TSK-1042: \"...@Bo Chen can you confirm...\"");
    }

    [Fact]
    public void Events_4_to_8()
    {
        NotificationMessages.MatterTaskOverdue("TSK-1042", "Review privilege log", "Acme v. Smith", new DateOnly(2026, 10, 20), "Bo Chen")
            .ShouldBe("TSK-1042 \"Review privilege log\" on Acme v. Smith is overdue (due Oct 20, assigned to Bo Chen).");
        NotificationMessages.MatterTaskOverdue("TSK-1042", "Review privilege log", "Acme v. Smith", new DateOnly(2026, 10, 20), null)
            .ShouldBe("TSK-1042 \"Review privilege log\" on Acme v. Smith is overdue (due Oct 20, not assigned).");
        NotificationMessages.MatterTaskCreated("Ann Lee", "TSK-1051", "Load production volume 3", "Acme v. Smith")
            .ShouldBe("Ann Lee created TSK-1051 \"Load production volume 3\" on Acme v. Smith.");
        NotificationMessages.MatterTaskUnassigned("TSK-1042", "Review privilege log", "Acme v. Smith", 2)
            .ShouldBe("TSK-1042 \"Review privilege log\" on Acme v. Smith has been unassigned for 2 days.");
        NotificationMessages.MatterTaskOnHold("TSK-1042", "Review privilege log", "Acme v. Smith", 5)
            .ShouldBe("TSK-1042 \"Review privilege log\" on Acme v. Smith has been on hold for 5 days.");
        NotificationMessages.MatterManagerSet("Ann Lee", true, "Acme v. Smith").ShouldBe("Ann Lee made you Primary manager of Acme v. Smith.");
        NotificationMessages.MatterManagerSet("Ann Lee", false, "Acme v. Smith").ShouldBe("Ann Lee made you Secondary manager of Acme v. Smith.");
        NotificationMessages.PodTaskUnassigned("TSK-1042", "Review privilege log", "Demo Processing Pod")
            .ShouldBe("TSK-1042 \"Review privilege log\" in Demo Processing Pod is unassigned.");
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
        var message = NotificationMessages.TaskAssigned("Ann\nLee", "TSK-1", "<script>alert(1)</script>\r\nTitle", new string('m', 400));
        message.ShouldNotContain("<");
        message.ShouldNotContain(">");
        message.ShouldNotContain("\n");
        message.Length.ShouldBeLessThanOrEqualTo(NotificationMessages.MaxLength);
        message.ShouldStartWith("Ann Lee assigned you TSK-1");
    }
}
