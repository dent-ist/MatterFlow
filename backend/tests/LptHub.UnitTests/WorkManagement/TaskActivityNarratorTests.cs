using MatterFlow.Audit.Contracts;
using MatterFlow.WorkManagement.Application;
using Shouldly;

namespace MatterFlow.UnitTests.WorkManagement;

public sealed class TaskActivityNarratorTests
{
    private static readonly ActivityNames Names = new(
        new Dictionary<int, string> { [7] = "Dana P.", [8] = "Tariq K." },
        new Dictionary<int, string> { [3] = "Pod A" },
        new Dictionary<string, string> { ["ON_HOLD"] = "On Hold" });

    private static AuditRecord Event(string type, string? field = null, string? oldValue = null, string? newValue = null, string? summary = null) =>
        new(1, DateTime.UtcNow, 7, type, "Task", "1", 1, 1, field, oldValue, newValue, summary);

    [Fact]
    public void Status_changes_use_labels()
    {
        var story = TaskActivityNarrator.Narrate(Event("TASK_STATUS_CHANGED", "status", "IN_PROGRESS", "ON_HOLD", "cause=HOLD; commentId=4"), Names);
        story.Summary.ShouldBe("Status changed from In Progress to On Hold");
        story.Category.ShouldBe("STATUS");
        story.OldValue.ShouldBe("In Progress");
    }

    [Fact]
    public void Priority_and_text_field_changes_are_readable()
    {
        TaskActivityNarrator.Narrate(Event("FIELD_CHANGED", "priority", "Normal", "High"), Names).Summary.ShouldBe("Priority changed from Normal to High");
        TaskActivityNarrator.Narrate(Event("FIELD_CHANGED", "title", "Old", "New"), Names).Summary.ShouldBe("Title changed from Old to New");
        TaskActivityNarrator.Narrate(Event("FIELD_CHANGED", "description", "a", "b"), Names).Summary.ShouldBe("Description changed");
        TaskActivityNarrator.Narrate(Event("FIELD_CHANGED", "dueDate", "2099-01-01", null), Names).Summary.ShouldBe("Due date cleared (ASAP)");
        TaskActivityNarrator.Narrate(Event("FIELD_CHANGED", "project", null, "Phase 1"), Names).Summary.ShouldBe("Project set to Phase 1");
        TaskActivityNarrator.Narrate(Event("FIELD_CHANGED", "form:ocr_language", "EN", "DE"), Names).Summary.ShouldBe("Ocr language changed from EN to DE");
    }

    [Fact]
    public void Long_values_are_clipped()
    {
        var story = TaskActivityNarrator.Narrate(Event("FIELD_CHANGED", "title", "a", new string('x', 200)), Names);
        story.Summary.Length.ShouldBeLessThan(140);
        story.Summary.ShouldEndWith("...");
    }

    [Fact]
    public void Assignments_name_the_user_and_pod()
    {
        TaskActivityNarrator.Narrate(Event("TASK_ASSIGNED", "assignment", "{\"podId\":null,\"userId\":null}", "{\"podId\":3,\"userId\":7}"), Names)
            .Summary.ShouldBe("Assigned to Dana P. (Pod A)");
        TaskActivityNarrator.Narrate(Event("TASK_ASSIGNED", "assignment", "{\"podId\":3,\"userId\":7}", "{\"podId\":3,\"userId\":8}"), Names)
            .Summary.ShouldBe("Reassigned from Dana P. (Pod A) to Tariq K. (Pod A)");
        TaskActivityNarrator.Narrate(Event("TASK_ASSIGNED", "assignment", "{\"podId\":null,\"userId\":8}", "{\"podId\":null,\"userId\":null}"), Names)
            .Summary.ShouldBe("Unassigned from Tariq K.");
        TaskActivityNarrator.Narrate(Event("TASK_ASSIGNED", "assignment", null, "{\"podId\":3,\"userId\":null}"), Names)
            .Summary.ShouldBe("Assigned to Pod A");
    }

    [Fact]
    public void Assignment_ids_are_collected_for_name_lookup()
    {
        var (users, pods) = TaskActivityNarrator.AssignmentIds([Event("TASK_ASSIGNED", "assignment", "{\"podId\":3,\"userId\":7}", "{\"podId\":null,\"userId\":8}"), Event("FIELD_CHANGED")]);
        users.ShouldBe([7, 8], ignoreOrder: true);
        pods.ShouldBe([3]);
    }

    [Theory]
    [InlineData("STEP_COMPLETED", "Step 'Intake review' completed (bulk=true)", "Step Intake review completed (bulk)")]
    [InlineData("STEP_COMPLETED", "Step 'Intake review' completed (bulk=false)", "Step Intake review completed")]
    [InlineData("STEP_SKIPPED", "Step 'It's odd' skipped: not needed", "Step It's odd skipped: not needed")]
    [InlineData("STEP_REOPENED", "Step 'QC' reopened", "Step QC reopened")]
    [InlineData("STEP_VALUES_EDITED", "Step 'QC' values edited (fields: notes)", "Step QC values edited (fields: notes)")]
    public void Step_events_read_naturally(string type, string summary, string expected)
    {
        var story = TaskActivityNarrator.Narrate(Event(type, "status", summary: summary), Names);
        story.Summary.ShouldBe(expected);
        story.Category.ShouldBe("WORKFLOW");
    }

    [Fact]
    public void Comment_and_asset_events_have_their_categories()
    {
        TaskActivityNarrator.Narrate(Event("COMMENT_ADDED", "purpose", newValue: "NORMAL"), Names).Summary.ShouldBe("Comment added");
        TaskActivityNarrator.Narrate(Event("COMMENT_ADDED", "purpose", newValue: "CANCEL"), Names).Summary.ShouldBe("Cancellation reason added");
        TaskActivityNarrator.Narrate(Event("COMMENT_EDITED"), Names).Category.ShouldBe("COMMENTS");
        TaskActivityNarrator.Narrate(Event("COMMENT_DELETED"), Names).Summary.ShouldBe("Comment deleted");
        var linked = TaskActivityNarrator.Narrate(Event("TASK_ASSET_LINKED", "role", null, "Source", "Linked asset 'Laptop' as Source"), Names);
        linked.Category.ShouldBe("ASSETS");
        linked.Summary.ShouldBe("Linked asset 'Laptop' as Source");
    }

    [Fact]
    public void Unknown_events_fall_back_to_summary_or_event_type()
    {
        TaskActivityNarrator.Narrate(Event("SOMETHING_ELSE", summary: "did a thing"), Names).Summary.ShouldBe("Did a thing");
        TaskActivityNarrator.Narrate(Event("SOMETHING_ELSE"), Names).Summary.ShouldBe("Something else");
    }

    [Theory]
    [InlineData("COMMENT_ADDED", "TaskComment", "42", 42L)]
    [InlineData("COMMENT_EDITED", "TaskComment", "7", 7L)]
    [InlineData("COMMENT_DELETED", "TaskComment", "9", 9L)]
    [InlineData("COMMENT_ADDED", "TaskComment", "x", null)]
    [InlineData("COMMENT_ADDED", "Task", "42", null)]
    [InlineData("TASK_STATUS_CHANGED", "TaskComment", "42", null)]
    public void Only_comment_events_carry_a_comment_id(string type, string objectType, string objectId, long? expected)
    {
        var e = new AuditRecord(1, DateTime.UtcNow, 7, type, objectType, objectId, 1, 1, null, null, null, null);
        TaskActivityNarrator.CommentId(e).ShouldBe(expected);
    }

    [Fact]
    public void Excerpts_are_one_line_of_plain_text_cut_at_a_word()
    {
        TaskActivityNarrator.Excerpt("<p>Hello <strong>there</strong></p><p>second&nbsp;line</p>").ShouldBe("Hello there second line");
        TaskActivityNarrator.Excerpt("<ul><li>One</li><li>Two</li></ul>").ShouldBe("One Two");
        TaskActivityNarrator.Excerpt(new string('a', 80)).ShouldBe(new string('a', 80));
        TaskActivityNarrator.Excerpt("   ").ShouldBeNull();
        TaskActivityNarrator.Excerpt("<p></p>").ShouldBeNull();
        TaskActivityNarrator.Excerpt(null).ShouldBeNull();

        var words = string.Join(' ', Enumerable.Repeat("word", 40));
        var cut = TaskActivityNarrator.Excerpt("<p>" + words + "</p>")!;
        cut.Length.ShouldBeLessThanOrEqualTo(TaskActivityNarrator.ExcerptLength);
        cut.ShouldEndWith("word...");
        words.ShouldStartWith(cut[..^3]);

        // One long word has no break to cut at.
        var solid = TaskActivityNarrator.Excerpt(new string('x', 300))!;
        solid.Length.ShouldBe(TaskActivityNarrator.ExcerptLength);
        solid.ShouldEndWith("...");
    }
}
