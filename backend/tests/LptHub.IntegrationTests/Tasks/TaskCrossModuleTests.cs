using System.Net;
using System.Net.Http.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Contracts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>How the Task module plugs into the others: Contracts replaced by real implementations, locks shared with the Organization module.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskCrossModuleTests(SqlServerFixture sql) : IAsyncLifetime
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

    private async Task<T> InScopeAsync<T>(Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider);
    }

    [Fact]
    public async Task The_real_matter_task_guard_replaces_the_organization_default()
    {
        await _h.CreateTaskAsync(_w);
        await _h.CreateTaskAsync(_w);
        await _h.ReachAsync(_w, "ON_HOLD");
        await _h.ReachAsync(_w, "COMPLETED");
        await _h.ReachAsync(_w, "CANCELLED");

        var guard = await InScopeAsync(sp => Task.FromResult(sp.GetRequiredService<IMatterTaskGuard>()));
        guard.ShouldNotBeOfType<NoTasksMatterTaskGuard>();
        (await InScopeAsync(sp => sp.GetRequiredService<IMatterTaskGuard>().CountOpenTasksAsync(_w.MatterId))).ShouldBe(3);
        (await InScopeAsync(sp => sp.GetRequiredService<IMatterTaskGuard>().CountOpenTasksAsync(_w.MatterId + 100))).ShouldBe(0);
    }

    [Fact]
    public async Task The_task_directory_exposes_minimal_reads_for_other_modules()
    {
        var first = await _h.CreateTaskAsync(_w, extra: new() { ["projectId"] = _w.ProjectId, ["dueDate"] = "2099-04-05" });
        var cancelled = await _h.ReachAsync(_w, "CANCELLED");

        var found = await InScopeAsync(sp => sp.GetRequiredService<ITaskDirectory>().FindAsync(TaskId(first)));
        found.ShouldNotBeNull();
        found.TaskNumber.ShouldBe(first.GetProperty("taskNumber").GetString());
        found.MatterId.ShouldBe(_w.MatterId);
        found.ProjectId.ShouldBe(_w.ProjectId);
        found.Status.ShouldBe(TaskStatusCode.New);
        found.DueDate.ShouldBe(new DateOnly(2099, 4, 5));
        found.TaskTypeId.ShouldBe(_w.TaskTypeId);

        (await InScopeAsync(sp => sp.GetRequiredService<ITaskDirectory>().FindAsync(999999))).ShouldBeNull();
        (await InScopeAsync(sp => sp.GetRequiredService<ITaskDirectory>().FindManyAsync([TaskId(first), TaskId(cancelled), 999999]))).Count.ShouldBe(2);
        (await InScopeAsync(sp => sp.GetRequiredService<ITaskDirectory>().FindByNumberAsync(found.TaskNumber.ToLowerInvariant()))).ShouldNotBeNull();
        (await InScopeAsync(sp => sp.GetRequiredService<ITaskDirectory>().FindByNumberAsync("nonsense"))).ShouldBeNull();
        (await InScopeAsync(sp => sp.GetRequiredService<ITaskDirectory>().ListForMatterAsync(_w.MatterId))).Count.ShouldBe(2);
        (await InScopeAsync(sp => sp.GetRequiredService<ITaskDirectory>().ListForMatterAsync(_w.MatterId, includeClosed: false))).Select(t => t.TaskId).ShouldBe([TaskId(first)]);

        var counts = await InScopeAsync(sp => sp.GetRequiredService<ITaskDirectory>().CountByStatusAsync(_w.MatterId));
        counts[TaskStatusCode.New].ShouldBe(1);
        counts[TaskStatusCode.Cancelled].ShouldBe(1);
        counts.ContainsKey(TaskStatusCode.Completed).ShouldBeFalse();
    }

    [Fact]
    public async Task A_priority_used_by_a_task_can_only_be_deactivated_not_deleted()
    {
        var priorities = await OkAsync(await _h.Admin.GetAsync("/api/v1/priorities"));
        var low = priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == "Low");
        var lowId = low.GetProperty("id").GetInt32();
        await _h.CreateTaskAsync(_w, extra: new() { ["priorityId"] = lowId });

        await ProblemAsync(await _h.Admin.DeleteAsync($"/api/v1/priorities/{lowId}"), HttpStatusCode.Conflict, "IN_USE");

        var high = priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == "High").GetProperty("id").GetInt32();
        (await _h.Admin.DeleteAsync($"/api/v1/priorities/{high}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task The_user_directory_resolves_names_for_assignment()
    {
        await _h.UserWithAsync(@"KE\named", TaskHarness.AllTaskPermissions);
        var userId = await _h.UserIdAsync(@"KE\named");

        var info = await InScopeAsync(sp => sp.GetRequiredService<IUserDirectory>().FindAsync(userId));
        info.ShouldNotBeNull();
        info.IsActive.ShouldBeTrue();
        (await InScopeAsync(sp => sp.GetRequiredService<IUserDirectory>().FindAsync(999999))).ShouldBeNull();
        (await InScopeAsync(sp => sp.GetRequiredService<IUserDirectory>().FindManyAsync([userId, 999999]))).Keys.ShouldBe([userId]);
        (await InScopeAsync(sp => sp.GetRequiredService<IUserDirectory>().FindManyAsync([]))).ShouldBeEmpty();
    }

    [Fact]
    public async Task Creating_a_task_waits_for_a_concurrent_matter_deactivation_and_then_sees_the_matter_inactive()
    {
        var holder = _factory.Services.CreateAsyncScope();
        try
        {
            var db = holder.ServiceProvider.GetRequiredService<DbContext>();
            await using var deactivating = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlAsync($"UPDATE dbo.Matter SET IsActive = 0 WHERE MatterId = {_w.MatterId}");

            var creating = _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w));
            await Task.Delay(1500);
            creating.IsCompleted.ShouldBeFalse("the create must wait for the Matter row lock");

            await deactivating.CommitAsync();

            await ProblemAsync(await creating, HttpStatusCode.Conflict, "MATTER_INACTIVE");
            (await _h.ScalarAsync("SELECT COUNT(*) AS [Value] FROM dbo.Task")).ShouldBe(0);
        }
        finally
        {
            await holder.DisposeAsync();
        }
    }

    [Fact]
    public async Task Deactivating_a_matter_waits_for_a_task_creation_that_holds_the_matter_lock()
    {
        // Simulate a Task creation that is half way: it holds the Matter lock, as CreateTask does.
        var holder = _factory.Services.CreateAsyncScope();
        try
        {
            var db = holder.ServiceProvider.GetRequiredService<DbContext>();
            await using var creating = await db.Database.BeginTransactionAsync();
            _ = await db.Database.SqlQuery<int>($"SELECT MatterId AS [Value] FROM dbo.Matter WITH (UPDLOCK, ROWLOCK) WHERE MatterId = {_w.MatterId}").ToListAsync();

            var matter = await OkAsync(await _h.Admin.GetAsync($"/api/v1/matters/{_w.MatterId}"));
            var deactivating = _h.Admin.PostAsJsonAsync($"/api/v1/matters/{_w.MatterId}/active", new { isActive = false, rowVersion = matter.GetProperty("rowVersion").GetString() });
            await Task.Delay(1500);
            deactivating.IsCompleted.ShouldBeFalse("deactivation must wait for the Matter row lock");

            await creating.CommitAsync();
            (await deactivating).StatusCode.ShouldBe(HttpStatusCode.OK);
        }
        finally
        {
            await holder.DisposeAsync();
        }
    }
}
