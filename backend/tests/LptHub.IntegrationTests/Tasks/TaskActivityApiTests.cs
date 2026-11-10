using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.PanelAssert;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>The Task activity timeline: readable, newest first, paged, with names and permission-scoped values.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskActivityApiTests(SqlServerFixture sql) : IAsyncLifetime
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

    private static string Url(long taskId, string query = "") => $"/api/v1/tasks/{taskId}/activity{query}";

    private static string[] Summaries(JsonElement page) =>
        [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("summary").GetString()!)];

    [Fact]
    public async Task The_timeline_reads_like_a_sentence_and_is_newest_first()
    {
        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        var high = priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == "High").GetProperty("id").GetInt32();
        await _h.UserWithAsync(@"KE\dana", AllTaskPermissions);
        var danaId = await _h.UserIdAsync(@"KE\dana");
        var podId = await _h.CreatePodAsync("Pod A", danaId);

        var task = await _h.CreateTaskAsync(_w, ordered: false);
        var taskId = TaskId(task);
        task = await _h.PostAsync(taskId, "priority", new { priorityId = high, rowVersion = RowVersion(task) });
        task = await _h.PostAsync(taskId, "assignment", new { podId, userId = danaId, rowVersion = RowVersion(task) });
        task = await _h.StatusAsync(task, "ON_HOLD", "Waiting for the client");
        task = await _h.StatusAsync(task, "IN_PROGRESS");
        task = await _h.CompleteAsync(task); // bulk-completes the two unresolved steps
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{taskId}/comments", new { bodyHtml = "<p>Done</p>" }), HttpStatusCode.Created);

        var page = await OkAsync(await _h.Admin.GetAsync(Url(taskId, "?pageSize=100")));
        var summaries = Summaries(page);
        summaries.ShouldContain("Priority changed from Normal to High");
        summaries.ShouldContain("Assigned to Dana (Pod A)".Replace("Dana", await DisplayNameAsync(danaId)));
        summaries.ShouldContain("Status changed from In Progress to On Hold");
        summaries.ShouldContain("Status changed from On Hold to In Progress");
        summaries.ShouldContain("Status changed from In Progress to Completed");
        summaries.ShouldContain("Comment added");
        summaries.ShouldContain("Cancellation reason added".Replace("Cancellation", "On hold"));
        summaries.Count(s => s.StartsWith("Step ", StringComparison.Ordinal) && s.EndsWith("completed (bulk)", StringComparison.Ordinal)).ShouldBe(2);
        summaries.Any(s => s.Contains("'", StringComparison.Ordinal) && s.StartsWith("Step", StringComparison.Ordinal)).ShouldBeFalse();
        summaries.Last().ShouldStartWith("TSK-");

        var ids = page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("eventId").GetInt64()).ToArray();
        ids.ShouldBe([.. ids.OrderByDescending(i => i)]);
        var first = page.GetProperty("items")[0];
        first.GetProperty("eventType").GetString().ShouldBe("COMMENT_ADDED");
        first.GetProperty("category").GetString().ShouldBe("COMMENTS");
        first.GetProperty("actor").GetProperty("displayName").GetString().ShouldNotBeNullOrWhiteSpace();
        first.GetProperty("occurredAtUtc").GetDateTime().Kind.ShouldBe(DateTimeKind.Utc);
        page.GetProperty("nextCursor").ValueKind.ShouldBe(JsonValueKind.Null);

        var statusEvent = page.GetProperty("items").EnumerateArray().First(i => i.GetProperty("summary").GetString() == "Status changed from In Progress to On Hold");
        statusEvent.GetProperty("category").GetString().ShouldBe("STATUS");
        statusEvent.GetProperty("oldValue").GetString().ShouldBe("In Progress");
        statusEvent.GetProperty("newValue").GetString().ShouldBe("On Hold");
        page.GetProperty("canViewChanges").GetBoolean().ShouldBeTrue();
    }

    private async Task<string> DisplayNameAsync(int userId)
    {
        var me = await OkAsync(await _h.As(@"KE\dana").GetAsync("/api/v1/me"));
        me.GetProperty("userId").GetInt32().ShouldBe(userId);
        return me.GetProperty("displayName").GetString()!;
    }

    [Fact]
    public async Task Paging_walks_back_through_the_history_with_the_cursor()
    {
        var task = await _h.CreateTaskAsync(_w);
        var taskId = TaskId(task);
        for (var i = 0; i < 4; i++)
            await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{taskId}/comments", new { bodyHtml = $"<p>{i}</p>" }), HttpStatusCode.Created);

        var seen = new List<long>();
        string? cursor = null;
        var pages = 0;
        do
        {
            var page = await OkAsync(await _h.Admin.GetAsync(Url(taskId, "?pageSize=2" + (cursor is null ? string.Empty : "&cursor=" + cursor))));
            page.GetProperty("items").GetArrayLength().ShouldBeLessThanOrEqualTo(2);
            seen.AddRange(page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("eventId").GetInt64()));
            cursor = page.GetProperty("nextCursor").GetString();
            pages++;
        }
        while (cursor is not null);

        pages.ShouldBe(3); // 4 comments + the creation event
        seen.Count.ShouldBe(5);
        seen.Distinct().Count().ShouldBe(5);
        seen.ShouldBe([.. seen.OrderByDescending(i => i)]);
    }

    [Fact]
    public async Task Invalid_parameters_and_unknown_tasks_are_rejected()
    {
        var taskId = TaskId(await _h.CreateTaskAsync(_w));
        await ProblemAsync(await _h.Admin.GetAsync(Url(taskId, "?cursor=abc")), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.GetAsync(Url(taskId, "?pageSize=0")), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.GetAsync(Url(taskId, "?pageSize=101")), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.GetAsync(Url(taskId, "?nope=1")), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.GetAsync(Url(999_999)), HttpStatusCode.NotFound, "NOT_FOUND");
    }

    [Fact]
    public async Task Values_need_audit_view_but_the_sentences_do_not()
    {
        var task = await _h.CreateTaskAsync(_w);
        await _h.StatusAsync(task, "ON_HOLD", "Waiting");
        var viewer = await _h.UserWithAsync(@"KE\viewer", "Task.View");
        var nothing = await _h.UserWithAsync(@"KE\nothing");

        var page = await OkAsync(await viewer.GetAsync(Url(TaskId(task))));
        page.GetProperty("canViewChanges").GetBoolean().ShouldBeFalse();
        Summaries(page).ShouldContain("Status changed from New to On Hold");
        var change = page.GetProperty("items").EnumerateArray().First(i => i.GetProperty("eventType").GetString() == "TASK_STATUS_CHANGED");
        change.GetProperty("oldValue").ValueKind.ShouldBe(JsonValueKind.Null);
        change.GetProperty("newValue").ValueKind.ShouldBe(JsonValueKind.Null);

        await ForbiddenAsync(await nothing.GetAsync(Url(TaskId(task))));
        (await _factory.CreateClient().GetAsync(Url(TaskId(task)))).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Sec2_06_field_change_sentences_carry_no_values_without_audit_view()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["requestorEmail"] = "old.person@example.com" });
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/tasks/{TaskId(task)}", new
        {
            rowVersion = RowVersion(task),
            title = task.GetProperty("title").GetString(),
            requestorName = "Pat Partner",
            requestorEmail = "new.person@example.com",
        }));
        var viewer = await _h.UserWithAsync(@"KEiewer", "Task.View");

        var page = await OkAsync(await viewer.GetAsync(Url(TaskId(task))));
        var sentences = Summaries(page);
        sentences.ShouldContain("Requestor email changed");
        sentences.ShouldNotContain(s => s.Contains("old.person", StringComparison.Ordinal) || s.Contains("new.person", StringComparison.Ordinal));
        page.GetRawText().ShouldNotContain("old.person");

        // With Audit.View (the administrator) the sentence names both values.
        Summaries(await OkAsync(await _h.Admin.GetAsync(Url(TaskId(task))))).ShouldContain(s => s.Contains("old.person@example.com", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Field_edits_and_asset_links_appear_and_task_updated_bookkeeping_does_not()
    {
        var task = await _h.CreateTaskAsync(_w);
        var taskId = TaskId(task);
        var updated = await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/tasks/{taskId}", new
        {
            rowVersion = RowVersion(task),
            title = "Renamed task",
            requestorName = "Pat Partner",
            dueDate = "2099-03-04",
        }));
        Status(updated).ShouldBe("NEW");
        var type = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Drive" }), HttpStatusCode.Created);
        var asset = await OkAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = _w.MatterId, assetTypeId = type.GetProperty("assetTypeId").GetInt32(), displayName = "Evidence drive" }),
            HttpStatusCode.Created);
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{taskId}/assets", new { assetId = asset.GetProperty("assetId").GetInt32() }), HttpStatusCode.Created);

        var page = await OkAsync(await _h.Admin.GetAsync(Url(taskId)));
        var summaries = Summaries(page);
        summaries.ShouldContain("Linked asset 'Evidence drive'");
        summaries.ShouldContain(s => s.StartsWith("Title changed from Load custodian data", StringComparison.Ordinal) && s.EndsWith("to Renamed task", StringComparison.Ordinal));
        summaries.ShouldContain(s => s.StartsWith("Due date set to 2099-03-04", StringComparison.Ordinal));
        page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("eventType").GetString()).ShouldNotContain("TASK_UPDATED");
        page.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("eventType").GetString() == "TASK_ASSET_LINKED").GetProperty("category").GetString().ShouldBe("ASSETS");
    }

    [Fact]
    public async Task Comment_events_carry_the_comment_id_and_an_excerpt_read_at_request_time()
    {
        var task = await _h.CreateTaskAsync(_w);
        var taskId = TaskId(task);
        async Task<long> PostAsync(string html) =>
            (await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{taskId}/comments", new { bodyHtml = html }), HttpStatusCode.Created)).GetProperty("commentId").GetInt64();

        var plain = await PostAsync("<p>Please call the client back</p>");
        var rich = await PostAsync("<p>See <strong>the</strong> <a href=\"https://example.com\">report</a></p><ul><li>one</li><li>two</li></ul>");
        var longId = await PostAsync("<p>" + string.Join(' ', Enumerable.Repeat("lengthy", 30)) + "</p>");
        var gone = await PostAsync("<p>Delete me</p>");
        (await _h.Admin.DeleteAsync($"/api/v1/tasks/{taskId}/comments/{gone}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

        JsonElement[] Items(JsonElement page) => [.. page.GetProperty("items").EnumerateArray()];
        var page = await OkAsync(await _h.Admin.GetAsync(Url(taskId, "?pageSize=100")));
        JsonElement Added(long id) => Items(page).Single(i => i.GetProperty("eventType").GetString() == "COMMENT_ADDED" && i.GetProperty("commentId").GetInt64() == id);

        Added(plain).GetProperty("excerpt").GetString().ShouldBe("Please call the client back");
        Added(rich).GetProperty("excerpt").GetString().ShouldBe("See the report one two");
        var clipped = Added(longId).GetProperty("excerpt").GetString()!;
        clipped.Length.ShouldBeLessThanOrEqualTo(80);
        clipped.ShouldEndWith("lengthy...");
        Added(gone).GetProperty("excerpt").ValueKind.ShouldBe(JsonValueKind.Null);
        var deleted = Items(page).Single(i => i.GetProperty("eventType").GetString() == "COMMENT_DELETED");
        deleted.GetProperty("commentId").GetInt64().ShouldBe(gone);
        deleted.GetProperty("excerpt").ValueKind.ShouldBe(JsonValueKind.Null);

        // Other events are unchanged: no id, no excerpt.
        var created = Items(page).Single(i => i.GetProperty("eventType").GetString() == "TASK_CREATED");
        created.GetProperty("commentId").ValueKind.ShouldBe(JsonValueKind.Null);
        created.GetProperty("excerpt").ValueKind.ShouldBe(JsonValueKind.Null);

        // An edit shows in the excerpt (it is read from the comment, not stored in the audit row).
        var current = await OkAsync(await _h.Admin.GetAsync($"/api/v1/tasks/{taskId}/comments"));
        var row = current.GetProperty("items").EnumerateArray().Single(c => c.GetProperty("commentId").GetInt64() == plain);
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/tasks/{taskId}/comments/{plain}", new { bodyHtml = "<p>Edited wording</p>", rowVersion = row.GetProperty("rowVersion").GetString() }));
        page = await OkAsync(await _h.Admin.GetAsync(Url(taskId, "?pageSize=100")));
        Added(plain).GetProperty("excerpt").GetString().ShouldBe("Edited wording");
        Items(page).Single(i => i.GetProperty("eventType").GetString() == "COMMENT_EDITED").GetProperty("commentId").GetInt64().ShouldBe(plain);

        // A person who may view tasks (no Audit.View, no Task.Comment) still gets the excerpt of what they can read in the thread.
        var viewer = await _h.UserWithAsync(@"KE\reader", "Task.View");
        var viewed = Items(await OkAsync(await viewer.GetAsync(Url(taskId, "?pageSize=100"))));
        viewed.Single(i => i.GetProperty("commentId").ValueKind == JsonValueKind.Number && i.GetProperty("commentId").GetInt64() == rich && i.GetProperty("eventType").GetString() == "COMMENT_ADDED")
            .GetProperty("excerpt").GetString().ShouldBe("See the report one two");
    }

    [Fact]
    public async Task The_number_of_queries_for_a_page_of_comment_events_does_not_grow_with_the_rows()
    {
        var counter = new CommandCounter();
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { ConfigureDb = o => o.AddInterceptors(counter) };
        var h = new TaskHarness(factory);
        var w = await h.CreateWorldAsync();
        var taskId = TaskId(await h.CreateTaskAsync(w));

        async Task<int> QueriesForPageAsync()
        {
            counter.Reset();
            var page = await OkAsync(await h.Admin.GetAsync(Url(taskId, "?pageSize=50")));
            page.GetProperty("items").GetArrayLength().ShouldBeGreaterThan(0);
            return counter.Count;
        }

        for (var i = 0; i < 2; i++)
            await OkAsync(await h.Admin.PostAsJsonAsync($"/api/v1/tasks/{taskId}/comments", new { bodyHtml = $"<p>Comment {i}</p>" }), HttpStatusCode.Created);
        var few = await QueriesForPageAsync();

        for (var i = 2; i < 40; i++)
            await OkAsync(await h.Admin.PostAsJsonAsync($"/api/v1/tasks/{taskId}/comments", new { bodyHtml = $"<p>Comment {i}</p>" }), HttpStatusCode.Created);
        var many = await QueriesForPageAsync();

        many.ShouldBe(few);
    }

    private sealed class CommandCounter : Microsoft.EntityFrameworkCore.Diagnostics.DbCommandInterceptor
    {
        private int _count;

        public int Count => Volatile.Read(ref _count);

        public void Reset() => Volatile.Write(ref _count, 0);

        public override System.Data.Common.DbDataReader ReaderExecuted(System.Data.Common.DbCommand command, Microsoft.EntityFrameworkCore.Diagnostics.CommandExecutedEventData eventData, System.Data.Common.DbDataReader result)
        {
            Interlocked.Increment(ref _count);
            return result;
        }

        public override ValueTask<System.Data.Common.DbDataReader> ReaderExecutedAsync(System.Data.Common.DbCommand command, Microsoft.EntityFrameworkCore.Diagnostics.CommandExecutedEventData eventData, System.Data.Common.DbDataReader result, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return ValueTask.FromResult(result);
        }
    }
}
