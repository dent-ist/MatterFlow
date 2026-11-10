using System.Net;
using System.Text;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Reports.ReportSecurityKit;

namespace LptHub.IntegrationTests.Reports;

/// <summary>
/// A report may return two columns of one name (<c>SELECT a.Name, b.Name</c>; issue #1291). The result keeps both under that name, no suffix; sort, filter and export identify a column by
/// its position <c>#n</c> (URL-encoded as <c>%23n</c>), and a name still means the first column with that name.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportDuplicateColumnsApiTests(SqlServerFixture sql)
{
    private const string TwoNames = "SELECT a.Name AS Name, b.Name AS Name, a.Id AS Id FROM (VALUES (1, N'ann'), (2, N'bob'), (3, N'cy')) a (Id, Name) JOIN (VALUES (1, N'zeta'), (2, N'yak'), (3, N'xray')) b (Id, Name) ON b.Id = a.Id";

    private static string Filter(string column, string op, string value) => "&filter=" + Uri.EscapeDataString(JsonSerializer.Serialize(new[] { new { column, op, value } }));

    private static async Task<List<string[]>> RowsAsync(HttpClient client, Guid run, string query)
    {
        var response = await client.GetAsync(Rows(run, query));
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var page = await ReadAsync(response);
        return page.GetProperty("rows").EnumerateArray().Select(r => r.EnumerateArray().Select(c => c.ToString()).ToArray()).ToList();
    }

    private static async Task<string> CsvAsync(HttpClient client, Guid run, string query)
    {
        var response = await client.GetAsync(Export(run, query));
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var bytes = await response.Content.ReadAsByteArrayAsync();
        bytes[..3].ShouldBe([0xEF, 0xBB, 0xBF]);
        return Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
    }

    [Fact]
    public async Task Both_columns_of_one_name_reach_the_grid_sort_filter_and_the_csv_each_with_its_own_values()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync(TwoNames, roleIds: role);
        var runResponse = await runner.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }));
        runResponse.StatusCode.ShouldBe(HttpStatusCode.OK, await runResponse.Content.ReadAsStringAsync());
        var run = await ReadAsync(runResponse);
        // The result keeps what the SQL named: two Name columns, no "Name (2)".
        run.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("name").GetString()).ShouldBe(["Name", "Name", "Id"]);
        var id = Guid.Parse(run.GetProperty("runId").GetString()!);

        // Sort: the second Name puts the rows in the order xray, yak, zeta; the name form means the first column.
        (await RowsAsync(runner, id, "?sort=%231:asc")).Select(r => r[0]).ShouldBe(["cy", "bob", "ann"]);
        (await RowsAsync(runner, id, "?sort=%231:desc")).Select(r => r[0]).ShouldBe(["ann", "bob", "cy"]);
        (await RowsAsync(runner, id, "?sort=%230:desc")).Select(r => r[0]).ShouldBe(["cy", "bob", "ann"]);
        (await RowsAsync(runner, id, "?sort=Name:asc")).Select(r => r[0]).ShouldBe(["ann", "bob", "cy"]);

        // Filter: a position filters that column; the name filters the first.
        (await RowsAsync(runner, id, Filter("#1", "equals", "yak").Replace("&", "?", StringComparison.Ordinal))).ShouldHaveSingleItem().ShouldBe(["bob", "yak", "2"]);
        (await RowsAsync(runner, id, Filter("#0", "equals", "yak").Replace("&", "?", StringComparison.Ordinal))).ShouldBeEmpty();
        (await RowsAsync(runner, id, Filter("Name", "equals", "bob").Replace("&", "?", StringComparison.Ordinal))).ShouldHaveSingleItem().ShouldBe(["bob", "yak", "2"]);
        (await RowsAsync(runner, id, Filter("Name", "equals", "yak").Replace("&", "?", StringComparison.Ordinal))).ShouldBeEmpty();

        // Export: every column under its own name, repeated names stay repeated, each column its own values; the position form picks one of them.
        (await CsvAsync(runner, id, "?sort=%231:asc")).ShouldBe("Name,Name,Id\r\ncy,xray,3\r\nbob,yak,2\r\nann,zeta,1\r\n");
        (await CsvAsync(runner, id, "?columns=%231&columns=%230&sort=%231:desc")).ShouldBe("Name,Name\r\nzeta,ann\r\nyak,bob\r\nxray,cy\r\n");
        (await CsvAsync(runner, id, "?columns=%231" + Filter("#1", "startsWith", "y"))).ShouldBe("Name\r\nyak\r\n");
        (await CsvAsync(runner, id, "?columns=Name&columns=Id")).ShouldBe("Name,Id\r\nann,1\r\nbob,2\r\ncy,3\r\n"); // the name form is the first Name
        (await CsvAsync(runner, id, "?columns=%230&columns=%230&columns=name")).ShouldBe("Name\r\nann\r\nbob\r\ncy\r\n"); // one column named three ways is written once

        // Unknown positions and names are a 400, with no SQL in the answer.
        foreach (var bad in new[] { "?sort=%237", "?sort=%2399999999999999999999", "?sort=Nope", $"?columns=%237", Filter("#9", "equals", "x").Replace("&", "?", StringComparison.Ordinal) })
        {
            var rows = await runner.GetAsync(Rows(id, bad));
            var export = await runner.GetAsync(Export(id, bad));
            if (!bad.StartsWith("?columns", StringComparison.Ordinal))
                rows.StatusCode.ShouldBe(HttpStatusCode.BadRequest, bad);
            export.StatusCode.ShouldBe(HttpStatusCode.BadRequest, bad);
            (await export.Content.ReadAsStringAsync()).ShouldNotContain("SELECT", Case.Insensitive);
        }
    }

    [Fact]
    public async Task Names_that_look_like_positions_are_still_reachable_by_position_only()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync("SELECT 1 AS [#1], 'b' AS [#0]", roleIds: role);
        var id = await RunOkAsync(runner, report);

        // "#1" is a position, so it is the second column (named "#0"), never the first one named "#1".
        (await CsvAsync(runner, id, "?columns=%231")).ShouldBe("#0\r\nb\r\n");
        (await CsvAsync(runner, id, "?columns=%230")).ShouldBe("#1\r\n1\r\n");
    }
}
