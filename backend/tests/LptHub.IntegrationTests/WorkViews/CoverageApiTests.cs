using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>GET /api/v1/dashboard/coverage (epic #68, issue #73, addendum Q): completed Tasks per person per task type in a period.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class CoverageApiTests(SqlServerFixture sql)
{
    private static readonly object Gate = new();
    private static Task<CoverageData>? _shared;

    private Task<CoverageData> DataAsync()
    {
        lock (Gate)
            return _shared ??= new CoverageData().BuildAsync(sql);
    }

    private static int CellOf(JsonElement board, int userId, int typeId) =>
        board.GetProperty("cells").EnumerateArray()
            .Where(c => c.GetProperty("userId").GetInt32() == userId && c.GetProperty("taskTypeId").GetInt32() == typeId)
            .Select(c => c.GetProperty("completed").GetInt32()).SingleOrDefault();

    private static JsonElement UserOf(JsonElement board, int userId) =>
        board.GetProperty("users").EnumerateArray().Single(u => u.GetProperty("userId").GetInt32() == userId);

    private static JsonElement TypeOf(JsonElement board, int typeId) =>
        board.GetProperty("taskTypes").EnumerateArray().Single(t => t.GetProperty("taskTypeId").GetInt32() == typeId);

    private static List<int> UserIds(JsonElement board) => [.. board.GetProperty("users").EnumerateArray().Select(u => u.GetProperty("userId").GetInt32())];

    [Fact]
    public async Task Counts_completed_tasks_per_person_and_type_in_the_default_30_days_and_ignore_cancelled_open_and_unassigned()
    {
        var d = await DataAsync();

        var board = await d.GetAsync("/api/v1/dashboard/coverage");

        board.GetProperty("days").GetInt32().ShouldBe(30);
        CellOf(board, d.TechA, d.Type1).ShouldBe(2); // the one completed 40 days ago is outside; the cancelled one never counts
        CellOf(board, d.TechA, d.Type2).ShouldBe(1);
        CellOf(board, d.TechB, d.Type1).ShouldBe(1);
        CellOf(board, d.TechB, d.Type2).ShouldBe(2);
        CellOf(board, d.TechC, d.Type3).ShouldBe(1);
        CellOf(board, d.TechB, d.Type3).ShouldBe(0); // an open Task of that type is not a completion
        UserOf(board, d.TechA).GetProperty("total").GetInt32().ShouldBe(3);
        UserOf(board, d.TechB).GetProperty("total").GetInt32().ShouldBe(3);
        TypeOf(board, d.Type1).GetProperty("total").GetInt32().ShouldBe(3);
        TypeOf(board, d.Type1).GetProperty("peopleWhoHandledIt").GetInt32().ShouldBe(2);
        TypeOf(board, d.Type3).GetProperty("peopleWhoHandledIt").GetInt32().ShouldBe(1);
        board.GetProperty("summary").GetProperty("typesWithFewerThanTwoPeople").GetInt32().ShouldBeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task Cells_are_sparse_and_a_type_nobody_completed_is_still_a_row()
    {
        var d = await DataAsync();

        var board = await d.GetAsync("/api/v1/dashboard/coverage");

        board.GetProperty("cells").EnumerateArray().ShouldAllBe(c => c.GetProperty("completed").GetInt32() > 0);
        var idle = TypeOf(board, d.TypeNobody);
        idle.GetProperty("total").GetInt32().ShouldBe(0);
        idle.GetProperty("peopleWhoHandledIt").GetInt32().ShouldBe(0);
        idle.GetProperty("name").GetString().ShouldBe("Coverage Nobody");
        idle.GetProperty("iconKey").GetString().ShouldNotBeNullOrEmpty();
        board.GetProperty("taskTypes").EnumerateArray().Select(t => t.GetProperty("name").GetString()!)
            .ShouldBe([.. board.GetProperty("taskTypes").EnumerateArray().Select(t => t.GetProperty("name").GetString()!).Order(StringComparer.CurrentCultureIgnoreCase)]);
    }

    [Fact]
    public async Task The_period_is_periodDays_or_an_explicit_range_in_the_viewers_zone()
    {
        var d = await DataAsync();

        var wide = await d.GetAsync("/api/v1/dashboard/coverage?periodDays=60");
        CellOf(wide, d.TechA, d.Type1).ShouldBe(3);
        var narrow = await d.GetAsync("/api/v1/dashboard/coverage?periodDays=2");
        CellOf(narrow, d.TechA, d.Type1).ShouldBe(1); // the period is today and yesterday: only the one completed a day ago
        narrow.GetProperty("days").GetInt32().ShouldBe(2);

        // Completed 2025-03-10 10:00 UTC: that is already March 11 in Kiritimati (UTC+14) and still March 9 in UTC-12.
        async Task<int> CountAsync(string zone, string day) =>
            CellOf(await d.GetAsync($"/api/v1/dashboard/coverage?from={day}&to={day}", timeZone: zone), d.TechD, d.Type1);
        (await CountAsync("UTC", "2025-03-10")).ShouldBe(1);
        (await CountAsync("UTC", "2025-03-09")).ShouldBe(0);
        (await CountAsync("Pacific/Kiritimati", "2025-03-11")).ShouldBe(1);
        (await CountAsync("Pacific/Kiritimati", "2025-03-10")).ShouldBe(0);
        (await CountAsync("Etc/GMT+12", "2025-03-09")).ShouldBe(1);
        (await CountAsync("Etc/GMT+12", "2025-03-10")).ShouldBe(0);
        var echoed = await d.GetAsync("/api/v1/dashboard/coverage?from=2025-03-01&to=2025-03-31", timeZone: "Pacific/Kiritimati");
        echoed.GetProperty("from").GetString().ShouldBe("2025-03-01");
        echoed.GetProperty("to").GetString().ShouldBe("2025-03-31");
        echoed.GetProperty("days").GetInt32().ShouldBe(31);
        echoed.GetProperty("timeZone").GetString().ShouldBe("Pacific/Kiritimati");
    }

    [Fact]
    public async Task Inactive_people_appear_only_with_completions_in_the_period_and_pending_people_never()
    {
        var d = await DataAsync();

        var board = await d.GetAsync("/api/v1/dashboard/coverage");
        UserIds(board).ShouldContain(d.TechC);
        UserOf(board, d.TechC).GetProperty("isActive").GetBoolean().ShouldBeFalse();
        UserOf(board, d.TechA).GetProperty("isActive").GetBoolean().ShouldBeTrue();
        UserIds(board).ShouldContain(d.TechD); // active, nothing completed in the period: a column of zeros
        UserOf(board, d.TechD).GetProperty("total").GetInt32().ShouldBe(0);
        UserIds(board).ShouldNotContain(d.Pending);
        UserIds(board).ShouldNotContain(d.InactiveQuiet);

        var without = await d.GetAsync("/api/v1/dashboard/coverage?includeInactive=false");
        UserIds(without).ShouldNotContain(d.TechC);
        UserIds(without).ShouldContain(d.TechA);
        CellOf(without, d.TechC, d.Type3).ShouldBe(0);
        TypeOf(without, d.Type3).GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task The_pod_filter_limits_the_people_and_the_totals()
    {
        var d = await DataAsync();

        var board = await d.GetAsync($"/api/v1/dashboard/coverage?podId={d.Pod}");

        UserIds(board).Order().ToList().ShouldBe(new[] { d.TechA, d.TechB }.Order().ToList());
        UserOf(board, d.TechA).GetProperty("pods").EnumerateArray().Single().GetProperty("name").GetString().ShouldBe("Coverage Pod");
        TypeOf(board, d.Type3).GetProperty("total").GetInt32().ShouldBe(0);
        TypeOf(board, d.Type1).GetProperty("total").GetInt32().ShouldBe(3);
    }

    private static async Task BadPeriodAsync(HttpResponseMessage response, string code)
    {
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).ShouldContain(code);
    }

    [Fact]
    public async Task Needs_Dashboard_ViewCoverage_and_validates_the_period()
    {
        var d = await DataAsync();

        (await d.NoCoverageClient.GetAsync("/api/v1/dashboard/coverage")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await d.CoverageClient.GetAsync("/api/v1/dashboard/coverage")).StatusCode.ShouldBe(HttpStatusCode.OK);

        await BadPeriodAsync(await d.H.Admin.GetAsync("/api/v1/dashboard/coverage?from=2025-03-01"), "PERIOD_INVALID");
        await BadPeriodAsync(await d.H.Admin.GetAsync("/api/v1/dashboard/coverage?from=2025-03-05&to=2025-03-01"), "PERIOD_INVALID");
        await BadPeriodAsync(await d.H.Admin.GetAsync("/api/v1/dashboard/coverage?from=2024-01-01&to=2025-03-01"), "PERIOD_TOO_LONG");
        (await d.H.Admin.GetAsync("/api/v1/dashboard/coverage?periodDays=0")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await d.H.Admin.GetAsync("/api/v1/dashboard/coverage?bogus=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
