using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;

namespace LptHub.IntegrationTests.Reports;

/// <summary>Date-time columns: the SQL type decides whether the value is an instant (UTC with Z, shown in the person's zone) or a wall-clock value (as stored).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportDateTimeApiTests(SqlServerFixture sql)
{
    private const string Query =
        "SELECT CAST('2026-03-31T14:05:00+02:00' AS datetimeoffset) AS at_instant, CAST('2026-03-31T14:05:00' AS datetime2) AS at_wall, CAST('2026-03-31T14:05:00' AS datetime) AS at_old, CAST('2026-03-31T14:05:00' AS smalldatetime) AS at_small, CAST('2026-03-31' AS date) AS on_day, N'x' AS txt";

    [Fact]
    public async Task Only_a_datetimeoffset_column_is_an_instant_and_its_value_comes_in_utc_with_a_z()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var report = await h.AddReportAsync(Query, roleIds: role);

        var run = await runner.PostAsync($"/api/v1/reports/{report}/runs", ReportTestHarness.Parameters(new { }));
        run.StatusCode.ShouldBe(HttpStatusCode.OK);
        var runBody = await run.Content.ReadFromJsonAsync<JsonElement>();
        var flags = runBody.GetProperty("columns").EnumerateArray().ToDictionary(c => c.GetProperty("name").GetString()!, c => (c.GetProperty("type").GetString()!, c.GetProperty("isInstant").GetBoolean()));
        flags["at_instant"].ShouldBe(("dateTime", true));
        flags["at_wall"].ShouldBe(("dateTime", false));
        flags["at_old"].ShouldBe(("dateTime", false));
        flags["at_small"].ShouldBe(("dateTime", false));
        flags["on_day"].ShouldBe(("date", false));
        flags["txt"].ShouldBe(("text", false));

        var rows = await (await runner.GetAsync($"/api/v1/reports/runs/{runBody.GetProperty("runId").GetString()}/rows")).Content.ReadFromJsonAsync<JsonElement>();
        rows.GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("isInstant").GetBoolean()).ShouldBe([true, false, false, false, false, false]);
        var row = rows.GetProperty("rows")[0];
        row[0].GetString().ShouldBe("2026-03-31T12:05:00Z");
        row[1].GetString().ShouldBe("2026-03-31T14:05:00");
        row[2].GetString().ShouldBe("2026-03-31T14:05:00");
        row[3].GetString().ShouldBe("2026-03-31T14:05:00");
        row[4].GetString().ShouldBe("2026-03-31");
    }
}
