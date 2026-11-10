using System.Globalization;
using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Reports.ReportSecurityKit;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>
/// CSV safety end to end (issue #725, spec 12.3 and 16.3 g, threat 7.6): hostile text produced by a real query through the real login, every formula prefix,
/// real negative numbers, headers, quoting and embedded line breaks read back with an RFC 4180 reader; the export equal to the grid for the same filter and sort;
/// and an export that must be refused (permission gone, result expired, someone else's).
/// </summary>
[Collection(SqlServerCollection.Name)]
[Trait("Suite", "ReportsSecurity")]
public sealed class ReportCsvExportSecurityTests(SqlServerFixture sql)
{
    private static string SqlLiteral(string json) => "N'" + json.Replace("'", "''", StringComparison.Ordinal) + "'";

    [Fact]
    public async Task Hostile_cells_and_headers_from_a_real_query_come_out_guarded_quoted_and_whole()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var guarded = Corpus("csv-formula-corpus.json", "guarded");
        var safe = Corpus("csv-formula-corpus.json", "safe");
        var awkward = new[] { "a,b", "say \"hi\"", "line1\nline2", "line1\r\nline2", "cr\ronly", "quote\" and, comma\nand newline", " lead", "trail ", "café 😀", "'", "\"" };
        var all = guarded.Concat(safe).Concat(awkward).ToList();
        var json = JsonSerializer.Serialize(all);
        var report = await h.AddReportAsync(
            $"SELECT CAST(j.[key] AS int) AS id, j.[value] AS note, -5 AS neg, CAST(-0.25 AS decimal(9,2)) AS negd, CAST('2026-10-02' AS date) AS day, 1 AS [=1+1], 2 AS [@x], 3 AS [-y], 4 AS [+z], 5 AS [a,b] FROM OPENJSON({SqlLiteral(json)}) j ORDER BY CAST(j.[key] AS int)",
            roleIds: role);
        var run = await RunOkAsync(runner, report);

        var csv = await DownloadCsvAsync(runner, Export(run, "?sort=id:asc"));

        csv[0].ShouldBe(["id", "note", "neg", "negd", "day", "'=1+1", "'@x", "'-y", "'+z", "a,b"]);
        csv.Count.ShouldBe(1 + all.Count, "embedded line breaks do not split a record");
        for (var i = 0; i < all.Count; i++)
        {
            var row = csv[i + 1];
            var expected = i < guarded.Count ? "'" + all[i] : all[i];
            row[0].ShouldBe(i.ToString(CultureInfo.InvariantCulture));
            row[1].ShouldBe(expected, $"#{i} [{all[i].Replace("\n", "\\n", StringComparison.Ordinal).Replace("\r", "\\r", StringComparison.Ordinal).Replace("\t", "\\t", StringComparison.Ordinal)}]");
            row.Skip(2).ShouldBe(["-5", "-0.25", "2026-10-02", "1", "2", "3", "4", "5"], $"#{i}: numbers and dates are written from typed values and never guarded");
        }
    }

    [Fact]
    public async Task The_export_equals_the_grid_row_for_row_for_every_filter_and_sort_including_the_position_sort()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync(
            "SELECT CAST(x.n AS int) AS id, CASE WHEN x.n % 7 = 0 THEN NULL ELSE CONCAT(CASE WHEN x.n % 3 = 0 THEN N'=' ELSE N'name ' END, x.n * 37 % 101) END AS name, x.n % 13 - 6 AS [Qty, total], CAST(x.n % 17 AS decimal(9,2)) / 4 AS price " +
            "FROM (SELECT TOP (700) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) x ORDER BY x.n",
            roleIds: role);
        var run = await RunOkAsync(runner, report);
        var scenarios = new (string Sort, string Filter)[]
        {
            ("", ""),
            ("name:asc", ""),
            ("#1:desc,#0:asc", ""),
            ("#2:asc,#3:desc", "[{\"column\":\"name\",\"op\":\"contains\",\"value\":\"name 1\"}]"),
            ("#3:desc", "[{\"column\":\"Qty, total\",\"op\":\"lte\",\"value\":\"-1\"},{\"column\":\"name\",\"op\":\"startsWith\",\"value\":\"=\"}]"),
            ("", "[{\"column\":\"name\",\"op\":\"blank\"}]"),
            ("#1:asc", "[{\"column\":\"price\",\"op\":\"between\",\"value\":\"1\",\"value2\":\"3\"}]"),
        };

        foreach (var (sort, filter) in scenarios)
        {
            var query = "?" + string.Join("&", new[] { sort.Length > 0 ? "sort=" + Uri.EscapeDataString(sort) : null, filter.Length > 0 ? "filter=" + Uri.EscapeDataString(filter) : null }.Where(q => q is not null));
            var grid = new List<JsonElement>();
            int filtered;
            for (var page = 1; ; page++)
            {
                var body = await ReadAsync(await runner.GetAsync(Rows(run, (query.Length > 1 ? query + "&" : "?") + $"page={page}&pageSize=250")));
                grid.AddRange(body.GetProperty("rows").EnumerateArray().Select(r => r.Clone()));
                filtered = body.GetProperty("filteredRows").GetInt32();
                if (grid.Count >= filtered)
                    break;
            }

            var csv = await DownloadCsvAsync(runner, Export(run, query));

            csv.Count.ShouldBe(1 + filtered, query);
            grid.Count.ShouldBe(filtered);
            for (var i = 0; i < grid.Count; i++)
            {
                string Cell(JsonElement v) => v.ValueKind switch { JsonValueKind.Null => "", JsonValueKind.Number => v.GetDecimal().ToString(CultureInfo.InvariantCulture), _ => v.GetString()! };
                var expected = grid[i].EnumerateArray().Select(Cell).ToList();
                var actual = csv[i + 1].Select((c, k) => k == 1 && c.StartsWith("'=", StringComparison.Ordinal) ? c[1..] : c).ToList();
                actual[0].ShouldBe(expected[0], $"{query} row {i}");
                actual[1].ShouldBe(expected[1], $"{query} row {i}");
                actual[2].ShouldBe(expected[2], $"{query} row {i}");
                decimal.Parse(actual[3], CultureInfo.InvariantCulture).ShouldBe(decimal.Parse(expected[3], CultureInfo.InvariantCulture), $"{query} row {i}"); // the grid sends 4.25, the file keeps the scale
            }
        }

        // Hidden columns and a new column order apply to the file only through the columns parameter, and the rows stay the same.
        var some = await DownloadCsvAsync(runner, Export(run, "?sort=" + Uri.EscapeDataString("#0:asc") + "&columns=price&columns=id"));
        some[0].ShouldBe(["price", "id"]);
        some.Count.ShouldBe(701);
    }

    [Fact]
    public async Task An_export_is_refused_when_the_permission_is_gone_the_result_expired_or_the_result_is_someone_elses_and_no_file_bytes_leave()
    {
        await using var h = await ReportTestHarness.StartAsync(sql, true, ("Reports:ResultIdleMinutes", "0"));
        var (ann, annRole) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var (bo, _) = await h.PersonAsync(@"KE\bo", "Report.Run");
        await h.Factory.GrantRoleAsync(@"KE\bo", annRole);
        var report = await h.AddReportAsync("SELECT 'secret-cell' AS s", roleIds: annRole);

        var run = await RunOkAsync(ann, report); // idle time 0: the result is gone as soon as it is looked up again

        var expired = await ann.GetAsync(Export(run));
        expired.StatusCode.ShouldBe(HttpStatusCode.Gone);
        expired.Content.Headers.ContentDisposition.ShouldBeNull();
        var gone = await expired.Content.ReadAsStringAsync();
        gone.ShouldNotContain("secret-cell");
        JsonDocument.Parse(gone).RootElement.GetProperty("code").GetString().ShouldBe("RESULT_EXPIRED");
        var stranger = await bo.GetAsync(Export(run));
        stranger.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await stranger.Content.ReadAsStringAsync()).ShouldNotContain("expired");
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportRun WHERE Kind = 'Export'")).ShouldBe(0);
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AuditEvent WHERE EventType = 'REPORT_EXPORT'")).ShouldBe(0);
    }

    [Fact]
    public async Task A_person_who_lost_Report_Run_gets_403_for_the_rows_and_the_export_of_a_result_made_before()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (ann, role) = await h.PersonAsync(@"KE\ann", "Report.Run");
        var report = await h.AddReportAsync("SELECT 'secret-cell' AS s", roleIds: role);
        var run = await RunOkAsync(ann, report);
        (await DownloadCsvAsync(ann, Export(run))).Count.ShouldBe(2);

        await SqlServerFixture.ExecuteAsync(h.AppConnection, $"DELETE rp FROM dbo.RolePermission rp JOIN dbo.Permission p ON p.PermissionId = rp.PermissionId WHERE rp.RoleId = {role} AND p.Code = N'Report.Run'");
        h.Factory.InvalidateAll();

        foreach (var url in new[] { Rows(run), Export(run), $"/api/v1/reports/{report}", "/api/v1/reports" })
        {
            var response = await ann.GetAsync(url);
            response.StatusCode.ShouldBe(HttpStatusCode.Forbidden, url);
            (await response.Content.ReadAsStringAsync()).ShouldNotContain("secret-cell");
        }

        (await ann.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { }))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportRun WHERE Kind = 'Export'")).ShouldBe(1, "only the export that was allowed");
    }
}
