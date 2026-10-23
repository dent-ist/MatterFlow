using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// The Project Manager scope fixture (epic #758, PX-01, #759) and the behaviour of "matters managed by me" as it is today, on that data. These tests are
/// the safety net of PX-02 (#760): collapsing the three copies of the rule into one must not change a single answer.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class PmScopeFixtureTests(SqlServerFixture sql) : IAsyncLifetime
{
    private PmScopeFixture _fx = null!;

    public async Task InitializeAsync() => _fx = await PmScopeFixture.BuildAsync(new DatabaseApiFactory(await sql.CreateDatabaseAsync()));

    public async Task DisposeAsync() => await _fx.Harness.Factory.DisposeAsync();

    private async Task<int[]> MattersAsync(HttpClient client, string query) =>
        PmScopeFixture.MatterIds(await OkAsync(await client.GetAsync("/api/v1/matters?pageSize=100&" + query)));

    private async Task<long[]> QueueAsync(HttpClient client, string query) =>
        [.. (await OkAsync(await client.GetAsync("/api/v1/task-queue?pageSize=100&" + query))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("taskId").GetInt64()).Order()];

    [Fact]
    public void The_fixture_has_the_shapes_the_epic_needs()
    {
        _fx.ManagedKeys(_fx.PmFewId).Count.ShouldBe(3);
        _fx.ManagedKeys(_fx.PmManyId).Count.ShouldBe(40);
        _fx.ManagedKeys(_fx.PmNoneId).ShouldBeEmpty();
        _fx.ManagedKeys(_fx.PmOtherId, "primary").ShouldBe(["few2", "primaryOnly", "sensitiveManaged"]);
        _fx.ManagedKeys(_fx.PmOtherId, "secondary").ShouldContain("secondaryOnly");
        _fx.Clients.Keys.Order().ShouldBe(["Managed", "Mixed", "Unmanaged"]);
        _fx.Assets.Count.ShouldBeGreaterThan(4);
        _fx.Projects.Count.ShouldBe(_fx.Matters.Count);
        _fx.SensitiveKeys.ShouldAllBe(k => _fx.Matters.ContainsKey(k));
    }

    [Fact]
    public async Task The_matters_list_managedByMe_returns_the_matters_where_I_am_primary_or_secondary()
    {
        (await MattersAsync(_fx.PmFew, "managedByMe=true")).ShouldBe(_fx.IdsOf(_fx.ManagedKeys(_fx.PmFewId)));
        (await MattersAsync(_fx.PmMany, "managedByMe=true")).ShouldBe(_fx.IdsOf(_fx.ManagedKeys(_fx.PmManyId)));
        (await MattersAsync(_fx.PmNone, "managedByMe=true")).ShouldBeEmpty();
        (await MattersAsync(_fx.PmOther, "managedByMe=true")).ShouldBe(_fx.IdsOf(_fx.ManagedKeys(_fx.PmOtherId)));
        // managedByMe=false is the same as leaving it out; a matter without a manager is in nobody's scope.
        (await MattersAsync(_fx.PmFew, "managedByMe=false")).Length.ShouldBe((await MattersAsync(_fx.PmFew, string.Empty)).Length);
        (await MattersAsync(_fx.PmMany, "managedByMe=true")).ShouldNotContain(_fx.Matters["none1"]);
    }

    [Fact]
    public async Task The_manager_filters_of_the_matters_list_match_the_fixture()
    {
        (await MattersAsync(_fx.Admin, $"primaryManagerId={_fx.PmOtherId}")).ShouldBe(_fx.IdsOf(_fx.ManagedKeys(_fx.PmOtherId, "primary")));
        (await MattersAsync(_fx.Admin, $"secondaryManagerId={_fx.PmOtherId}")).ShouldBe(_fx.IdsOf(_fx.ManagedKeys(_fx.PmOtherId, "secondary")));
        (await MattersAsync(_fx.Admin, $"managerId={_fx.PmFewId}")).ShouldBe(_fx.IdsOf(_fx.ManagedKeys(_fx.PmFewId)));
        (await MattersAsync(_fx.Admin, "hasNoManager=true")).ShouldBe(_fx.IdsOf(["none1", "none2", "sensitiveOpen"]).Append(_fx.World.MatterId).Order().ToArray());
    }

    [Fact]
    public async Task The_task_queue_managedByMe_lists_the_tasks_of_my_matters_by_role()
    {
        (await QueueAsync(_fx.PmFew, "managedByMe=true")).ShouldBe([_fx.Tasks["few1"]]);
        (await QueueAsync(_fx.PmMany, "managedByMe=true")).ShouldBe([_fx.Tasks["many01"]]);
        (await QueueAsync(_fx.PmNone, "managedByMe=true")).ShouldBeEmpty();
        (await QueueAsync(_fx.PmOther, "managedByMe=true")).ShouldBe([.. new[] { _fx.Tasks["primaryOnly"], _fx.Tasks["sensitiveManaged"] }.Order()]);
        (await QueueAsync(_fx.PmOther, "managedByMe=true&role=secondary")).ShouldBeEmpty();
        (await QueueAsync(_fx.PmOther, "managedByMe=true&role=primary")).Length.ShouldBe(2);
        // Another person's matters need Matter.AssignManagers.
        await ProblemAsync(await _fx.PmFew.GetAsync($"/api/v1/task-queue?managerId={_fx.PmManyId}"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        (await QueueAsync(_fx.Director, $"managerId={_fx.PmManyId}")).ShouldBe([_fx.Tasks["many01"]]);
    }

    private static int Count(JsonElement summary, string name) => summary.GetProperty(name).GetProperty("count").GetInt32();

    [Fact]
    public async Task My_matters_mine_counts_the_active_matters_of_the_person_and_all_needs_AssignManagers()
    {
        async Task<JsonElement> Summary(HttpClient c, string q = "") => await OkAsync(await c.GetAsync("/api/v1/my-matters/summary?fresh=true" + q));

        Count(await Summary(_fx.PmFew), "matters").ShouldBe(3);
        Count(await Summary(_fx.PmFew), "openTasks").ShouldBe(1);
        Count(await Summary(_fx.PmMany), "matters").ShouldBe(40);
        Count(await Summary(_fx.PmNone), "matters").ShouldBe(0);
        Count(await Summary(_fx.PmOther, "&role=secondary"), "matters").ShouldBe(_fx.ManagedKeys(_fx.PmOtherId, "secondary").Count);

        await ProblemAsync(await _fx.PmFew.GetAsync("/api/v1/my-matters/summary?scope=all"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await _fx.PmFew.GetAsync($"/api/v1/my-matters/summary?managerId={_fx.PmManyId}"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _fx.PmNoTaskView.GetAsync("/api/v1/my-matters/summary"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");

        // The Director cannot be named a manager but holds AssignManagers and Task.View: all matters, or the matters of a named person.
        Count(await Summary(_fx.Director, "&scope=all"), "matters").ShouldBe(_fx.Matters.Count + 1);
        Count(await Summary(_fx.Director, $"&scope=all&managerId={_fx.PmManyId}"), "matters").ShouldBe(40);
    }
}
