using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// Dashboard v4 (issue #1064): the <c>unassignedGauge</c> block of GET /dashboard (working-minute age, level, basis), who gets it, the settings API behind it, and the sensitive-matter rule
/// (hidden tasks are neither counted nor do they set the oldest time).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class DashboardUnassignedGaugeTests(SqlServerFixture sql) : IAsyncLifetime
{
    // Friday 2026-10-09 5:55 PM in New York; the read happens Monday 2026-10-12 8:05 AM.
    private static readonly DateTime Friday = new(2026, 10, 9, 21, 55, 0, DateTimeKind.Utc);
    private static readonly DateTime Monday = new(2026, 10, 12, 12, 5, 0, DateTimeKind.Utc);

    private MutableClock _clock = null!;
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;

    public async Task InitializeAsync()
    {
        _clock = new MutableClock(Friday);
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = _clock };
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<JsonElement> GaugeAsync(HttpClient? client = null)
    {
        var summary = await OkAsync(await (client ?? _h.Admin).GetAsync("/api/v1/dashboard?fresh=true"));
        return summary.GetProperty("unassignedGauge");
    }

    private async Task<JsonElement> SettingsAsync() => await OkAsync(await _h.Admin.GetAsync("/api/v1/admin/settings/dashboard"));

    private static object Gauge(string basis = "WORKING", string start = "08:00", string end = "18:00", int[]? days = null) =>
        new { workdayStart = start, workdayEnd = end, workDays = days ?? [1, 2, 3, 4, 5], ageBasis = basis, levelHours = new[] { 1, 2, 3, 4, 5 }, tasksPerLevel = 5, countBonusMax = 2 };

    [Fact]
    public async Task All_clear_when_nothing_is_unassigned()
    {
        var gauge = await GaugeAsync();
        gauge.GetProperty("count").GetInt32().ShouldBe(0);
        gauge.GetProperty("oldestSinceUtc").ValueKind.ShouldBe(JsonValueKind.Null);
        gauge.GetProperty("oldestAgeMinutes").GetInt32().ShouldBe(0);
        gauge.GetProperty("level").GetInt32().ShouldBe(0);
        gauge.GetProperty("ageBasis").GetString().ShouldBe("WORKING");
    }

    [Fact]
    public async Task A_task_created_at_555_pm_on_Friday_is_ten_working_minutes_old_on_Monday_at_805_am_and_the_basis_can_change()
    {
        await _h.CreateTaskAsync(_w);
        _clock.UtcNow = Monday;

        var gauge = await GaugeAsync();
        gauge.GetProperty("count").GetInt32().ShouldBe(1);
        gauge.GetProperty("oldestSinceUtc").GetDateTime().ShouldBe(Friday);
        gauge.GetProperty("oldestAgeMinutes").GetInt32().ShouldBe(10);
        gauge.GetProperty("level").GetInt32().ShouldBe(0);
        gauge.GetProperty("asOfUtc").GetDateTime().ShouldBe(Monday);

        // Clock hours: every minute of the weekend counts (62 h 10 min), which is the top level.
        var settings = await SettingsAsync();
        await OkAsync(await _h.Admin.PutAsJsonAsync("/api/v1/admin/settings/dashboard", new { gauge = Gauge("CLOCK"), rowVersion = settings.GetProperty("rowVersion").GetString() }));
        var clock = await GaugeAsync();
        clock.GetProperty("ageBasis").GetString().ShouldBe("CLOCK");
        clock.GetProperty("oldestAgeMinutes").GetInt32().ShouldBe((int)(Monday - Friday).TotalMinutes);
        clock.GetProperty("level").GetInt32().ShouldBe(5);
    }

    [Fact]
    public async Task The_oldest_time_follows_an_unassign_and_a_reassign()
    {
        var older = TaskId(await _h.CreateTaskAsync(_w));
        _clock.UtcNow = Friday.AddHours(1);
        var newer = TaskId(await _h.CreateTaskAsync(_w));
        (await GaugeAsync()).GetProperty("oldestSinceUtc").GetDateTime().ShouldBe(Friday);

        // The older task gets an assignee: the other one is now the oldest.
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        await _h.PostAsync(older, "assignment", new { userId = admin, rowVersion = RowVersion(await _h.GetTaskAsync(older)) });
        var gauge = await GaugeAsync();
        gauge.GetProperty("count").GetInt32().ShouldBe(1);
        gauge.GetProperty("oldestSinceUtc").GetDateTime().ShouldBe(Friday.AddHours(1));

        // Unassigning it again restarts ITS clock at the unassign time, so the other one stays the oldest.
        _clock.UtcNow = Friday.AddHours(2);
        await _h.PostAsync(older, "assignment", new { rowVersion = RowVersion(await _h.GetTaskAsync(older)) });
        gauge = await GaugeAsync();
        gauge.GetProperty("count").GetInt32().ShouldBe(2);
        gauge.GetProperty("oldestSinceUtc").GetDateTime().ShouldBe(Friday.AddHours(1));
        newer.ShouldNotBe(older);
    }

    [Fact]
    public async Task The_level_combines_age_and_count_and_the_block_is_only_for_the_Summary_tab()
    {
        for (var i = 0; i < 10; i++)
            await _h.CreateTaskAsync(_w);

        // Three working hours old (Friday 5:55 PM is only 5 minutes of Friday, so read on Monday at 11:00 AM New York = 3 h 5 min) plus 10 tasks = 2 + 3 capped... age level 3, count bonus 2, total 5.
        _clock.UtcNow = new DateTime(2026, 10, 12, 15, 0, 0, DateTimeKind.Utc);
        var gauge = await GaugeAsync();
        gauge.GetProperty("count").GetInt32().ShouldBe(10);
        gauge.GetProperty("oldestAgeMinutes").GetInt32().ShouldBe(185);
        gauge.GetProperty("level").GetInt32().ShouldBe(5);

        // A Technician (Dashboard.View + ViewUnassigned) gets the count as before and no gauge block.
        var technician = await _h.UserWithAsync(@"KE\tech", "Task.View", "Dashboard.View", "Dashboard.ViewUnassigned");
        var summary = await OkAsync(await technician.GetAsync("/api/v1/dashboard?fresh=true"));
        summary.GetProperty("unassigned").GetProperty("count").GetInt32().ShouldBe(10);
        summary.GetProperty("unassignedGauge").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task The_count_follows_the_pod_scope_like_the_Unassigned_card()
    {
        var admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        var pod = await _h.CreatePodAsync("Gauge pod", admin);
        await _h.CreateTaskAsync(_w, extra: new() { ["assignedPodId"] = pod });
        await _h.CreateTaskAsync(_w);
        _clock.UtcNow = Monday;

        var all = await OkAsync(await _h.Admin.GetAsync("/api/v1/dashboard?fresh=true"));
        all.GetProperty("unassignedGauge").GetProperty("count").GetInt32().ShouldBe(all.GetProperty("unassigned").GetProperty("count").GetInt32());
        all.GetProperty("unassignedGauge").GetProperty("count").GetInt32().ShouldBe(2);

        var scoped = await OkAsync(await _h.Admin.GetAsync($"/api/v1/dashboard?fresh=true&podScope={pod}"));
        scoped.GetProperty("unassignedGauge").GetProperty("count").GetInt32().ShouldBe(1);
        scoped.GetProperty("unassigned").GetProperty("count").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task The_settings_api_validates_saves_audits_and_resets_and_needs_Settings_Manage()
    {
        var view = await SettingsAsync();
        view.GetProperty("isCustom").GetBoolean().ShouldBeFalse();
        view.GetProperty("rowVersion").GetString().ShouldBe(string.Empty);
        view.GetProperty("gauge").GetProperty("workdayStart").GetString().ShouldBe("08:00");
        view.GetProperty("gauge").GetProperty("workdayEnd").GetString().ShouldBe("18:00");
        view.GetProperty("gauge").GetProperty("workDays").EnumerateArray().Select(d => d.GetInt32()).ShouldBe([1, 2, 3, 4, 5]);
        view.GetProperty("gauge").GetProperty("ageBasis").GetString().ShouldBe("WORKING");
        view.GetProperty("timeZoneId").GetString().ShouldBe("America/New_York");

        // Start after end and no weekday are refused.
        (await _h.Admin.PutAsJsonAsync("/api/v1/admin/settings/dashboard", new { gauge = Gauge(start: "18:00", end: "08:00"), rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _h.Admin.PutAsJsonAsync("/api/v1/admin/settings/dashboard", new { gauge = Gauge(days: []), rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var saved = await OkAsync(await _h.Admin.PutAsJsonAsync("/api/v1/admin/settings/dashboard", new { gauge = Gauge(start: "07:00", end: "19:00", days: [1, 2, 3, 4, 5, 6]), rowVersion = "" }));
        saved.GetProperty("isCustom").GetBoolean().ShouldBeTrue();
        saved.GetProperty("gauge").GetProperty("workdayStart").GetString().ShouldBe("07:00");
        var version = saved.GetProperty("rowVersion").GetString()!;

        // A stale version is a conflict.
        (await _h.Admin.PutAsJsonAsync("/api/v1/admin/settings/dashboard", new { gauge = Gauge(), rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // The saved hours are used: Saturday is a working day now, so Friday 5:55 PM to Saturday 8:05 AM... Friday 17:55 to 19:00 is 65 minutes, Saturday 7:00 to 8:05 is 65.
        await _h.CreateTaskAsync(_w);
        _clock.UtcNow = new DateTime(2026, 10, 10, 12, 5, 0, DateTimeKind.Utc);
        (await GaugeAsync()).GetProperty("oldestAgeMinutes").GetInt32().ShouldBe(65 + 65);

        var audit = await _h.AuditAsync("SETTINGS_DASHBOARD_GAUGE_CHANGED");
        audit.Count.ShouldBe(1);

        var reset = await OkAsync(await _h.Admin.DeleteAsync($"/api/v1/admin/settings/dashboard?rowVersion={Uri.EscapeDataString(version)}"));
        reset.GetProperty("isCustom").GetBoolean().ShouldBeFalse();
        reset.GetProperty("gauge").GetProperty("workdayStart").GetString().ShouldBe("08:00");

        var user = await _h.UserWithAsync(@"KE\viewer", "Task.View", "Dashboard.View", "Dashboard.ViewSummary");
        (await user.GetAsync("/api/v1/admin/settings/dashboard")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await user.PutAsJsonAsync("/api/v1/admin/settings/dashboard", new { gauge = Gauge(), rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_hidden_sensitive_task_is_neither_counted_nor_sets_the_oldest_time()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // TN1 (normal), TS1 and TS2 (sensitive) are unassigned; TS3 is assigned. Make the sensitive ones much older.
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET UnassignedAt = '2020-01-01T10:00:00' WHERE TaskId IN ({u.TS1}, {u.TS2})");
            u.H.Factory.InvalidateAll();

            var unrelated = await OkAsync(await u.UnrelatedClient.GetAsync("/api/v1/dashboard?fresh=true"));
            var hidden = unrelated.GetProperty("unassignedGauge");
            hidden.GetProperty("count").GetInt32().ShouldBe(1);
            hidden.GetProperty("count").GetInt32().ShouldBe(unrelated.GetProperty("unassigned").GetProperty("count").GetInt32());
            hidden.GetProperty("oldestSinceUtc").GetDateTime().Year.ShouldBeGreaterThan(2020);
            unrelated.GetRawText().ShouldNotContain(SensitiveUniverse.SentinelPrefix);

            var viewer = await OkAsync(await u.ViewerClient.GetAsync("/api/v1/dashboard?fresh=true"));
            viewer.GetProperty("unassignedGauge").GetProperty("count").GetInt32().ShouldBe(3);
            viewer.GetProperty("unassignedGauge").GetProperty("oldestSinceUtc").GetDateTime().Year.ShouldBe(2020);

            // The grid's column and the gauge agree for the viewer, and the unrelated user's queue never names a hidden task.
            var queue = await OkAsync(await u.UnrelatedClient.GetAsync("/api/v1/task-queue?pageSize=100&unassigned=true&sort=unassignedSince"));
            queue.GetProperty("total").GetInt32().ShouldBe(1);
            queue.GetRawText().ShouldNotContain(SensitiveUniverse.SentinelPrefix);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
