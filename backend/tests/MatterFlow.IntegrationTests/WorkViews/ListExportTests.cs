using System.Net;
using System.Net.Http.Json;
using System.Text;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>GET /task-queue/export and POST /exports/log (PM v2, #879): the export lists exactly the rows of the screen, formula-safe, with the byte order mark, audited.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ListExportTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private async Task<(HttpResponseMessage Response, string Text)> ExportAsync(HttpClient client, string query)
    {
        var response = await client.GetAsync("/api/v1/task-queue/export?" + query);
        var bytes = response.IsSuccessStatusCode ? await response.Content.ReadAsByteArrayAsync() : [];
        return (response, Encoding.UTF8.GetString(bytes));
    }

    [Fact]
    public async Task The_csv_has_the_byte_order_mark_one_row_per_listed_task_and_guards_formulas()
    {
        await MakeAsync("=HYPERLINK(\"http://x\")", M1, new() { ["dueDate"] = "2099-01-01" });
        var query = "managedByMe=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD";
        var total = await TotalAsync(A, "task-queue", query);
        total.ShouldBeGreaterThan(0);

        var (response, text) = await ExportAsync(A, query);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("text/csv");
        var raw = await A.GetByteArrayAsync("/api/v1/task-queue/export?" + query);
        raw.Take(3).ShouldBe([(byte)0xEF, (byte)0xBB, (byte)0xBF]);
        var lines = text.TrimStart('﻿').Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        lines[0].ShouldStartWith("Task,Title,Matter");
        (lines.Length - 1).ShouldBe(total, "the export carries exactly the rows the screen counts");
        text.ShouldContain("\"'=HYPERLINK(\"\"http://x\"\")\"");
        text.ShouldNotContain(",=HYPERLINK");
    }

    [Fact]
    public async Task The_text_format_is_tab_separated_and_unknown_formats_are_csv()
    {
        var query = "managedByMe=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD";
        var (response, text) = await ExportAsync(A, query + "&format=text");
        response.Content.Headers.ContentType!.MediaType.ShouldBe("text/plain");
        text.Split('\n')[0].ShouldContain("\t");
        (await ExportAsync(A, query + "&format=bogus")).Response.Content.Headers.ContentType!.MediaType.ShouldBe("text/csv");
    }

    [Fact]
    public async Task Another_manager_exports_only_what_they_may_see_and_an_unknown_filter_is_refused()
    {
        var queryB = "managedByMe=true&status=NEW&status=IN_PROGRESS&status=ON_HOLD";
        var totalB = await TotalAsync(B, "task-queue", queryB);
        var (_, text) = await ExportAsync(B, queryB);
        (text.TrimStart('﻿').Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length - 1).ShouldBe(totalB);
        (await A.GetAsync("/api/v1/task-queue/export?nonsense=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await NoTaskView.GetAsync("/api/v1/task-queue/export")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_browser_side_export_is_logged_for_a_known_surface_only()
    {
        var ok = await A.PostAsJsonAsync("/api/v1/exports/log", new { surface = "my-matters.breakdown", format = "csv", rowCount = 12, filters = "scope=mine" });
        ok.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        var unknown = await A.PostAsJsonAsync("/api/v1/exports/log", new { surface = "nope", format = "csv", rowCount = 1 });
        unknown.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var tooMany = await A.PostAsJsonAsync("/api/v1/exports/log", new { surface = "my-matters.breakdown", format = "csv", rowCount = 10001 });
        tooMany.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
