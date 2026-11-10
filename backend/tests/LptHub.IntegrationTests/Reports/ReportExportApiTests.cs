using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;

namespace LptHub.IntegrationTests.Reports;

/// <summary>GET /api/v1/reports/runs/{runId}/export.csv: the export equals the grid, ownership, expiry, the row cap, the headers, the run log and the audit event (issue #721).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportExportApiTests(SqlServerFixture sql)
{
    private const string People =
        "SELECT * FROM (VALUES (1, N'beta', 10.5, CAST('2026-10-02' AS date), 1), (2, N'Alpha', 2.0, CAST('2026-10-01' AS date), 0), (3, NULL, NULL, NULL, NULL), (4, N'alpha', 7.25, CAST('2026-10-03' AS date), 1), (5, N'=Gamma, Inc', 10.5, CAST('2026-09-30' AS date), 0)) v(id, name, price, due, done)";

    private static string Rows(Guid run, string query = "") => $"/api/v1/reports/runs/{run}/rows{query}";

    private static string Export(Guid run, string query = "") => $"/api/v1/reports/runs/{run}/export.csv{query}";

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static async Task<Guid> RunAsync(HttpClient client, int report)
    {
        var response = await client.PostAsync($"/api/v1/reports/{report}/runs", ReportTestHarness.Parameters(new { }));
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return Guid.Parse((await ReadAsync(response)).GetProperty("runId").GetString()!);
    }

    /// <summary>A small RFC 4180 reader: the text after the byte order mark, rows split on CRLF outside quotes.</summary>
    private static List<List<string>> ParseCsv(string text)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (quoted)
            {
                if (ch == '"' && i + 1 < text.Length && text[i + 1] == '"')
                {
                    cell.Append('"');
                    i++;
                }
                else if (ch == '"')
                {
                    quoted = false;
                }
                else
                {
                    cell.Append(ch);
                }
            }
            else if (ch == '"')
            {
                quoted = true;
            }
            else if (ch == ',')
            {
                row.Add(cell.ToString());
                cell.Clear();
            }
            else if (ch == '\r' && i + 1 < text.Length && text[i + 1] == '\n')
            {
                row.Add(cell.ToString());
                cell.Clear();
                rows.Add(row);
                row = [];
                i++;
            }
            else
            {
                cell.Append(ch);
            }
        }

        text.EndsWith("\r\n", StringComparison.Ordinal).ShouldBeTrue("every line ends with CRLF");
        return rows;
    }

    private static async Task<(List<List<string>> Rows, byte[] Bytes)> DownloadAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var bytes = await response.Content.ReadAsByteArrayAsync();
        bytes[..3].ShouldBe([0xEF, 0xBB, 0xBF]);
        return (ParseCsv(Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3)), bytes);
    }

    /// <summary>The grid's cell as the export writes it.</summary>
    private static string Cell(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.Null => "",
        JsonValueKind.Number => v.GetDecimal().ToString(CultureInfo.InvariantCulture),
        _ => v.GetString()!,
    };

    [Fact]
    public async Task The_export_equals_the_filtered_and_sorted_grid_rows_in_the_given_column_order_and_carries_the_download_headers()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync(People, roleIds: role);
        var run = await RunAsync(runner, report);
        var query = "?sort=price:desc,id:asc&filter=" + Uri.EscapeDataString("[{\"column\":\"name\",\"op\":\"contains\",\"value\":\"a\"}]");

        var grid = await ReadAsync(await runner.GetAsync(Rows(run, query + "&pageSize=250")));
        var response = await runner.GetAsync(Export(run, query + "&columns=name&columns=id&columns=due"));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.ToString().ShouldBe("text/csv; charset=utf-8");
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
        response.Headers.GetValues("X-Content-Type-Options").ShouldBe(["nosniff"]);
        var disposition = response.Content.Headers.ContentDisposition!;
        disposition.DispositionType.ShouldBe("attachment");
        disposition.FileName!.Trim('"').ShouldMatch(@"^report-1-\d{8}-\d{4}\.csv$");
        response.Headers.Contains("Set-Cookie").ShouldBeFalse();

        var bytes = await response.Content.ReadAsByteArrayAsync();
        bytes[..3].ShouldBe([0xEF, 0xBB, 0xBF]);
        var csv = ParseCsv(Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3));
        csv[0].ShouldBe(["name", "id", "due"]);
        var expected = grid.GetProperty("rows").EnumerateArray().Select(r => new List<string> { Cell(r[1]), Cell(r[0]), Cell(r[3]) }).ToList();
        expected.Count.ShouldBe(grid.GetProperty("filteredRows").GetInt32());
        expected.Count.ShouldBe(4);
        csv.Skip(1).Select(r => string.Join("|", r)).ShouldBe(expected.Select(r => string.Join("|", r)).Select(Guard));
        response.Headers.GetValues("X-Export-Rows").ShouldBe(["4"]);
        // The unfiltered export has every row, the gap row has empty cells, the formula-looking text is guarded and quoted.
        var all = (await DownloadAsync(runner, Export(run, "?sort=id:asc"))).Rows;
        all.Count.ShouldBe(6);
        all[0].ShouldBe(["id", "name", "price", "due", "done"]);
        all[3].ShouldBe(["3", "", "", "", ""]);
        all[5][1].ShouldBe("'=Gamma, Inc");
        all[1].ShouldBe(["1", "beta", "10.50", "2026-10-02", "1"]); // the decimal keeps its own scale
    }

    private static string Guard(string row) => row.Replace("|=Gamma, Inc", "|'=Gamma, Inc", StringComparison.Ordinal).Replace("=Gamma, Inc|", "'=Gamma, Inc|", StringComparison.Ordinal);

    [Fact]
    public async Task Another_persons_result_is_404_an_unknown_id_is_404_and_a_replaced_result_is_410()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, boRole) = await h.PersonAsync(@"KE\bo", "Report.Run");
        var report = await h.AddReportAsync(People, roleIds: [role, boRole]);
        var annRun = await RunAsync(ann, report);

        var stranger = await bo.GetAsync(Export(annRun));
        var unknown = await bo.GetAsync(Export(Guid.NewGuid()));
        stranger.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        unknown.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.Content.ReadAsStringAsync()).ShouldNotContain("expired");
        (await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportRun WHERE Kind = 'Export'")).ShouldBe(0);

        await RunAsync(ann, report); // one live result per person: the first is gone
        var expired = await ann.GetAsync(Export(annRun));
        expired.StatusCode.ShouldBe(HttpStatusCode.Gone);
        (await ReadAsync(expired)).GetProperty("code").GetString().ShouldBe("RESULT_EXPIRED");
        (await bo.GetAsync(Export(annRun))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportRun WHERE Kind = 'Export'")).ShouldBe(0);
    }

    [Fact]
    public async Task Without_Report_Run_the_export_is_forbidden()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var run = await RunAsync(ann, await h.AddReportAsync(People, roleIds: role));

        (await manager.GetAsync(Export(run))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_bad_sort_filter_or_column_is_400_and_writes_nothing()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var run = await RunAsync(ann, await h.AddReportAsync(People, roleIds: role));

        foreach (var query in new[] { "?sort=nope:asc", "?filter=%7Bbroken", "?columns=id&columns=nope", "?filter=" + Uri.EscapeDataString("[{\"column\":\"id\",\"op\":\"contains\",\"value\":\"1\"}]") })
        {
            var response = await ann.GetAsync(Export(run, query));
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, query);
            (await ReadAsync(response)).GetProperty("code").GetString().ShouldBe("RESULT_QUERY_INVALID");
        }

        (await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportRun WHERE Kind = 'Export'")).ShouldBe(0);
    }

    [Fact]
    public async Task A_result_cut_at_the_row_cap_exports_only_the_kept_rows_and_the_file_name_says_truncated()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var run = await RunAsync(ann, await h.AddReportAsync(People, maxRows: 3, roleIds: role));

        var response = await ann.GetAsync(Export(run));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentDisposition!.FileName!.Trim('"').ShouldEndWith("-truncated.csv");
        response.Headers.GetValues("X-Export-Truncated").ShouldBe(["true"]);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        ParseCsv(Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3)).Count.ShouldBe(1 + 3);
        (await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT [RowCount] FROM dbo.ReportRun WHERE Kind = 'Export'")).ShouldBe(3);
        (await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT Status FROM dbo.ReportRun WHERE Kind = 'Export'")).ShouldBe("Truncated");
    }

    [Fact]
    public async Task An_export_is_one_run_log_row_of_kind_Export_and_one_audit_event_without_the_filter_values()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var report = await h.AddReportAsync(People, roleIds: role);
        var userId = await h.Tasks.UserIdAsync(@"KE\ann");
        var run = await RunAsync(ann, report);
        var filter = Uri.EscapeDataString("[{\"column\":\"name\",\"op\":\"contains\",\"value\":\"secret_filter_value\"}]");

        (await ann.GetAsync(Export(run, "?sort=id:desc&columns=id&columns=name&filter=" + filter))).StatusCode.ShouldBe(HttpStatusCode.OK);

        var log = (await h.RunLogAsync(report)).EnumerateArray().Where(r => r.GetProperty("Kind").GetString() == "Export").ShouldHaveSingleItem();
        log.GetProperty("Status").GetString().ShouldBe("Succeeded");
        log.GetProperty("UserId").GetInt32().ShouldBe(userId);
        log.TryGetProperty("ParametersJson", out var parameters).ShouldBeFalse(parameters.ToString()); // FOR JSON leaves out a null column
        (await SqlServerFixture.ScalarAsync(h.AppConnection, "SELECT ExportedRowCount FROM dbo.ReportRun WHERE Kind = 'Export'")).ShouldBe(0);

        var events = (await h.AuditAsync(report)).Where(e => e.GetProperty("EventType").GetString() == "REPORT_EXPORT").ToList();
        var export = events.ShouldHaveSingleItem();
        export.GetProperty("ActorUserId").GetInt32().ShouldBe(userId);
        export.GetProperty("Summary").GetString().ShouldBe("Exported 0 rows of report 'Report 1' (version 1) as CSV");
        var details = JsonDocument.Parse(export.GetProperty("NewValue").GetString()!).RootElement;
        details.GetProperty("rows").GetInt32().ShouldBe(0);
        details.GetProperty("version").GetInt32().ShouldBe(1);
        details.GetProperty("filter").GetString().ShouldBe("filter: name contains | sort: id desc");
        details.GetProperty("columns").EnumerateArray().Select(c => c.GetString()).ShouldBe(["id", "name"]);
        export.ToString().ShouldNotContain("secret_filter_value");
        (await ann.GetAsync(Rows(run))).StatusCode.ShouldBe(HttpStatusCode.OK); // the result stays usable after an export
    }

    [Fact]
    public async Task A_result_whose_report_was_deactivated_or_unassigned_after_the_run_is_not_exported()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var report = await h.AddReportAsync(People, roleIds: role);
        var run = await RunAsync(ann, report);

        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"DELETE dbo.RoleReport WHERE ReportId = {report}");
        var unassigned = await ann.GetAsync(Export(run));
        unassigned.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ReadAsync(unassigned)).GetProperty("code").GetString().ShouldBe("NOT_FOUND");

        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"INSERT dbo.RoleReport (RoleId, ReportId) VALUES ({role}, {report})");
        (await ann.GetAsync(Export(run))).StatusCode.ShouldBe(HttpStatusCode.OK);
        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportDefinition SET IsActive = 0 WHERE ReportId = {report}");
        (await ann.GetAsync(Export(run))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
