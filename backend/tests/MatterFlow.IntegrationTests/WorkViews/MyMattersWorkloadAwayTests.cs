using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// GET /my-matters/workload, the epic #758 additions (PX-08, #766): the due-this-week count, the away window of the next four weeks (dates and a code, never the note),
/// people who are away but have no open work on these matters are not listed, and the optional split of a person's work by matter.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MyMattersWorkloadAwayTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    private async Task AwayAsync(HttpClient client, string from, string until, string note = "Private reason")
    {
        var own = await OkAsync(await client.GetAsync("/api/v1/me/availability"));
        await OkAsync(await client.PutAsJsonAsync("/api/v1/me/availability", new { status = "OUT_OF_OFFICE", from, until, note, rowVersion = own.GetProperty("rowVersion").GetString() }));
        H.Factory.InvalidateAll();
    }

    private Task<JsonElement> MakeForTechAsync(string title, int matterId, string? due) =>
        MakeAsync(title, matterId, new() { ["dueDate"] = due, ["assignedPodId"] = PodX, ["assignedUserId"] = Tech });

    private static JsonElement TechRow(JsonElement workload) =>
        workload.GetProperty("pods").EnumerateArray().SelectMany(p => p.GetProperty("people").EnumerateArray()).Single(p => p.GetProperty("userId").ValueKind == JsonValueKind.Number);

    [Fact]
    public async Task A_person_away_in_the_next_four_weeks_carries_the_window_and_both_facts_are_plain_data()
    {
        // The technician already holds m4-ok (a matter of A). Add an overdue task and three tasks with dates, then send them away for a week starting in ten days.
        await MakeForTechAsync("tech-overdue", M1, "2000-01-01");
        await MakeForTechAsync("tech-week-a", M1, In(3));
        await MakeForTechAsync("tech-week-b", M2, In(6));
        await MakeForTechAsync("tech-later", M2, In(9));
        await AwayAsync(TechClient, In(10), In(16));

        var tech = TechRow(await Mine("workload"));
        tech.GetProperty("open").GetInt32().ShouldBe(5);
        tech.GetProperty("overdue").GetInt32().ShouldBe(1);
        tech.GetProperty("dueThisWeek").GetInt32().ShouldBe(2); // in 3 and in 6 days; not the overdue one, not in 9 days, not the 2099 one
        var away = tech.GetProperty("away");
        away.GetProperty("from").GetString().ShouldBe(In(10));
        away.GetProperty("to").GetString().ShouldBe(In(16));
        away.GetProperty("reasonCode").GetString().ShouldBe("OUT_OF_OFFICE");
        away.EnumerateObject().Select(p => p.Name).Order().ShouldBe(["from", "reasonCode", "to"]); // no note
        tech.GetProperty("availability").ValueKind.ShouldBe(JsonValueKind.Null); // not away right now: the existing field is only for "now"

        // The free text of the profile never reaches this answer.
        (await A.GetStringAsync("/api/v1/my-matters/workload")).ShouldNotContain("Private reason");

        // The Task Queue link of the row still opens exactly the counted tasks (the two facts are side by side, nothing is judged).
        (await TotalAsync(A, "task-queue", tech.GetProperty("query").GetString()!)).ShouldBe(5);
    }

    [Fact]
    public async Task Away_outside_the_next_four_weeks_is_not_shown_and_an_open_ended_absence_is()
    {
        await AwayAsync(TechClient, In(40), In(50));
        TechRow(await Mine("workload")).GetProperty("away").ValueKind.ShouldBe(JsonValueKind.Null);

        await AwayAsync(TechClient, In(-3), In(28));
        var inside = TechRow(await Mine("workload"));
        inside.GetProperty("away").GetProperty("to").GetString().ShouldBe(In(28));
        inside.GetProperty("availability").GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE"); // away now as well

        // Ended yesterday: not away any more.
        await AwayAsync(TechClient, In(-10), In(-1));
        TechRow(await Mine("workload")).GetProperty("away").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task A_person_who_is_away_but_has_no_open_task_on_these_matters_is_not_listed()
    {
        await AwayAsync(Observer, In(2), In(9)); // holds no task on A's matters
        var w = await Mine("workload");
        w.GetProperty("pods").EnumerateArray().SelectMany(p => p.GetProperty("people").EnumerateArray()).Select(p => p.GetProperty("displayName").ValueKind == JsonValueKind.String ? p.GetProperty("displayName").GetString() : null)
            .ShouldAllBe(name => name == null || !name.Contains("observer", StringComparison.OrdinalIgnoreCase));
        (await A.GetStringAsync("/api/v1/my-matters/workload")).ShouldNotContain("Private reason");
    }

    [Fact]
    public async Task Include_matters_splits_a_persons_work_into_the_top_five_matters_and_the_rest()
    {
        // The technician works on seven matters of A: M4 (m4-ok) plus six new ones with 1 to 6 tasks each.
        for (var m = 1; m <= 6; m++)
        {
            var matterId = await H.CreateMatterAsync("350", (20 + m).ToString("00"));
            await H.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {PmA} WHERE MatterId = {matterId}");
            for (var i = 0; i < m; i++)
                await MakeForTechAsync($"split-{m}-{i}", matterId, null);
        }

        H.Factory.InvalidateAll();
        var plain = TechRow(await Mine("workload"));
        plain.GetProperty("matters").ValueKind.ShouldBe(JsonValueKind.Null); // not asked for

        var split = TechRow(await Mine("workload?include=matters")).GetProperty("matters");
        var top = split.GetProperty("top").EnumerateArray().ToList();
        top.Count.ShouldBe(5);
        top.Select(t => t.GetProperty("open").GetInt32()).ShouldBe([6, 5, 4, 3, 2]); // most open tasks first
        split.GetProperty("otherMatters").GetInt32().ShouldBe(2); // the matter with one task and M4
        split.GetProperty("otherOpen").GetInt32().ShouldBe(2);
        top.Sum(t => t.GetProperty("open").GetInt32()).ShouldBe(TechRow(await Mine("workload?include=matters")).GetProperty("open").GetInt32() - 2);
        foreach (var t in top)
            (await TotalAsync(A, "task-queue", t.GetProperty("query").GetString()!)).ShouldBe(t.GetProperty("open").GetInt32());

        await ProblemAsync(await A.GetAsync("/api/v1/my-matters/workload?include=everything"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }
}
