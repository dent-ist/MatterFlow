using System.Diagnostics;
using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Shouldly;
using static MatterFlow.IntegrationTests.Reports.ReportSecurityKit;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>
/// Injection through the real report login (issue #725, spec 16.3 a, threat 7.1). The values come from the checked-in corpus
/// <c>injection-values.json</c>: every one is sent for every parameter type, and each must either come back as a plain value, or be refused with the
/// parameter's name, and never change the executed statement, never run a second statement and never make the API fail. The same goes for the sort,
/// filter, column and paging inputs of the rows and export endpoints, including the position form <c>#n</c> of the sort.
/// </summary>
[Collection(SqlServerCollection.Name)]
[Trait("Suite", "ReportsSecurity")]
public sealed class ReportInjectionCorpusTests(SqlServerFixture sql)
{
    private static readonly (string Key, string Value)[] NoRateLimit = [("Reports:RunsPerUserPerHour", "100000")];

    private static Task<ReportTestHarness> StartAsync(SqlServerFixture sql) => ReportTestHarness.StartAsync(sql, true, NoRateLimit);

    private static async Task<string> BodyAsync(HttpResponseMessage response) => await response.Content.ReadAsStringAsync();

    [Fact]
    public async Task Hostile_text_is_plain_data_through_the_real_login_and_the_executed_statement_never_changes()
    {
        await using var h = await StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var text = Corpus("injection-values.json", "text").Where(t => t.Length > 0).ToList();
        string[] seeded = ["O'Brien", "' OR 1=1 --", "'; DROP TABLE dbo.AppUser; --", "\"]},{\"", "%", "x' OR 'a'='a"];
        foreach (var name in seeded)
            await AddAppUserAsync(h.AppConnection, name);
        const string param = "[{\"name\":\"T\",\"type\":\"text\",\"label\":\"T\"}]";
        var echo = await h.AddReportAsync("SELECT TOP (1) :T AS echo FROM dbo.AppUser /* inj_echo_marker */", param, roleIds: role);
        var count = await h.AddReportAsync("SELECT COUNT(*) AS n FROM dbo.AppUser WHERE DisplayName = :T /* inj_count_marker */", param, roleIds: role);
        var objects = await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM sys.objects");
        var principals = await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM sys.server_principals");
        var users = await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser");

        foreach (var payload in text)
        {
            var watch = Stopwatch.StartNew();
            var echoRun = await RunOkAsync(runner, echo, new { t = payload });
            var page = await ReadAsync(await runner.GetAsync(Rows(echoRun, "?pageSize=1")));
            var countRun = await RunOkAsync(runner, count, new { t = payload });
            var counted = await ReadAsync(await runner.GetAsync(Rows(countRun, "?pageSize=1")));

            page.GetProperty("rows")[0][0].GetString().ShouldBe(payload, $"[{payload}] must come back exactly as typed");
            counted.GetProperty("rows")[0][0].GetInt32().ShouldBe(seeded.Contains(payload) ? 1 : 0, $"[{payload}]");
            watch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(5), $"[{payload}] a WAITFOR inside the value must not run");
        }

        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser")).ShouldBe(users);
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM sys.objects")).ShouldBe(objects);
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM sys.server_principals")).ShouldBe(principals);

        // The statement that reached SQL Server is the author's text with the placeholder renamed: one text per report, never one per value.
        foreach (var (marker, expected) in new[] { ("inj_echo_marker", "SELECT TOP (1) @p_T AS echo FROM dbo.AppUser /* inj_echo_marker */"), ("inj_count_marker", "SELECT COUNT(*) AS n FROM dbo.AppUser WHERE DisplayName = @p_T /* inj_count_marker */") })
        {
            var texts = await CachedStatementsAsync(h.AppConnection, marker);
            texts.Count.ShouldBe(1, $"{marker}: {string.Join(" || ", texts)}");
            texts[0].ShouldEndWith(expected);
            texts[0].ShouldStartWith("(@p_T nvarchar(400))"); // the value was declared as nvarchar(400), never written into the text
        }
    }

    private static async Task<List<string>> CachedStatementsAsync(string connectionString, string marker)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT DISTINCT t.text FROM sys.dm_exec_query_stats s CROSS APPLY sys.dm_exec_sql_text(s.sql_handle) t WHERE t.text LIKE N'%' + @m + N'%' AND t.text NOT LIKE N'%dm_exec_query_stats%'";
        command.Parameters.AddWithValue("@m", marker);
        var texts = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            texts.Add(reader.GetString(0));
        return texts;
    }

    [Fact]
    public async Task Every_other_parameter_type_takes_the_corpus_as_a_value_or_refuses_it_by_name_and_nothing_else_happens()
    {
        await using var h = await StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var text = Corpus("injection-values.json", "text");
        var numbers = Corpus("injection-values.json", "numbers");
        var dates = Corpus("injection-values.json", "dates");
        var ids = Corpus("injection-values.json", "ids");
        const string parameters = """
            [{"name":"N","type":"number","label":"N"},{"name":"I","type":"number","label":"I","integerOnly":true},{"name":"D","type":"date","label":"D"},
             {"name":"S","type":"single","label":"S","optionsKind":"fixed","options":[{"value":"ok","label":"Ok"}]},
             {"name":"M","type":"multi","label":"M","optionsKind":"fixed","options":[{"value":"ok","label":"Ok"}]},
             {"name":"L","type":"lookup","lookupKind":"matter","label":"L"},{"name":"ML","type":"lookup","lookupKind":"matter","lookupMulti":true,"label":"ML"},
             {"name":"Y","type":"yesNo","label":"Y"},{"name":"R","type":"dateRange","label":"R"}]
            """;
        var report = await h.AddReportAsync(
            "SELECT :N AS n, :I AS i, :D AS d, :S AS s, (SELECT COUNT(*) FROM :M) AS m, (SELECT COUNT(*) FROM :ML) AS ml, :L AS l, :Y AS y, :R_FROM AS rf, :R_TO AS rt",
            parameters,
            roleIds: role);
        var users = await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser");
        var objects = await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM sys.objects");

        var cases = new List<(string Name, object Value, string Label)>();
        foreach (var v in numbers.Concat(text))
        {
            cases.Add(("N", v, v));
            cases.Add(("I", v, v));
        }

        foreach (var v in dates.Concat(text))
        {
            cases.Add(("D", v, v));
            cases.Add(("R", new { from = v, to = "2026-01-01" }, v));
            cases.Add(("R", new { from = "2026-01-01", to = v }, v));
        }

        foreach (var v in text)
        {
            cases.Add(("S", v, v));
            cases.Add(("M", new[] { "ok", v }, v));
            cases.Add(("M", v, v)); // a bare string where a list is expected
            cases.Add(("Y", v, v));
        }

        foreach (var v in ids.Concat(text))
        {
            cases.Add(("L", v, v));
            cases.Add(("ML", new[] { v }, v));
        }

        var refused = 0;
        var accepted = 0;
        foreach (var (name, value, label) in cases)
        {
            var response = await runner.PostAsync(RunUrl(report), ReportTestHarness.Json(new { parameters = new Dictionary<string, object> { [name] = value } }));
            var body = await BodyAsync(response);

            new[] { HttpStatusCode.OK, (HttpStatusCode)422 }.ShouldContain(response.StatusCode, $"{name} = [{label}] -> {(int)response.StatusCode} {body}");
            ShouldHoldNoSqlTrace(body, $"{name} = [{label}]");
            if (response.StatusCode == HttpStatusCode.OK)
            {
                accepted++;
                continue;
            }

            refused++;
            var problem = JsonDocument.Parse(body).RootElement;
            problem.GetProperty("code").GetString().ShouldBe("REPORT_PARAMETERS_INVALID");
            problem.GetProperty("errors").EnumerateObject().Select(e => e.Name).ShouldBe([$"parameters.{name}"], $"{name} = [{label}]");
        }

        refused.ShouldBeGreaterThan(accepted * 3); // almost everything in the corpus is not a valid value for these types
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportRun WHERE Status = 'Rejected'")).ShouldBe(refused);
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportRun WHERE Status IN ('Failed', 'Running')")).ShouldBe(0);
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser")).ShouldBe(users);
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM sys.objects")).ShouldBe(objects);
    }

    [Fact]
    public async Task Hostile_values_that_the_author_listed_are_bound_as_data_for_a_single_and_a_multi_choice()
    {
        await using var h = await StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var listed = Corpus("injection-values.json", "text").Where(t => t.Length is > 0 and <= 200).Distinct().ToList();
        var options = JsonSerializer.Serialize(listed.Select(t => new { value = t, label = t.Length <= 60 ? t : t[..60] }));
        var parameters = $$"""[{"name":"S","type":"single","label":"S","optionsKind":"fixed","options":{{options}}},{"name":"M","type":"multi","label":"M","optionsKind":"fixed","options":{{options}},"maxSelected":200}]""";
        var single = await h.AddReportAsync("SELECT :S AS echo", parameters, roleIds: role);
        var multi = await h.AddReportAsync("SELECT [value] AS echo FROM :M", parameters, roleIds: role);
        var users = await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser");

        foreach (var payload in listed)
        {
            var run = await RunOkAsync(runner, single, new { s = payload });
            (await ReadAsync(await runner.GetAsync(Rows(run, "?pageSize=1")))).GetProperty("rows")[0][0].GetString().ShouldBe(payload, $"[{payload}]");
        }

        var all = await RunOkAsync(runner, multi, new { m = listed });
        var page = await ReadAsync(await runner.GetAsync(Rows(all, "?pageSize=250")));
        page.GetProperty("rows").EnumerateArray().Select(r => r[0].GetString()).Order(StringComparer.Ordinal).ShouldBe(listed.Order(StringComparer.Ordinal));
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser")).ShouldBe(users);
    }

    [Fact]
    public async Task Built_in_names_and_unknown_names_in_the_request_are_refused_in_every_spelling()
    {
        await using var h = await StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync("SELECT :CURRENT_USER_ID AS me, :T AS t", "[{\"name\":\"T\",\"type\":\"text\",\"label\":\"T\"}]", roleIds: role);
        var users = await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser");

        foreach (var name in new[] { "CURRENT_USER_ID", "current_user_id", " Current_User_Id ", "TODAY", "today", "NOW_UTC", "CURRENT_POD_IDS", "CURRENT_PRIMARY_POD_ID", "FIRM_TIME_ZONE_OFFSET_MINUTES", "CURRENT_USER_NAME", "CURRENT_USER_EMAIL" })
        {
            var response = await runner.PostAsync(RunUrl(report), ReportTestHarness.Json(new { parameters = new Dictionary<string, object> { [name] = 1 } }));

            ((int)response.StatusCode).ShouldBe(422, name);
            var errors = (await ReadAsync(response)).GetProperty("errors");
            errors.EnumerateObject().Single().Value[0].GetProperty("code").GetString().ShouldBe("BUILTIN_NOT_ALLOWED", name);
        }

        foreach (var name in new[] { "X; DROP TABLE dbo.AppUser", "t' OR '1'='1", "NOPE", new string('Z', 5000), "T\u0000", "[T]" })
        {
            var response = await runner.PostAsync(RunUrl(report), ReportTestHarness.Json(new { parameters = new Dictionary<string, object> { [name] = "x" } }));

            ((int)response.StatusCode).ShouldBe(422, name.Length > 40 ? name[..40] : name);
            var body = await BodyAsync(response);
            body.Length.ShouldBeLessThan(2000, "a 5,000-character name is not echoed whole");
            JsonDocument.Parse(body).RootElement.GetProperty("errors").EnumerateObject().Single().Value[0].GetProperty("code").GetString().ShouldBe("UNKNOWN_PARAMETER");
        }

        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser")).ShouldBe(users);
        (await runner.PostAsync(RunUrl(report), ReportTestHarness.Parameters(new { t = "fine" }))).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    // ---- sort, filter, columns and paging of the rows and export endpoints ----

    private const string Grid = "SELECT * FROM (VALUES (1, N'beta', 10.5, CAST('2026-10-02' AS date)), (2, N'Alpha', 2.0, CAST('2026-10-01' AS date)), (3, NULL, NULL, NULL), (4, N'alpha', 7.25, CAST('2026-10-03' AS date))) v(id, name, [Total, USD], due)";

    private static int[] Ids(JsonElement page) => page.GetProperty("rows").EnumerateArray().Select(r => r[0].GetInt32()).ToArray();

    [Fact]
    public async Task Hostile_sort_filter_column_and_paging_inputs_are_a_400_with_a_problem_body_and_never_a_500_or_a_write()
    {
        await using var h = await StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var run = await RunOkAsync(runner, await h.AddReportAsync(Grid, roleIds: role));
        var users = await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser");
        string[] sorts =
        [
            "#-1:asc", "#1.5:asc", "#1e2:asc", "#99999999999999999999:asc", "#4:asc", "#٣:asc", "#:asc", "##1:asc", "#1:desc:asc", "#1:ascending", "#1:", "id:asc; DROP TABLE dbo.AppUser",
            "id' OR '1'='1:asc", "[id]:asc", "\"id\":asc", "id--:asc", "id/*x*/:asc", "nope:asc", "#0,#1,#2,#3:asc", new string('A', 20_000) + ":asc",
        ];

        foreach (var sort in sorts)
        {
            var query = "?sort=" + Uri.EscapeDataString(sort);
            foreach (var url in new[] { Rows(run, query), Export(run, query) })
            {
                var response = await runner.GetAsync(url);
                var body = await BodyAsync(response);

                response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, $"{(sort.Length > 40 ? sort[..40] : sort)} -> {body}");
                new[] { "application/json", "application/problem+json" }.ShouldContain(response.Content.Headers.ContentType!.MediaType, "a JSON problem body, never HTML");
                new[] { "RESULT_QUERY_INVALID", "QUERY_TOO_LARGE" }.ShouldContain(JsonDocument.Parse(body).RootElement.GetProperty("code").GetString(), body); // an absurdly long sort is cut off even earlier
                body.Length.ShouldBeLessThan(1500, "a long name is not echoed whole");
                ShouldHoldNoServerTrace(body, sort.Length > 40 ? sort[..40] : sort);
            }
        }

        string[] filters =
        [
            "[null]", "[{}]", "[{\"op\":\"contains\",\"value\":\"x\"}]", "[{\"column\":null,\"op\":\"contains\"}]", "[{\"column\":\"name\"}]", "[1]", "{\"column\":\"name\"}", "\"text\"", "42", "{broken", "[{\"column\":\"name\",\"op\":\"contains\",\"value\":{\"a\":1}}]",
            "[{\"column\":\"name'; DROP TABLE dbo.AppUser; --\",\"op\":\"contains\",\"value\":\"x\"}]", "[{\"column\":\"name\",\"op\":\"contains; DROP\",\"value\":\"x\"}]", "[{\"column\":\"id\",\"op\":\"gte\",\"value\":\"1; DROP TABLE dbo.AppUser\"}]",
            "[{\"column\":\"due\",\"op\":\"on\",\"value\":\"2026-01-01' OR '1'='1\"}]", "[{\"column\":\"#99\",\"op\":\"gte\",\"value\":\"1\"}]", "[" + string.Join(",", Enumerable.Repeat("{\"column\":\"id\",\"op\":\"gt\",\"value\":\"0\"}", 21)) + "]",
        ];
        foreach (var filter in filters)
        {
            var query = "?filter=" + Uri.EscapeDataString(filter);
            foreach (var url in new[] { Rows(run, query), Export(run, query) })
            {
                var response = await runner.GetAsync(url);
                var body = await BodyAsync(response);

                response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, $"{filter} -> {(int)response.StatusCode} {body}");
                JsonDocument.Parse(body).RootElement.GetProperty("code").GetString().ShouldBe("RESULT_QUERY_INVALID");
                ShouldHoldNoServerTrace(body, filter);
            }
        }

        foreach (var columns in new[] { "?columns=nope", "?columns=id&columns=nope", "?columns=id%3B%20DROP%20TABLE%20dbo.AppUser", "?columns=%23" + "99", "?columns=" + new string('c', 5000) })
        {
            var response = await runner.GetAsync(Export(run, columns));
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, columns.Length > 60 ? columns[..60] : columns);
            (await BodyAsync(response)).Length.ShouldBeLessThan(1500);
        }

        // Paging abuse: a bad number is the framework's 400, an absurd one is clamped.
        foreach (var query in new[] { "?page=abc", "?pageSize=abc", "?page=99999999999999", "?pageSize=1.5" })
            ((int)(await runner.GetAsync(Rows(run, query))).StatusCode).ShouldBe(400, query);
        foreach (var query in new[] { "?page=-5", "?page=0", "?page=2147483647", "?pageSize=-5", "?pageSize=0", "?pageSize=2147483647" })
            (await runner.GetAsync(Rows(run, query))).StatusCode.ShouldBe(HttpStatusCode.OK, query);

        // Ids that are not ids of a result.
        foreach (var path in new[] { "/api/v1/reports/runs/1/rows", "/api/v1/reports/runs/not-a-guid/rows", "/api/v1/reports/runs/00000000-0000-0000-0000-000000000000/export.csv" })
            new[] { 400, 404 }.ShouldContain((int)(await runner.GetAsync(path)).StatusCode, path);

        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.ReportRun WHERE Kind = 'Export'")).ShouldBe(0, "a refused export writes nothing");
        (await CountAsync(h.AppConnection, "SELECT COUNT(*) FROM dbo.AppUser")).ShouldBe(users);
        (await runner.GetAsync(Rows(run))).StatusCode.ShouldBe(HttpStatusCode.OK); // the result is still usable
    }

    [Fact]
    public async Task The_position_sort_gives_the_same_order_as_the_name_sort_for_the_rows_and_for_the_export()
    {
        await using var h = await StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var run = await RunOkAsync(runner, await h.AddReportAsync(Grid, roleIds: role));

        async Task<int[]> RowIds(string sort) => Ids(await ReadAsync(await runner.GetAsync(Rows(run, "?sort=" + Uri.EscapeDataString(sort)))));

        async Task<int[]> ExportIds(string sort) => (await DownloadCsvAsync(runner, Export(run, "?sort=" + Uri.EscapeDataString(sort)))).Skip(1).Select(r => int.Parse(r[0], System.Globalization.CultureInfo.InvariantCulture)).ToArray();

        foreach (var (position, name) in new[] { ("#0:asc", "id:asc"), ("#0:desc", "id:desc"), ("#1:asc", "name:asc"), ("#1:desc,#0:asc", "name:desc,id:asc"), ("#3:desc", "due:desc"), ("#00:DESC", "id:desc") })
        {
            (await RowIds(position)).ShouldBe(await RowIds(name), position);
            (await ExportIds(position)).ShouldBe(await RowIds(name), position);
        }

        // The column whose name holds a comma can only be sorted by position.
        (await RowIds("#2:desc")).ShouldBe([3, 1, 4, 2]); // nulls come first when descending
        (await ExportIds("#2:desc")).ShouldBe([3, 1, 4, 2]);
        (await runner.GetAsync(Rows(run, "?sort=" + Uri.EscapeDataString("Total, USD:desc")))).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
