using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// Task Queue filters of the Project Manager epic (#667, issue #676): <c>managedByMe</c> / <c>managerId</c> + <c>role</c>, <c>dueWithin</c> and the
/// <c>onHoldSince</c> sort. A matter without a manager is never matched; asking for another person's matters needs <c>Matter.AssignManagers</c>.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskQueueManagerFilterTests(SqlServerFixture sql) : IAsyncLifetime
{
    private TaskHarness _h = null!;
    private TaskHarness.World _w = null!;
    private int _pmA;
    private int _pmB;
    private int _m1;
    private int _m2;
    private int _m3;
    private int _m4;
    private HttpClient _pmAClient = null!;
    private HttpClient _assigner = null!;
    private readonly Dictionary<string, long> _ids = [];

    public async Task InitializeAsync()
    {
        _h = new TaskHarness(new DatabaseApiFactory(await sql.CreateDatabaseAsync()));
        _w = await _h.CreateWorldAsync();
        var perms = new[] { "Task.View", "Matter.View", "Matter.BeManager" };
        _pmAClient = await _h.UserWithAsync(@"KE\pma", perms);
        await _h.UserWithAsync(@"KE\pmb", perms);
        _assigner = await _h.UserWithAsync(@"KE\assigner", [.. perms, "Matter.AssignManagers"]);
        _pmA = await _h.UserIdAsync(@"KE\pma");
        _pmB = await _h.UserIdAsync(@"KE\pmb");

        _m1 = _w.MatterId;
        _m2 = await _h.CreateMatterAsync("343", "13");
        _m3 = await _h.CreateMatterAsync("343", "14");
        _m4 = await _h.CreateMatterAsync("343", "15");
        await _h.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {_pmA} WHERE MatterId = {_m1}");
        await _h.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {_pmB}, SecondaryManagerId = {_pmA} WHERE MatterId = {_m2}");
        await _h.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {_pmB} WHERE MatterId = {_m4}");

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        string In(int days) => today.AddDays(days).ToString("yyyy-MM-dd");
        await MakeAsync("m1-soon", _m1, new() { ["dueDate"] = In(2) });
        await MakeAsync("m1-overdue", _m1, new() { ["dueDate"] = "2000-01-01" });
        await MakeAsync("m1-asap", _m1, []);
        await MakeAsync("m2-in-5", _m2, new() { ["dueDate"] = In(5) });
        await MakeAsync("m2-far", _m2, new() { ["dueDate"] = "2099-01-01" });
        await MakeAsync("m2-hold-first", _m2, [], "ON_HOLD");
        await MakeAsync("m1-hold-second", _m1, [], "ON_HOLD");
        await MakeAsync("m3-soon", _m3, new() { ["dueDate"] = In(1) });
        await MakeAsync("m4-soon", _m4, new() { ["dueDate"] = In(1) });
        await _h.ExecuteAsync("UPDATE dbo.Task SET StatusChangedAt = DATEADD(day, -10, SYSUTCDATETIME()) WHERE Title = 'm2-hold-first'");
        await _h.ExecuteAsync("UPDATE dbo.Task SET StatusChangedAt = DATEADD(day, -2, SYSUTCDATETIME()) WHERE Title = 'm1-hold-second'");
        _h.Factory.InvalidateAll();
    }

    public async Task DisposeAsync() => await _h.Factory.DisposeAsync();

    private async Task MakeAsync(string title, int matterId, Dictionary<string, object?> extra, string? finalStatus = null)
    {
        extra["matterId"] = matterId;
        var task = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, ordered: false, title: title, extra: extra)), HttpStatusCode.Created);
        _ids[title] = TaskId(task);
        if (finalStatus == "ON_HOLD")
            await _h.StatusAsync(task, "ON_HOLD", "Waiting for the client");
    }

    private async Task<List<string>> QueueAsync(HttpClient client, string query)
    {
        var page = await OkAsync(await client.GetAsync("/api/v1/task-queue?pageSize=100&" + query));
        return [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()!)];
    }

    [Fact]
    public async Task Managed_by_me_lists_tasks_of_the_matters_I_manage_as_primary_or_secondary()
    {
        var mine = await QueueAsync(_pmAClient, "managedByMe=true");
        mine.Order().ShouldBe(new[] { "m1-soon", "m1-overdue", "m1-asap", "m1-hold-second", "m2-in-5", "m2-far", "m2-hold-first" }.Order());

        (await QueueAsync(_pmAClient, "managedByMe=true&role=primary")).ShouldAllBe(t => t.StartsWith("m1-", StringComparison.Ordinal));
        (await QueueAsync(_pmAClient, "managedByMe=true&role=secondary")).Order().ShouldBe(new[] { "m2-in-5", "m2-far", "m2-hold-first" }.Order());
        (await QueueAsync(_pmAClient, "managedByMe=true&role=both")).Count.ShouldBe(mine.Count);
        // managedByMe=false is the same as leaving it out.
        (await QueueAsync(_pmAClient, "managedByMe=false")).Count.ShouldBe((await QueueAsync(_pmAClient, string.Empty)).Count);
        // A matter without a manager is never in it, and combines with the other filters.
        mine.ShouldNotContain("m3-soon");
        (await QueueAsync(_pmAClient, "managedByMe=true&overdue=true")).ShouldBe(["m1-overdue"]);
        (await QueueAsync(_pmAClient, $"managedByMe=true&matter={_m2}&status=ON_HOLD")).ShouldBe(["m2-hold-first"]);
    }

    [Fact]
    public async Task Another_persons_matters_need_AssignManagers_and_a_mismatch_is_refused()
    {
        var denied = await ProblemAsync(await _pmAClient.GetAsync($"/api/v1/task-queue?managerId={_pmB}"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        denied.GetProperty("meta").GetProperty("permission").GetString().ShouldBe("Matter.AssignManagers");
        // Asking for oneself needs nothing extra.
        (await QueueAsync(_pmAClient, $"managerId={_pmA}&role=primary")).ShouldAllBe(t => t.StartsWith("m1-", StringComparison.Ordinal));

        var theirs = await QueueAsync(_assigner, $"managerId={_pmB}");
        theirs.Order().ShouldBe(new[] { "m2-in-5", "m2-far", "m2-hold-first", "m4-soon" }.Order());
        (await QueueAsync(_assigner, $"managerId={_pmB}&role=secondary")).ShouldBeEmpty();
        (await QueueAsync(_assigner, $"managerId={_pmA}&role=secondary")).Count.ShouldBe(3);

        await ProblemAsync(await _assigner.GetAsync($"/api/v1/task-queue?managedByMe=true&managerId={_pmB}"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _assigner.GetAsync("/api/v1/task-queue?role=boss&managedByMe=true"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task DueWithin_is_open_not_overdue_and_due_in_three_or_seven_days()
    {
        (await QueueAsync(_pmAClient, "managedByMe=true&dueWithin=3")).ShouldBe(["m1-soon"]);
        (await QueueAsync(_pmAClient, "managedByMe=true&dueWithin=7")).Order().ShouldBe(new[] { "m1-soon", "m2-in-5" }.Order());
        // Without a manager filter it is a plain filter over every matter, and the same predicate the Dashboard's due soon uses.
        (await QueueAsync(_pmAClient, "dueWithin=3")).Order().ShouldBe(new[] { "m1-soon", "m3-soon", "m4-soon" }.Order());
        await ProblemAsync(await _pmAClient.GetAsync("/api/v1/task-queue?dueWithin=5"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Sort_onHoldSince_puts_the_oldest_hold_first_and_other_tasks_after_the_holds()
    {
        var asc = await QueueAsync(_pmAClient, "managedByMe=true&sort=onHoldSince");
        asc.Take(2).ShouldBe(["m2-hold-first", "m1-hold-second"]);
        var desc = await QueueAsync(_pmAClient, "managedByMe=true&sort=onHoldSince&dir=desc");
        desc.Take(2).ShouldBe(["m1-hold-second", "m2-hold-first"]);
        asc.Skip(2).ShouldNotContain("m2-hold-first");
        asc.Count.ShouldBe(7);
    }

    [Fact]
    public async Task My_Work_and_Pod_Work_accept_the_same_filters_and_unknown_ones_are_still_refused()
    {
        (await _pmAClient.GetAsync("/api/v1/my-work?managedByMe=true&dueWithin=3")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await ProblemAsync(await _pmAClient.GetAsync("/api/v1/task-queue?managedBy=me"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }
}
