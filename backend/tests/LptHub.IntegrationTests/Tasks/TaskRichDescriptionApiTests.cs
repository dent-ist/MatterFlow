using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>
/// Rich-text Task description and comment tables through the real API (decision R, issue #80): create, update, read, size and table limits,
/// hostile HTML, plain text, descriptions written before the change (TEXT), audit text, and comments with tables.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskRichDescriptionApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Table = "<table><thead><tr><th scope=\"col\">Custodian</th><th scope=\"col\">Size</th></tr></thead><tbody><tr><td>Smith</td><td colspan=\"1\">12 GB</td></tr></tbody></table>";

    private const string CleanTable = "<table><thead><tr><th scope=\"col\">Custodian</th><th scope=\"col\">Size</th></tr></thead><tbody><tr><td>Smith</td><td>12 GB</td></tr></tbody></table>";

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

    private Task<HttpResponseMessage> CreateRawAsync(string? description) => _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, extra: new() { ["description"] = description }));

    private static Dictionary<string, object?> UpdateBody(JsonElement task, string? description) => new()
    {
        ["rowVersion"] = RowVersion(task),
        ["title"] = task.GetProperty("title").GetString(),
        ["description"] = description,
        ["requestorName"] = task.GetProperty("requestorName").GetString(),
        ["requestorEmail"] = task.GetProperty("requestorEmail").GetString(),
        ["dueDate"] = task.GetProperty("dueDate").GetString(),
    };

    private Task<HttpResponseMessage> UpdateRawAsync(JsonElement task, string? description) =>
        _h.Admin.PutAsJsonAsync($"/api/v1/tasks/{TaskId(task)}", UpdateBody(task, description));

    private static string Errors(JsonElement problem) => problem.GetProperty("errors").GetRawText();

    private static string Cells(int count)
    {
        var sb = new System.Text.StringBuilder("<table><tbody>");
        for (var i = 0; i < count; i++)
            sb.Append(i % 10 == 0 ? "<tr>" : string.Empty).Append("<td>x</td>").Append(i % 10 == 9 || i == count - 1 ? "</tr>" : string.Empty);
        return sb.Append("</tbody></table>").ToString();
    }

    [Fact]
    public async Task A_table_in_the_description_is_stored_sanitized_and_read_back_as_html()
    {
        var created = await OkAsync(await CreateRawAsync("<p>Please load:</p>" + Table), HttpStatusCode.Created);
        created.GetProperty("descriptionFormat").GetString().ShouldBe("HTML");
        created.GetProperty("description").GetString().ShouldBe("<p>Please load:</p>" + CleanTable);

        var read = await _h.GetTaskAsync(TaskId(created));
        read.GetProperty("description").GetString().ShouldBe("<p>Please load:</p>" + CleanTable);
        read.GetProperty("descriptionFormat").GetString().ShouldBe("HTML");
        (await _h.ScalarAsync("SELECT COUNT(*) AS Value FROM dbo.Task WHERE DescriptionFormat = 'HTML'")).ShouldBe(1);
    }

    [Fact]
    public async Task Hostile_html_is_neutralised_on_create_and_on_update()
    {
        const string hostile = "<p onclick=\"alert(1)\">Hi<script>alert(1)</script><img src=x onerror=alert(2)></p><table style=\"position:fixed\"><tr><td colspan=\"2 onmouseover=alert(3)\"><svg><style><a title=\"</style><img src onerror=alert(4)>\"></td></tr></table><a href=\"javascript:alert(5)\">x</a>";
        var created = await OkAsync(await CreateRawAsync(hostile), HttpStatusCode.Created);
        AssertNeutral(created.GetProperty("description").GetString()!);

        var updated = await OkAsync(await UpdateRawAsync(created, hostile + "<p>more</p>"));
        AssertNeutral(updated.GetProperty("description").GetString()!);
        updated.GetProperty("description").GetString()!.ShouldContain("more");

        static void AssertNeutral(string html)
        {
            foreach (var bad in new[] { "<script", "<img", "<svg", "<style", "onclick", "onerror", "onmouseover", "javascript:", "style=", "alert(" })
                html.ShouldNotContain(bad, Case.Insensitive, html);
            html.ShouldContain("<table>");
            html.ShouldContain("Hi");
        }
    }

    [Fact]
    public async Task Plain_text_through_the_api_becomes_escaped_paragraphs_and_keeps_its_line_breaks()
    {
        var created = await OkAsync(await CreateRawAsync("Line one\nLine two\n\nSecond paragraph from John <john@example.com> if a < b & c"), HttpStatusCode.Created);
        created.GetProperty("descriptionFormat").GetString().ShouldBe("HTML");
        created.GetProperty("description").GetString().ShouldBe("<p>Line one<br>Line two</p><p>Second paragraph from John &lt;john@example.com&gt; if a &lt; b &amp; c</p>");
    }

    [Fact]
    public async Task An_empty_description_is_null_and_a_description_of_empty_markup_too()
    {
        (await OkAsync(await CreateRawAsync("   "), HttpStatusCode.Created)).GetProperty("description").ValueKind.ShouldBe(JsonValueKind.Null);
        (await OkAsync(await CreateRawAsync("<p><br></p><script>x</script>"), HttpStatusCode.Created)).GetProperty("description").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task Size_and_table_limits_answer_with_clear_validation_errors()
    {
        var tooBigHtml = await ProblemAsync(await CreateRawAsync("<p>" + new string('x', 100_001) + "</p>"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        Errors(tooBigHtml).ShouldContain("HTML_TOO_LARGE");

        var tooLongText = await ProblemAsync(await CreateRawAsync(new string('y', 20_001)), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        Errors(tooLongText).ShouldContain("TOO_LONG");

        var tooManyCells = await ProblemAsync(await CreateRawAsync(Cells(201)), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        Errors(tooManyCells).ShouldContain("TABLE_TOO_LARGE");

        var flood = await ProblemAsync(await CreateRawAsync(Cells(5000)), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        Errors(flood).ShouldContain("TABLE_TOO_LARGE");

        var nested = await ProblemAsync(await CreateRawAsync(string.Concat(Enumerable.Repeat("<div>", 30))), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        Errors(nested).ShouldContain("TOO_COMPLEX");

        var overInput = await ProblemAsync(await CreateRawAsync(new string('z', 300_001)), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        overInput.GetProperty("errors").GetRawText().ShouldContain("description", Case.Insensitive);

        (await OkAsync(await CreateRawAsync(Cells(200)), HttpStatusCode.Created)).GetProperty("description").GetString()!.ShouldContain("<table>");
    }

    [Fact]
    public async Task A_description_written_before_the_change_stays_text_until_it_is_edited()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["description"] = "placeholder" });
        await _h.ExecuteAsync($"UPDATE dbo.Task SET Description = N'Old line 1\nOld <b>line</b> 2 & more', DescriptionFormat = 'TEXT' WHERE TaskId = {TaskId(task)}");

        var legacy = await _h.GetTaskAsync(TaskId(task));
        legacy.GetProperty("descriptionFormat").GetString().ShouldBe("TEXT");
        legacy.GetProperty("description").GetString().ShouldBe("Old line 1\nOld <b>line</b> 2 & more");

        // An older client (or a title edit) sends the text back unchanged: nothing changes, it stays text, nothing is audited.
        var before = (await _h.AuditAsync(TaskId(task))).Count;
        var echoed = await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/tasks/{TaskId(task)}", UpdateBody(legacy, legacy.GetProperty("description").GetString())));
        echoed.GetProperty("descriptionFormat").GetString().ShouldBe("TEXT");
        RowVersion(echoed).ShouldBe(RowVersion(legacy));
        (await _h.AuditAsync(TaskId(task))).Count.ShouldBe(before);

        // A title-only change keeps the description text as it is.
        var retitled = await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/tasks/{TaskId(task)}", new Dictionary<string, object?>(UpdateBody(legacy, legacy.GetProperty("description").GetString())) { ["title"] = "Retitled" }));
        retitled.GetProperty("descriptionFormat").GetString().ShouldBe("TEXT");
        retitled.GetProperty("description").GetString().ShouldBe("Old line 1\nOld <b>line</b> 2 & more");

        // Editing it converts it to HTML.
        var edited = await OkAsync(await UpdateRawAsync(retitled, "<p>Edited</p>" + Table));
        edited.GetProperty("descriptionFormat").GetString().ShouldBe("HTML");
        edited.GetProperty("description").GetString().ShouldBe("<p>Edited</p>" + CleanTable);
    }

    [Fact]
    public async Task The_audit_trail_keeps_the_text_of_a_description_change_never_its_markup()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["description"] = "<p>Before <b>bold</b></p>" });
        await OkAsync(await UpdateRawAsync(task, "<p>After</p>" + Table));

        var change = (await _h.AuditAsync(TaskId(task))).Single(e => e.FieldKey == "description");
        change.OldValue.ShouldBe("Before bold");
        change.NewValue.ShouldBe("After\nCustodian | Size\nSmith | 12 GB");
        change.OldValue!.ShouldNotContain("<");
        change.NewValue!.ShouldNotContain("<");

        var activity = await OkAsync(await _h.Admin.GetAsync($"/api/v1/tasks/{TaskId(task)}/activity"));
        activity.GetRawText().ShouldContain("Description changed");
    }

    [Fact]
    public async Task Saving_the_same_html_again_is_a_no_op()
    {
        var task = await _h.CreateTaskAsync(_w, extra: new() { ["description"] = "<p>Please load:</p>" + Table });
        var before = (await _h.AuditAsync(TaskId(task))).Count;

        var again = await OkAsync(await UpdateRawAsync(task, task.GetProperty("description").GetString()));

        RowVersion(again).ShouldBe(RowVersion(task));
        (await _h.AuditAsync(TaskId(task))).Count.ShouldBe(before);
    }

    [Fact]
    public async Task Comments_accept_tables_and_neutralise_hostile_html()
    {
        var task = await _h.CreateTaskAsync(_w, ordered: false);
        var url = $"/api/v1/tasks/{TaskId(task)}/comments";

        var comment = await OkAsync(await _h.Admin.PostAsJsonAsync(url, new { bodyHtml = "<p>See:</p>" + Table }), HttpStatusCode.Created);
        comment.GetProperty("bodyHtml").GetString().ShouldBe("<p>See:</p>" + CleanTable);

        var hostile = await OkAsync(await _h.Admin.PostAsJsonAsync(url, new { bodyHtml = "<table><tr><td onclick=\"x()\" style=\"x\"><img src=x onerror=alert(1)>cell</td></tr></table>" }), HttpStatusCode.Created);
        hostile.GetProperty("bodyHtml").GetString().ShouldBe("<table><tbody><tr><td>cell</td></tr></tbody></table>");

        var big = await ProblemAsync(await _h.Admin.PostAsJsonAsync(url, new { bodyHtml = Cells(201) }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        big.GetProperty("errors").GetRawText().ShouldContain("TABLE_TOO_LARGE");
    }
}
