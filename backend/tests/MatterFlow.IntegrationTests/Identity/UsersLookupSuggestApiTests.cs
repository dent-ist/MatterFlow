using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Organization;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>
/// The assignee lookup with load, Pod and suggestions (#757): open counts (New, In Progress, On Hold), the ranking order, out of office people left
/// out of Suggested but present in search, Pod members ranked, Access Pending and inactive users never offered, Task.Assign required, and a
/// constant number of statements whatever the number of users.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class UsersLookupSuggestApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly DateTime Now = new(2026, 10, 14, 16, 0, 0, DateTimeKind.Utc);

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private TaskHarness.World _world = null!;
    private int _admin;
    private int _busy;
    private int _quiet;
    private int _quietOlder;
    private int _away;
    private int _closedOnly;
    private int _inactive;
    private int _pending;
    private int _roleId;
    private int _pod;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = new Audit.FixedClock(Now) };
        _h = new TaskHarness(_factory);
        _world = await _h.CreateWorldAsync();
        _admin = await _h.UserIdAsync(DatabaseApiFactory.AdminAccount);
        _roleId = await _factory.CreateRoleAsync("Lookup members", "Task.View");
        _busy = await NewUserAsync(@"KE\busy");
        _quiet = await NewUserAsync(@"KE\quiet");
        _quietOlder = await NewUserAsync(@"KE\quietolder");
        _away = await NewUserAsync(@"KE\away");
        _closedOnly = await NewUserAsync(@"KE\closedonly");
        _inactive = await NewUserAsync(@"KE\inactive");
        _pending = await _h.UserIdAsync(@"KE\pending"); // no role: Access Pending

        var rows = new List<CountsSeed.Row>();
        void Add(string status, int count)
        {
            for (var i = 0; i < count; i++)
                rows.Add(new CountsSeed.Row(_world.MatterId, null, status, new DateOnly(2026, 10, 14).AddDays(i)));
        }

        Add("NEW", 4);
        Add("IN_PROGRESS", 1);
        Add("ON_HOLD", 1);
        Add("COMPLETED", 2);
        Add("CANCELLED", 1);
        await CountsSeed.InsertTasksAsync(_h, _world, _admin, rows, Now);

        // busy: 4 open (New, New, In Progress, On Hold) plus a Completed and a Cancelled one that do not count.
        await AssignAsync(_busy, "NEW", 2, daysAgo: 1);
        await AssignAsync(_busy, "IN_PROGRESS", 1, daysAgo: 2);
        await AssignAsync(_busy, "ON_HOLD", 1, daysAgo: 3);
        await AssignAsync(_busy, "COMPLETED", 1, daysAgo: 10);
        await AssignAsync(_busy, "CANCELLED", 1, daysAgo: 10);
        // quiet / quietolder: one open Task each, assigned 1 day and 9 days ago.
        await AssignAsync(_quiet, "NEW", 1, daysAgo: 1);
        await AssignAsync(_quietOlder, "NEW", 1, daysAgo: 9);
        // closedonly: only a Completed Task, so zero open.
        await AssignAsync(_closedOnly, "COMPLETED", 1, daysAgo: 5);
        // away: no tasks and out of office.
        var away = _h.As(@"KE\away");
        var saved = await OkAsync(await away.PutAsJsonAsync("/api/v1/me/availability", new { status = "OUT_OF_OFFICE", until = "2099-10-20", note = "Vacation", rowVersion = "NEW" }));
        saved.GetProperty("status").GetString().ShouldBe("OUT_OF_OFFICE");

        _pod = await _h.CreatePodAsync("Review pod", _busy, _quiet, _away, _inactive);
        await _h.ExecuteAsync($"UPDATE dbo.AppUser SET IsActive = 0 WHERE UserId = {_inactive}");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<int> NewUserAsync(string account)
    {
        var id = await _h.UserIdAsync(account);
        await _factory.GrantRoleAsync(account, _roleId);
        return id;
    }

    private async Task AssignAsync(int user, string status, int count, int daysAgo)
    {
        var at = Now.AddDays(-daysAgo).ToString("yyyy-MM-ddTHH:mm:ss.fff", System.Globalization.CultureInfo.InvariantCulture);
        await _h.ExecuteAsync($"UPDATE TOP ({count}) dbo.Task SET AssignedUserId = {user}, AssignedAt = '{at}' WHERE AssignedUserId IS NULL AND StatusCode = '{status}'");
    }

    private static int[] Ids(JsonElement list) => list.EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ToArray();

    private static JsonElement Item(JsonElement list, int id) => list.EnumerateArray().Single(u => u.GetProperty("userId").GetInt32() == id);

    [Fact]
    public async Task Suggested_ranks_by_open_count_then_least_recently_assigned_and_leaves_out_unavailable_inactive_and_pending_people()
    {
        var list = await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?suggest=true&limit=8"));
        var ids = Ids(list);

        // 0 open: closedonly, then 1 open: quietolder (9 days ago) before quiet (1 day ago), then busy (4 open). The admin and the SQL-seeded users are not in play.
        ids.Where(i => new[] { _closedOnly, _quietOlder, _quiet, _busy }.Contains(i)).ToArray().ShouldBe([_closedOnly, _quietOlder, _quiet, _busy]);
        ids.ShouldNotContain(_away, "out of office people are not suggested");
        ids.ShouldNotContain(_inactive);
        ids.ShouldNotContain(_pending);
        Item(list, _busy).GetProperty("openTaskCount").GetInt32().ShouldBe(4, "Completed and Cancelled do not count");
        Item(list, _closedOnly).GetProperty("openTaskCount").GetInt32().ShouldBe(0);
        Item(list, _quiet).GetProperty("suggested").GetBoolean().ShouldBeTrue();
        Item(list, _quiet).GetProperty("lastAssignedUtc").GetDateTime().ShouldBe(Now.AddDays(-1));
        Item(list, _quiet).GetProperty("reason").GetString().ShouldBe("1 open task, last assigned 1 day ago");

        (await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?suggest=true&limit=2"))).GetArrayLength().ShouldBe(2);
    }

    [Fact]
    public async Task Search_covers_everyone_eligible_by_name_and_shows_out_of_office_people_with_their_return_date()
    {
        var found = await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?q=away"));
        var away = found.EnumerateArray().Single();
        away.GetProperty("userId").GetInt32().ShouldBe(_away);
        away.GetProperty("availability").GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
        away.GetProperty("availability").GetProperty("outUntil").ValueKind.ShouldNotBe(JsonValueKind.Null);
        away.GetProperty("suggested").GetBoolean().ShouldBeFalse();

        // Plain search stays in name order and does not apply the suggestion filter.
        var all = await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?limit=50"));
        var names = all.EnumerateArray().Select(u => u.GetProperty("displayName").GetString()!).ToArray();
        names.ShouldBe([.. names.Order(StringComparer.OrdinalIgnoreCase)]);
        Ids(all).ShouldContain(_away);
    }

    [Fact]
    public async Task A_pod_lists_its_active_members_ranked_with_out_of_office_people_marked_and_inactive_ones_left_out()
    {
        var list = await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/lookup?podId={_pod}"));
        // away (0 open, never assigned) first, quiet (1), busy (4); the inactive member is not offered.
        Ids(list).ShouldBe([_away, _quiet, _busy]);
        Item(list, _away).GetProperty("availability").GetProperty("state").GetString().ShouldBe("OUT_OF_OFFICE");
        Item(list, _away).GetProperty("suggested").GetBoolean().ShouldBeFalse();

        var suggestedInPod = await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/lookup?podId={_pod}&suggest=true"));
        Ids(suggestedInPod).ShouldBe([_quiet, _busy]);

        (await OkAsync(await _h.Admin.GetAsync($"/api/v1/users/lookup?podId={_pod}&q=bus"))).EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ShouldBe([_busy]);
        (await OkAsync(await _h.Admin.GetAsync("/api/v1/users/lookup?podId=99999"))).GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task The_task_type_is_accepted_and_the_action_needs_Task_Assign()
    {
        (await _h.Admin.GetAsync($"/api/v1/users/lookup?suggest=true&taskTypeId={_world.TaskTypeId}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var viewOnly = await _h.UserWithAsync(@"KE\viewonly", "Task.View");
        (await viewOnly.GetAsync("/api/v1/users/lookup?suggest=true")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await viewOnly.GetAsync("/api/v1/users/lookup?podId=1")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_number_of_statements_does_not_grow_with_the_number_of_users()
    {
        var log = new CommandLog();
        await using var logged = _factory.WithWebHostBuilder(b => b.ConfigureServices(s => s.AddLogging(l =>
        {
            l.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            l.AddProvider(log);
        })));
        var http = logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        async Task<int> CountAsync(string url)
        {
            await OkAsync(await http.GetAsync(url)); // warm up (first request builds caches)
            log.Clear();
            await OkAsync(await http.GetAsync(url));
            return log.Snapshot().Count;
        }

        var urls = new[] { "/api/v1/users/lookup?suggest=true&limit=8", $"/api/v1/users/lookup?podId={_pod}", "/api/v1/users/lookup?q=u" };
        var before = new List<int>();
        foreach (var url in urls)
            before.Add(await CountAsync(url));

        for (var i = 0; i < 45; i++)
            await NewUserAsync($@"KE\bulk{i:D2}");
        await _h.ExecuteAsync($"UPDATE TOP (30) dbo.Task SET AssignedUserId = (SELECT MIN(UserId) FROM dbo.AppUser WHERE DisplayName LIKE N'%bulk%'), AssignedAt = SYSUTCDATETIME() WHERE AssignedUserId IS NULL");

        for (var i = 0; i < urls.Length; i++)
            (await CountAsync(urls[i])).ShouldBe(before[i], urls[i]);
        before[0].ShouldBeLessThan(8, "a handful of statements, none per user");

        var suggested = await OkAsync(await http.GetAsync("/api/v1/users/lookup?suggest=true&limit=50"));
        suggested.GetArrayLength().ShouldBeGreaterThan(40);
    }
}
