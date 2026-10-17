using System.Net.Http.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>
/// <c>GET /api/v1/me</c> returns <c>hasWork</c> (#142): true for an active Pod member or a user with an open assigned Task (New, In Progress,
/// On Hold); tasks created by the user alone, closed tasks, inactive Pods and Access Pending users do not count.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MeHasWorkTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<bool> HasWorkAsync(string user)
    {
        var me = await OkAsync(await _h.As(user).GetAsync("/api/v1/me"));
        return me.GetProperty("hasWork").GetBoolean();
    }

    [Fact]
    public async Task A_user_with_neither_pod_nor_assignment_has_no_work()
    {
        await _h.UserWithAsync(@"KE\none", AllTaskPermissions);
        (await HasWorkAsync(@"KE\none")).ShouldBeFalse();
    }

    [Fact]
    public async Task A_pod_member_without_tasks_has_work_until_the_pod_is_deactivated()
    {
        await _h.UserWithAsync(@"KE\podonly", AllTaskPermissions);
        var podId = await _h.CreatePodAsync("Pod Work A", await _h.UserIdAsync(@"KE\podonly"));
        (await HasWorkAsync(@"KE\podonly")).ShouldBeTrue();

        var pod = await OkAsync(await _h.Admin.GetAsync($"/api/v1/pods/{podId}"));
        var rowVersion = (pod.TryGetProperty("pod", out var inner) ? inner : pod).GetProperty("rowVersion").GetString();
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/pods/{podId}", new { name = "Pod Work A", description = (string?)null, isActive = false, rowVersion }));
        (await HasWorkAsync(@"KE\podonly")).ShouldBeFalse();
    }

    [Fact]
    public async Task An_open_assigned_task_counts_until_it_is_closed()
    {
        await _h.UserWithAsync(@"KE\assigned", AllTaskPermissions);
        var userId = await _h.UserIdAsync(@"KE\assigned");
        (await HasWorkAsync(@"KE\assigned")).ShouldBeFalse();

        var task = await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = userId });
        (await HasWorkAsync(@"KE\assigned")).ShouldBeTrue();

        var onHold = await _h.StatusAsync(task, "ON_HOLD", "Waiting for the client");
        (await HasWorkAsync(@"KE\assigned")).ShouldBeTrue();

        await _h.StatusAsync(onHold, "CANCELLED", "No longer needed");
        (await HasWorkAsync(@"KE\assigned")).ShouldBeFalse();
    }

    [Fact]
    public async Task A_completed_assigned_task_does_not_count()
    {
        await _h.UserWithAsync(@"KE\finished", AllTaskPermissions);
        var userId = await _h.UserIdAsync(@"KE\finished");
        var task = await _h.CreateTaskAsync(_w, ordered: false, extra: new() { ["assignedUserId"] = userId });
        await _h.CompleteAsync(task);
        (await HasWorkAsync(@"KE\finished")).ShouldBeFalse();
    }

    [Fact]
    public async Task Pod_and_assignment_together_have_work()
    {
        await _h.UserWithAsync(@"KE\both", AllTaskPermissions);
        var userId = await _h.UserIdAsync(@"KE\both");
        await _h.CreatePodAsync("Pod Work B", userId);
        await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = userId });
        (await HasWorkAsync(@"KE\both")).ShouldBeTrue();
    }

    [Fact]
    public async Task Tasks_created_by_the_user_alone_do_not_count()
    {
        var creator = await _h.UserWithAsync(@"KE\creatoronly", AllTaskPermissions);
        var other = await _h.UserWithAsync(@"KE\someoneelse", AllTaskPermissions);
        other.ShouldNotBeNull();
        var otherId = await _h.UserIdAsync(@"KE\someoneelse");

        await _h.CreateTaskAsync(_w, client: creator);
        await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = otherId }, client: creator);

        (await HasWorkAsync(@"KE\creatoronly")).ShouldBeFalse();
        (await HasWorkAsync(@"KE\someoneelse")).ShouldBeTrue();
    }

    [Fact]
    public async Task Work_does_not_depend_on_permissions_but_the_flag_is_reported_for_every_active_role()
    {
        // The flag is facts about the user; the client decides the landing from Task.View. A Dashboard-only user with an assignment still reports it.
        await _h.UserWithAsync(@"KE\dashonly", "Dashboard.View");
        await _h.UserWithAsync(@"KE\notaskview", "Matter.View");
        var dashId = await _h.UserIdAsync(@"KE\dashonly");
        await _h.CreateTaskAsync(_w, extra: new() { ["assignedUserId"] = dashId });

        (await HasWorkAsync(@"KE\dashonly")).ShouldBeTrue();
        (await HasWorkAsync(@"KE\notaskview")).ShouldBeFalse();
    }

    [Fact]
    public async Task An_access_pending_user_has_no_work()
    {
        var pending = await OkAsync(await _h.As(@"KE\pendingone").GetAsync("/api/v1/me"));
        pending.GetProperty("status").GetString().ShouldBe("ACCESS_PENDING");
        pending.GetProperty("hasWork").GetBoolean().ShouldBeFalse();
    }
}
