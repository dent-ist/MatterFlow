using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.WorkViews.QueueData;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The column filters of the work lists (epic "inline column filters", batch 3): Matter, Client and Project text, and the Updated range on the Task Queue,
/// My Work and Pod Work. Each box is a parameterised, case-insensitive "contains" with % _ [ matched literally, combined with the others by AND, and the tab
/// counts of My Work and Pod Work stay what the existing design says: every count is worked out under the same filters, whichever tab is open.
/// Seed: the main Matter is 00343-00012 "Merger Review 12" of client 00343 "Acme Corp 343" with the project "Phase 1"; the second is 00500-00007 "Merger Review 7"
/// of client 00500 "Acme Corp 500" and holds the one task "other-matter".
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskQueueColumnFilterTests(SqlServerFixture sql)
{
    private Task<QueueData> DataAsync() => QueueData.GetAsync(sql);

    private static string[] Of(params string[] titles) => titles;

    private static async Task<List<string>> SeededAsync(QueueData d, string query) => d.Seeded(await d.QueueAsync(query));

    private static async Task<List<string>> AllSeededAsync(QueueData d) => d.Seeded(await d.QueueAsync());

    // ---- Matter text

    [Theory]
    [InlineData("343-12")]
    [InlineData("00343-00012")]
    [InlineData("00343")]
    [InlineData("MERGER REVIEW 12")]
    [InlineData("review 12")]
    public async Task Matter_text_finds_the_matter_by_reference_pair_or_name_in_any_case(string text)
    {
        var d = await DataAsync();
        var all = await AllSeededAsync(d);
        var found = await SeededAsync(d, "matterText=" + Uri.EscapeDataString(text));

        found.ShouldNotContain("other-matter");
        found.ShouldBeSet([.. all.Where(t => t != "other-matter")]);
    }

    [Theory]
    [InlineData("500-7")]
    [InlineData("00500-00007")]
    [InlineData("merger review 7")]
    [InlineData("0050")]
    public async Task Matter_text_finds_the_other_matter(string text)
    {
        var d = await DataAsync();
        (await SeededAsync(d, "matterText=" + Uri.EscapeDataString(text))).ShouldBe(Of("other-matter"));
    }

    [Theory]
    [InlineData("%")]
    [InlineData("_")]
    [InlineData("[")]
    [InlineData("[0-9]")]
    [InlineData("Merger Review _")]
    [InlineData("00343-%")]
    public async Task Matter_text_treats_like_wildcards_as_plain_characters(string text)
    {
        var d = await DataAsync();
        (await SeededAsync(d, "matterText=" + Uri.EscapeDataString(text))).ShouldBeEmpty();
    }

    [Fact]
    public async Task Matter_text_is_a_parameter_not_sql()
    {
        var d = await DataAsync();
        (await SeededAsync(d, "matterText=" + Uri.EscapeDataString("' OR 1=1 --"))).ShouldBeEmpty();
    }

    [Fact]
    public async Task Matter_text_combines_with_the_matter_id_and_the_other_filters_as_and()
    {
        var d = await DataAsync();
        (await SeededAsync(d, $"matterText=343&matter={d.Matter2Id}")).ShouldBeEmpty();
        (await SeededAsync(d, $"matterText=500&matter={d.Matter2Id}")).ShouldBe(Of("other-matter"));
        (await SeededAsync(d, $"matterText=343&priority={d.Critical}")).ShouldBeSet(["crit-future", "crit-asap-old", "crit-overdue", "crit-asap-new"]);
    }

    // ---- Client text

    [Theory]
    [InlineData("acme corp 343")]
    [InlineData("ACME")]
    [InlineData("343")]
    [InlineData("00343")]
    public async Task Client_text_finds_tasks_by_client_name_or_the_digits_of_the_client_number(string text)
    {
        var d = await DataAsync();
        var found = await SeededAsync(d, "clientText=" + Uri.EscapeDataString(text));
        if (text.Equals("ACME", StringComparison.OrdinalIgnoreCase))
        {
            found.ShouldBeSet([.. await AllSeededAsync(d)]); // both clients are called Acme
        }
        else
        {
            found.ShouldNotContain("other-matter");
            found.ShouldBeSet([.. (await AllSeededAsync(d)).Where(t => t != "other-matter")]);
        }
    }

    [Theory]
    [InlineData("acme corp 500")]
    [InlineData("500")]
    [InlineData("00500")]
    public async Task Client_text_finds_the_other_client(string text)
    {
        var d = await DataAsync();
        (await SeededAsync(d, "clientText=" + Uri.EscapeDataString(text))).ShouldBe(Of("other-matter"));
    }

    [Theory]
    [InlineData("%")]
    [InlineData("_")]
    [InlineData("Acme%343")]
    [InlineData("5_0")]
    [InlineData("[0-9]")]
    public async Task Client_text_treats_like_wildcards_as_plain_characters(string text)
    {
        var d = await DataAsync();
        (await SeededAsync(d, "clientText=" + Uri.EscapeDataString(text))).ShouldBeEmpty();
    }

    // ---- Project text

    [Fact]
    public async Task Project_text_finds_tasks_of_the_project_and_never_those_without_one()
    {
        var d = await DataAsync();
        (await SeededAsync(d, "projectText=phase")).ShouldBe(Of("with-project"));
        (await SeededAsync(d, "projectText=PHASE%201")).ShouldBe(Of("with-project")); // any case, a space is a space
        (await SeededAsync(d, "projectText=Phase%25")).ShouldBeEmpty(); // a literal percent sign
        (await SeededAsync(d, "projectText=_hase")).ShouldBeEmpty();
        (await SeededAsync(d, "projectText=nothing")).ShouldBeEmpty();
        (await SeededAsync(d, $"projectText=phase&project={d.W.ProjectId}")).ShouldBe(Of("with-project"));
        (await SeededAsync(d, "projectText=phase&priority=" + d.Critical)).ShouldBeEmpty();
    }

    // ---- Updated

    /// <summary>
    /// The host clock is fixed (<see cref="DatabaseApiFactory.Clock"/>) at 03:30 UTC on 14 October 2026, which is 23:30 on the 13th in New York and 17:30 on the 14th in
    /// Kiritimati, so the days asked for do not depend on the time the suite runs at (the shared seed uses the real clock, and "today" there moves with it).
    /// </summary>
    [Fact]
    public async Task Updated_range_keeps_the_tasks_updated_in_it_and_never_those_never_updated()
    {
        var now = new DateTime(2026, 10, 14, 3, 30, 0, DateTimeKind.Utc);
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(now) };
        var h = new Tasks.TaskHarness(factory);
        var world = await h.CreateWorldAsync();
        var untouched = await h.CreateTaskAsync(world, extra: new() { ["title"] = "never-updated" });
        var held = await h.CreateTaskAsync(world, extra: new() { ["title"] = "updated-hold" });
        await h.StatusAsync(held, "ON_HOLD", "Waiting for the client");

        async Task<List<string>> TitlesAsync(string query, string zone = "America/New_York")
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/task-queue?pageSize=100&status=NEW&status=ON_HOLD" + (query.Length > 0 ? "&" + query : string.Empty));
            request.Headers.Add("X-Time-Zone", zone);
            return TitlesOf(await Tasks.TaskHarness.OkAsync(await h.Admin.SendAsync(request)));
        }

        (await TitlesAsync("")).ShouldBeSet(["never-updated", "updated-hold"]);
        (await TitlesAsync("updatedFrom=2000-01-01")).ShouldBeSet(["updated-hold"]);
        (await TitlesAsync("updatedTo=1999-12-31")).ShouldBeEmpty();
        (await TitlesAsync("updatedFrom=2099-01-01")).ShouldBeEmpty();

        // New York: the update happened on the 13th. Kiritimati: on the 14th.
        (await TitlesAsync("updatedFrom=2026-10-13&updatedTo=2026-10-13")).ShouldBeSet(["updated-hold"]);
        (await TitlesAsync("updatedFrom=2026-10-14")).ShouldBeEmpty();
        (await TitlesAsync("updatedTo=2026-10-12")).ShouldBeEmpty();
        (await TitlesAsync("updatedFrom=2026-10-14&updatedTo=2026-10-14", "Pacific/Kiritimati")).ShouldBeSet(["updated-hold"]);
        (await TitlesAsync("updatedTo=2026-10-13", "Pacific/Kiritimati")).ShouldBeEmpty();
        _ = untouched;
    }

    [Fact]
    public async Task Updated_dates_are_validated_like_the_other_dates()
    {
        var d = await DataAsync();
        var response = await d.H.Admin.GetAsync("/api/v1/task-queue?updatedFrom=yesterday");
        ((int)response.StatusCode).ShouldBe(400);
    }

    // ---- My Work: counts

    private static int[] CountsOf(JsonElement page)
    {
        var c = page.GetProperty("counts");
        return [c.GetProperty("active").GetInt32(), c.GetProperty("dueSoon").GetInt32(), c.GetProperty("completed").GetInt32(), c.GetProperty("createdByMe").GetInt32()];
    }

    [Theory]
    [InlineData("matterText=343")]
    [InlineData("matterText=500")]
    [InlineData("clientText=acme")]
    [InlineData("clientText=500")]
    [InlineData("projectText=phase")]
    [InlineData("updatedFrom=2000-01-01")]
    [InlineData("matterText=343&clientText=343&updatedFrom=2000-01-01")]
    public async Task My_work_counts_are_the_same_on_every_tab_for_the_new_filters(string filters)
    {
        var d = await DataAsync();
        var window = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-90)).ToString("yyyy-MM-dd");
        var onActive = CountsOf(await d.GetAsync($"/api/v1/my-work?pageSize=100&{filters}", d.TechAClient));
        foreach (var view in new[] { "active", "dueSoon", "completed", "createdByMe" })
        {
            // The web app asks the Completed tab with its 90-day window on top; that window belongs to the Completed tab only.
            var extra = view == "completed" ? $"&completedFrom={window}" : string.Empty;
            var onTab = await d.GetAsync($"/api/v1/my-work?pageSize=100&view={view}&{filters}{extra}", d.TechAClient);
            CountsOf(onTab).ShouldBe(onActive, $"{view}: {filters}");
        }
    }

    [Fact]
    public async Task My_work_counts_follow_the_new_filters_like_every_other_filter()
    {
        var d = await DataAsync();
        var unfiltered = CountsOf(await d.GetAsync("/api/v1/my-work?pageSize=100", d.TechAClient));
        unfiltered.ShouldBe([7, 2, 2, 2]);

        // Everything of tech A lives in the main Matter: a filter that matches it all changes no count, one that matches nothing zeroes them all.
        CountsOf(await d.GetAsync("/api/v1/my-work?pageSize=100&matterText=343-12", d.TechAClient)).ShouldBe(unfiltered);
        CountsOf(await d.GetAsync("/api/v1/my-work?pageSize=100&clientText=acme%20corp%20343", d.TechAClient)).ShouldBe(unfiltered);
        CountsOf(await d.GetAsync("/api/v1/my-work?pageSize=100&matterText=00500", d.TechAClient)).ShouldBe([0, 0, 0, 0]);
        CountsOf(await d.GetAsync("/api/v1/my-work?pageSize=100&projectText=phase", d.TechAClient)).ShouldBe([0, 0, 0, 0]);

        // And the rows of the tab are the ones the count says.
        var active = await d.GetAsync("/api/v1/my-work?pageSize=100&matterText=343", d.TechAClient);
        active.GetProperty("total").GetInt32().ShouldBe(7);
        active.GetProperty("items").GetArrayLength().ShouldBe(7);
        var none = await d.GetAsync("/api/v1/my-work?pageSize=100&matterText=nowhere", d.TechAClient);
        none.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task The_completed_tabs_closed_date_window_still_does_not_change_the_other_counts_when_a_column_filter_is_set()
    {
        var d = await DataAsync();
        var onActive = CountsOf(await d.GetAsync("/api/v1/my-work?pageSize=100&matterText=343", d.TechAClient));
        foreach (var completed in new[] { "completedFrom=2000-01-01", "completedFrom=2099-01-01", "completedTo=1999-12-31" })
        {
            var counts = CountsOf(await d.GetAsync($"/api/v1/my-work?pageSize=100&view=completed&matterText=343&{completed}", d.TechAClient));
            counts[0].ShouldBe(onActive[0], completed);
            counts[1].ShouldBe(onActive[1], completed);
            counts[3].ShouldBe(onActive[3], completed);
        }
    }

    // ---- Pod Work: counts

    private static int[] PodCountsOf(JsonElement page)
    {
        var c = page.GetProperty("counts");
        return [c.GetProperty("queue").GetInt32(), c.GetProperty("members").GetInt32(), c.GetProperty("attention").GetInt32(), c.GetProperty("all").GetInt32()];
    }

    [Theory]
    [InlineData("matterText=343")]
    [InlineData("matterText=500")]
    [InlineData("clientText=acme")]
    [InlineData("projectText=phase")]
    [InlineData("updatedFrom=2000-01-01")]
    public async Task Pod_work_counts_are_the_same_on_every_tab_for_the_new_filters(string filters)
    {
        var d = await DataAsync();
        var onQueue = PodCountsOf(await d.GetAsync($"/api/v1/pod-work?pageSize=100&podId={d.PodA}&{filters}", d.TechAClient));
        foreach (var view in new[] { "queue", "members", "attention", "all" })
        {
            var onTab = await d.GetAsync($"/api/v1/pod-work?pageSize=100&podId={d.PodA}&view={view}&{filters}", d.TechAClient);
            PodCountsOf(onTab).ShouldBe(onQueue, $"{view}: {filters}");
        }
    }

    [Fact]
    public async Task Pod_work_applies_the_new_filters_to_the_rows_and_the_counts_but_not_to_the_pod_summary()
    {
        var d = await DataAsync();
        var plain = await d.GetAsync($"/api/v1/pod-work?pageSize=100&podId={d.PodA}", d.TechAClient);
        var matching = await d.GetAsync($"/api/v1/pod-work?pageSize=100&podId={d.PodA}&matterText=343-12", d.TechAClient);
        var nothing = await d.GetAsync($"/api/v1/pod-work?pageSize=100&podId={d.PodA}&matterText=00500", d.TechAClient);

        PodCountsOf(matching).ShouldBe(PodCountsOf(plain));
        PodCountsOf(nothing).ShouldBe([0, 0, 0, 0]);
        TitlesOf(nothing).ShouldBeEmpty();
        // The summary above the tabs is the Pod's own workload, not a result of the filters.
        nothing.GetProperty("summary").GetRawText().ShouldBe(plain.GetProperty("summary").GetRawText());
    }

    [Fact]
    public async Task Pod_work_and_my_work_accept_the_new_parameters_and_still_reject_unknown_ones()
    {
        var d = await DataAsync();
        foreach (var url in new[]
                 {
                     "/api/v1/my-work?matterText=a&clientText=b&projectText=c&updatedFrom=2026-01-01&updatedTo=2026-12-31",
                     $"/api/v1/pod-work?podId={d.PodA}&matterText=a&clientText=b&projectText=c&updatedFrom=2026-01-01&updatedTo=2026-12-31",
                     "/api/v1/task-queue?matterText=a&clientText=b&projectText=c&updatedFrom=2026-01-01&updatedTo=2026-12-31",
                 })
        {
            ((int)(await d.TechAClient.GetAsync(url)).StatusCode).ShouldBe(200, url);
        }

        ((int)(await d.TechAClient.GetAsync("/api/v1/task-queue?matterTxt=a")).StatusCode).ShouldBe(400);
        ((int)(await d.TechAClient.GetAsync("/api/v1/task-queue?matterText=" + new string('x', 201))).StatusCode).ShouldBe(400);
    }
}
