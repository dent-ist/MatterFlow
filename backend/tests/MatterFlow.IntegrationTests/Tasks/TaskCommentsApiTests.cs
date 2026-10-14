using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.PanelAssert;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>Task comments (ticket 43, SCN-018): rich text sanitized on the server, soft delete, edit history, closed-Task rules, permissions.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskCommentsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static string Url(long taskId, long? commentId = null) => $"/api/v1/tasks/{taskId}/comments" + (commentId is null ? string.Empty : $"/{commentId}");

    private async Task<JsonElement> PostAsync(long taskId, string html, HttpClient? client = null) =>
        await OkAsync(await (client ?? _h.Admin).PostAsJsonAsync(Url(taskId), new { bodyHtml = html }), HttpStatusCode.Created);

    private async Task<JsonElement[]> ListAsync(long taskId, HttpClient? client = null, string query = "")
    {
        var list = await OkAsync(await (client ?? _h.Admin).GetAsync(Url(taskId) + query));
        return [.. list.GetProperty("items").EnumerateArray()];
    }

    [Fact]
    public async Task Scn018_post_list_edit_keeps_history_and_the_activity_lists_it()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: false);
        var taskId = TaskId(task);
        var stepIds = StepIds(task);
        await _h.StepAsync(task, stepIds[0], "start");

        var comment = await PostAsync(taskId, "<p>Called the client; <strong>approved</strong> by A. Lee.</p>");
        comment.GetProperty("bodyHtml").GetString().ShouldBe("<p>Called the client; <strong>approved</strong> by A. Lee.</p>");
        comment.GetProperty("purpose").GetString().ShouldBe("NORMAL");
        comment.GetProperty("purposeLabel").ValueKind.ShouldBe(JsonValueKind.Null);
        comment.GetProperty("author").GetProperty("displayName").GetString().ShouldNotBeNullOrWhiteSpace();
        comment.GetProperty("createdAtUtc").GetDateTime().Kind.ShouldBe(DateTimeKind.Utc);
        comment.GetProperty("isEdited").GetBoolean().ShouldBeFalse();
        comment.GetProperty("canEdit").GetBoolean().ShouldBeTrue();
        comment.GetProperty("canDelete").GetBoolean().ShouldBeTrue();

        var commentId = comment.GetProperty("commentId").GetInt64();
        var edited = await OkAsync(await _h.Admin.PutAsJsonAsync(Url(taskId, commentId), new { bodyHtml = "<p>Approved by A. Lee (email 10/13).</p>", rowVersion = comment.GetProperty("rowVersion").GetString() }));
        edited.GetProperty("isEdited").GetBoolean().ShouldBeTrue();
        edited.GetProperty("editedAtUtc").ValueKind.ShouldBe(JsonValueKind.String);
        edited.GetProperty("bodyHtml").GetString().ShouldBe("<p>Approved by A. Lee (email 10/13).</p>");
        edited.GetProperty("rowVersion").GetString().ShouldNotBe(comment.GetProperty("rowVersion").GetString());

        var revisions = await OkAsync(await _h.Admin.GetAsync(Url(taskId, commentId) + "/revisions"));
        var versions = revisions.GetProperty("items").EnumerateArray().ToArray();
        versions.Length.ShouldBe(1);
        versions[0].GetProperty("bodyHtml").GetString()!.ShouldContain("Called the client");
        versions[0].GetProperty("reason").GetString().ShouldBe("EDIT");
        versions[0].GetProperty("revisedBy").GetProperty("displayName").GetString().ShouldNotBeNullOrWhiteSpace();

        (await ListAsync(taskId)).Single().GetProperty("bodyHtml").GetString()!.ShouldContain("email 10/13");

        var activity = await OkAsync(await _h.Admin.GetAsync($"/api/v1/tasks/{taskId}/activity?pageSize=50"));
        var types = activity.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("eventType").GetString()).ToArray();
        types.ShouldContain("COMMENT_ADDED");
        types.ShouldContain("COMMENT_EDITED");
        types.ShouldContain("STEP_STARTED");
        types.ShouldContain("TASK_CREATED");
        types.ShouldNotContain("TASK_UPDATED");
        Array.IndexOf(types, "COMMENT_EDITED").ShouldBeLessThan(Array.IndexOf(types, "COMMENT_ADDED")); // newest first

        var audit = await _h.AuditAsync(taskId);
        audit.Where(a => a.EventType == "COMMENT_ADDED").ShouldHaveSingleItem().ObjectType.ShouldBe("TaskComment");
        audit.Single(a => a.EventType == "COMMENT_EDITED").ObjectId.ShouldBe(commentId.ToString());
    }

    [Fact]
    public async Task List_is_oldest_first_by_default_and_can_be_reversed()
    {
        var task = await _h.CreateTaskAsync(_w);
        var first = await PostAsync(TaskId(task), "<p>first</p>");
        var second = await PostAsync(TaskId(task), "<p>second</p>");

        (await ListAsync(TaskId(task))).Select(c => c.GetProperty("commentId").GetInt64())
            .ShouldBe([first.GetProperty("commentId").GetInt64(), second.GetProperty("commentId").GetInt64()]);
        (await ListAsync(TaskId(task), query: "?newestFirst=true")).Select(c => c.GetProperty("commentId").GetInt64())
            .ShouldBe([second.GetProperty("commentId").GetInt64(), first.GetProperty("commentId").GetInt64()]);
        var envelope = await OkAsync(await _h.Admin.GetAsync(Url(TaskId(task))));
        envelope.GetProperty("total").GetInt32().ShouldBe(2);
        await ProblemAsync(await _h.Admin.GetAsync(Url(TaskId(task)) + "?bogus=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Theory]
    [InlineData("COMPLETED")]
    [InlineData("CANCELLED")]
    [InlineData("ON_HOLD")]
    [InlineData("NEW")]
    public async Task Comments_are_allowed_in_every_task_status(string status)
    {
        var task = await _h.ReachAsync(_w, status);
        var comment = await PostAsync(TaskId(task), "<p>Note after " + status + "</p>");
        await OkAsync(await _h.Admin.PutAsJsonAsync(Url(TaskId(task), comment.GetProperty("commentId").GetInt64()), new { bodyHtml = "<p>Edited</p>", rowVersion = comment.GetProperty("rowVersion").GetString() }));
        (await _h.Admin.DeleteAsync(Url(TaskId(task), comment.GetProperty("commentId").GetInt64()))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task Comments_are_allowed_on_a_task_of_an_inactive_matter()
    {
        var task = await _h.ReachAsync(_w, "COMPLETED");
        await _h.SetMatterActiveAsync(_w.MatterId, false);

        var comment = await PostAsync(TaskId(task), "<p>Archive note</p>");
        comment.GetProperty("bodyHtml").GetString().ShouldBe("<p>Archive note</p>");
    }

    [Fact]
    public async Task Delete_is_soft_hides_the_comment_and_keeps_the_final_body()
    {
        var task = await _h.CreateTaskAsync(_w);
        var taskId = TaskId(task);
        var comment = await PostAsync(taskId, "<p>Oops wrong task</p>");
        var commentId = comment.GetProperty("commentId").GetInt64();

        (await _h.Admin.DeleteAsync(Url(taskId, commentId))).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        (await ListAsync(taskId)).ShouldBeEmpty();
        await ProblemAsync(await _h.Admin.DeleteAsync(Url(taskId, commentId)), HttpStatusCode.NotFound, "NOT_FOUND");
        await ProblemAsync(await _h.Admin.GetAsync(Url(taskId, commentId) + "/revisions"), HttpStatusCode.NotFound, "NOT_FOUND");
        await ProblemAsync(
            await _h.Admin.PutAsJsonAsync(Url(taskId, commentId), new { bodyHtml = "<p>again</p>", rowVersion = comment.GetProperty("rowVersion").GetString() }),
            HttpStatusCode.NotFound,
            "NOT_FOUND");

        var row = await _factory.WithDbAsync(db => db.Set<TaskComment>().AsNoTracking().SingleAsync(c => c.Id == commentId));
        row.IsDeleted.ShouldBeTrue();
        row.DeletedAtUtc.ShouldNotBeNull();
        row.DeletedByUserId.ShouldNotBeNull();
        row.BodyHtml.ShouldBe("<p>Oops wrong task</p>");

        var revision = await _factory.WithDbAsync(db => db.Set<TaskCommentRevision>().AsNoTracking().SingleAsync(r => r.TaskCommentId == commentId));
        revision.Reason.ShouldBe("DELETE");
        revision.BodyHtml.ShouldBe("<p>Oops wrong task</p>");
        (await _h.AuditAsync("COMMENT_DELETED")).ShouldHaveSingleItem().TaskId.ShouldBe(taskId);
    }

    [Fact]
    public async Task Only_the_author_can_edit_or_delete()
    {
        var task = await _h.CreateTaskAsync(_w);
        var taskId = TaskId(task);
        var other = await _h.UserWithAsync(@"KE\other", "Task.View", "Task.Comment");
        var comment = await PostAsync(taskId, "<p>mine</p>");
        var commentId = comment.GetProperty("commentId").GetInt64();

        await ForbiddenAsync(await other.PutAsJsonAsync(Url(taskId, commentId), new { bodyHtml = "<p>hijack</p>", rowVersion = comment.GetProperty("rowVersion").GetString() }));
        await ForbiddenAsync(await other.DeleteAsync(Url(taskId, commentId)));

        var seenByOther = (await ListAsync(taskId, other)).Single();
        seenByOther.GetProperty("canEdit").GetBoolean().ShouldBeFalse();
        seenByOther.GetProperty("canDelete").GetBoolean().ShouldBeFalse();
        seenByOther.GetProperty("bodyHtml").GetString().ShouldBe("<p>mine</p>");
    }

    [Fact]
    public async Task Cancel_and_on_hold_reasons_show_their_purpose_and_can_not_be_deleted()
    {
        var onHold = await _h.ReachAsync(_w, "ON_HOLD");
        var cancelled = await _h.ReachAsync(_w, "CANCELLED");

        var hold = (await ListAsync(TaskId(onHold))).Single();
        hold.GetProperty("purpose").GetString().ShouldBe("ON_HOLD");
        hold.GetProperty("purposeLabel").GetString().ShouldBe("On hold reason");
        hold.GetProperty("canDelete").GetBoolean().ShouldBeFalse();
        var cancel = (await ListAsync(TaskId(cancelled))).Single();
        cancel.GetProperty("purposeLabel").GetString().ShouldBe("Cancellation reason");
        cancel.GetProperty("bodyHtml").GetString()!.ShouldContain("No longer needed");

        var problem = await ProblemAsync(await _h.Admin.DeleteAsync(Url(TaskId(cancelled), cancel.GetProperty("commentId").GetInt64())), HttpStatusCode.Conflict, "COMMENT_NOT_DELETABLE");
        problem.GetProperty("detail").GetString().ShouldNotBeNullOrWhiteSpace();
        await ProblemAsync(await _h.Admin.DeleteAsync(Url(TaskId(onHold), hold.GetProperty("commentId").GetInt64())), HttpStatusCode.Conflict, "COMMENT_NOT_DELETABLE");
        (await ListAsync(TaskId(cancelled))).Length.ShouldBe(1);
    }

    [Fact]
    public async Task Bodies_are_validated()
    {
        var taskId = TaskId(await _h.CreateTaskAsync(_w));

        await ProblemAsync(await _h.Admin.PostAsJsonAsync(Url(taskId), new { bodyHtml = "" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        var scriptOnly = await ProblemAsync(await _h.Admin.PostAsJsonAsync(Url(taskId), new { bodyHtml = "<script>alert(1)</script>" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        scriptOnly.GetProperty("errors").GetRawText().ShouldContain("REQUIRED");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync(Url(taskId), new { bodyHtml = "<p></p><br>" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        var tooLong = await ProblemAsync(await _h.Admin.PostAsJsonAsync(Url(taskId), new { bodyHtml = "<p>" + new string('x', 20_001) + "</p>" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        tooLong.GetProperty("errors").GetRawText().ShouldContain("TOO_LONG");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks/999999/comments", new { bodyHtml = "<p>x</p>" }), HttpStatusCode.NotFound, "NOT_FOUND");

        (await ListAsync(taskId)).ShouldBeEmpty();
        (await _h.AuditAsync("COMMENT_ADDED")).ShouldBeEmpty();
    }

    [Fact]
    public async Task Edit_uses_optimistic_concurrency()
    {
        var taskId = TaskId(await _h.CreateTaskAsync(_w));
        var comment = await PostAsync(taskId, "<p>v1</p>");
        var commentId = comment.GetProperty("commentId").GetInt64();
        var stale = comment.GetProperty("rowVersion").GetString();

        await OkAsync(await _h.Admin.PutAsJsonAsync(Url(taskId, commentId), new { bodyHtml = "<p>v2</p>", rowVersion = stale }));
        await ProblemAsync(await _h.Admin.PutAsJsonAsync(Url(taskId, commentId), new { bodyHtml = "<p>v3</p>", rowVersion = stale }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
        (await ListAsync(taskId)).Single().GetProperty("bodyHtml").GetString().ShouldBe("<p>v2</p>");
    }

    [Fact]
    public async Task Unchanged_edit_creates_no_revision_and_no_audit_event()
    {
        var taskId = TaskId(await _h.CreateTaskAsync(_w));
        var comment = await PostAsync(taskId, "<p>same</p>");
        await OkAsync(await _h.Admin.PutAsJsonAsync(Url(taskId, comment.GetProperty("commentId").GetInt64()), new { bodyHtml = "<p>same</p>", rowVersion = comment.GetProperty("rowVersion").GetString() }));

        (await _factory.CountAsync<TaskCommentRevision>()).ShouldBe(0);
        (await _h.AuditAsync("COMMENT_EDITED")).ShouldBeEmpty();
    }

    public static TheoryData<string> Payloads() => new()
    {
        "<script>alert(1)</script><p>after</p>",
        "<p onclick=\"alert(1)\">click</p>",
        "<img src=x onerror=alert(1)><p>img</p>",
        "<svg onload=alert(1)></svg><p>svg</p>",
        "<math><mi xlink:href=\"javascript:alert(1)\">x</mi></math><p>math</p>",
        "<a href=\"javascript:alert(1)\">link</a>",
        "<a href=\"&#x6A;avascript:alert(1)\">link</a>",
        "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe><p>frame</p>",
        "<p style=\"background:url(javascript:alert(1))\">styled</p>",
        "<scr<script>ipt>alert(1)</scr</script>ipt><p>nested</p>",
        "<form action=\"javascript:alert(1)\"><button>go</button></form><p>form</p>",
        "<a href=\"https://example.com\" target=\"_blank\" onmouseover=\"alert(1)\">ok</a>",
    };

    [Theory]
    [MemberData(nameof(Payloads))]
    public async Task Hostile_payloads_are_stored_and_returned_sanitized(string payload)
    {
        var taskId = TaskId(await _h.CreateTaskAsync(_w));

        var comment = await PostAsync(taskId, payload);
        var commentId = comment.GetProperty("commentId").GetInt64();
        var returned = comment.GetProperty("bodyHtml").GetString()!;
        var stored = await _factory.WithDbAsync(db => db.Set<TaskComment>().AsNoTracking().Where(c => c.Id == commentId).Select(c => c.BodyHtml).SingleAsync());
        stored.ShouldBe(returned);

        // The edit path sanitizes too.
        var edited = await OkAsync(await _h.Admin.PutAsJsonAsync(Url(taskId, commentId), new { bodyHtml = payload + "<p>x</p>", rowVersion = comment.GetProperty("rowVersion").GetString() }));
        var all = new[] { returned, edited.GetProperty("bodyHtml").GetString()!, (await ListAsync(taskId)).Single().GetProperty("bodyHtml").GetString()! };
        foreach (var html in all)
        {
            foreach (var forbidden in new[] { "<script", "<svg", "<math", "<img", "<iframe", "<form", "javascript:", "onerror", "onload", "onclick", "onmouseover", "style=", "srcdoc", "xlink" })
                html.ShouldNotContain(forbidden, Case.Insensitive, $"{payload} => {html}");
        }

        returned.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Safe_links_get_noopener_and_survive()
    {
        var taskId = TaskId(await _h.CreateTaskAsync(_w));
        var comment = await PostAsync(taskId, "<p>See <a href=\"https://example.com/doc\">the doc</a> or <a href=\"mailto:a@b.co\">mail</a></p>");
        var html = comment.GetProperty("bodyHtml").GetString()!;
        html.ShouldContain("href=\"https://example.com/doc\"");
        html.ShouldContain("href=\"mailto:a@b.co\"");
        html.Split("rel=\"noopener noreferrer\"").Length.ShouldBe(3);
    }

    [Fact]
    public async Task Permissions_gate_reading_and_writing()
    {
        var task = await _h.CreateTaskAsync(_w);
        var taskId = TaskId(task);
        var comment = await PostAsync(taskId, "<p>x</p>");
        var commentId = comment.GetProperty("commentId").GetInt64();

        var nothing = await _h.UserWithAsync(@"KE\nothing");
        var viewer = await _h.UserWithAsync(@"KE\viewer", "Task.View");
        var commenter = await _h.UserWithAsync(@"KE\commenter", "Task.Comment");
        var everythingElse = await _h.UserWithAsync(@"KE\allbutcomment", AllTaskPermissions.Where(p => p != "Task.Comment").ToArray());

        foreach (var client in new[] { nothing, commenter })
        {
            await ForbiddenAsync(await client.GetAsync(Url(taskId)));
            await ForbiddenAsync(await client.GetAsync(Url(taskId, commentId) + "/revisions"));
        }

        foreach (var client in new[] { nothing, viewer, everythingElse })
        {
            await ForbiddenAsync(await client.PostAsJsonAsync(Url(taskId), new { bodyHtml = "<p>no</p>" }));
            await ForbiddenAsync(await client.PutAsJsonAsync(Url(taskId, commentId), new { bodyHtml = "<p>no</p>", rowVersion = comment.GetProperty("rowVersion").GetString() }));
            await ForbiddenAsync(await client.DeleteAsync(Url(taskId, commentId)));
        }

        (await viewer.GetAsync(Url(taskId))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await viewer.GetAsync(Url(taskId, commentId) + "/revisions")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await commenter.PostAsJsonAsync(Url(taskId), new { bodyHtml = "<p>yes</p>" })).StatusCode.ShouldBe(HttpStatusCode.Created);
        (await _h.As("unknown-nobody").GetAsync(Url(taskId))).StatusCode.ShouldNotBe(HttpStatusCode.OK);
        (await _factory.CreateClient().GetAsync(Url(taskId))).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        // Read-only viewers see the thread without edit controls.
        (await ListAsync(taskId, viewer)).ShouldAllBe(c => !c.GetProperty("canEdit").GetBoolean() && !c.GetProperty("canDelete").GetBoolean());
    }

    [Fact]
    public async Task Audit_rows_are_written_with_the_comment_in_one_transaction()
    {
        var taskId = TaskId(await _h.CreateTaskAsync(_w));
        var comment = await PostAsync(taskId, "<p>audited</p>");

        var events = await _factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking().Where(a => a.TaskId == taskId && a.EventType == "COMMENT_ADDED").ToListAsync());
        events.ShouldHaveSingleItem().ObjectId.ShouldBe(comment.GetProperty("commentId").GetInt64().ToString());
        events[0].Summary.ShouldBe("Comment added");
        events[0].OldValue.ShouldBeNull();
        events[0].NewValue.ShouldBe("NORMAL"); // never the comment text
    }
}
