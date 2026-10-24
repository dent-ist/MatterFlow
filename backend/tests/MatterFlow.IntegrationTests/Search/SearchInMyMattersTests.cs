using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Search;

/// <summary>
/// The <c>inMyMatters</c> label of search results (epic #758, PX-05, #763) on the data of <see cref="PmScopeFixture"/>: true when the result's matter (for a client: one of its matters) is
/// managed by the caller, false when not, null for a caller without <c>Matter.BeManager</c>. Search stays global: the label never removes or moves a result.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SearchInMyMattersTests(SqlServerFixture sql) : IAsyncLifetime
{
    private PmScopeFixture _fx = null!;

    public async Task InitializeAsync() => _fx = await PmScopeFixture.BuildAsync(new DatabaseApiFactory(await sql.CreateDatabaseAsync()));

    public async Task DisposeAsync() => await _fx.Harness.Factory.DisposeAsync();

    private async Task<List<JsonElement>> HitsAsync(HttpClient client, string type, string query)
    {
        var page = await OkAsync(await client.GetAsync($"/api/v1/search/advanced?type={type}&{query}&page=1&pageSize=100"));
        return [.. page.GetProperty("items").EnumerateArray()];
    }

    private static bool? Label(JsonElement hit) =>
        hit.TryGetProperty("inMyMatters", out var v) && v.ValueKind != JsonValueKind.Null ? v.GetBoolean() : null;

    private static List<long> Ids(IEnumerable<JsonElement> hits) => [.. hits.Select(h => h.GetProperty("id").GetInt64()).Order()];

    [Fact]
    public async Task Matter_hits_say_whether_the_matter_is_one_the_caller_manages()
    {
        var hits = await HitsAsync(_fx.PmFew, "matter", "q=PX");
        var mine = _fx.ManagedKeys(_fx.PmFewId).Select(k => (long)_fx.Matters[k]).Order().ToList();
        Ids(hits.Where(h => Label(h) == true)).ShouldBe(mine);
        hits.Where(h => Label(h) == false).Count().ShouldBe(hits.Count - mine.Count);
        hits.Count.ShouldBeGreaterThan(40); // search stays global: the PM's three matters and everybody else's

        // The same search as the administrator returns the same results: the label removes and moves nothing.
        Ids(await HitsAsync(_fx.Admin, "matter", "q=PX")).ShouldBe(Ids(hits));
        (await HitsAsync(_fx.PmFew, "matter", "q=PX")).Select(h => h.GetProperty("id").GetInt64()).ToList()
            .ShouldBe((await HitsAsync(_fx.PmMany, "matter", "q=PX")).Select(h => h.GetProperty("id").GetInt64()).ToList());

        // PmMany holds forty, PmNone none; secondary and primary count alike.
        Ids((await HitsAsync(_fx.PmMany, "matter", "q=PX")).Where(h => Label(h) == true)).Count.ShouldBe(40);
        (await HitsAsync(_fx.PmNone, "matter", "q=PX")).ShouldAllBe(h => Label(h) == false);
        Ids((await HitsAsync(_fx.PmOther, "matter", "q=PX")).Where(h => Label(h) == true)).ShouldBe(_fx.ManagedKeys(_fx.PmOtherId).Select(k => (long)_fx.Matters[k]).Order().ToList());
    }

    [Fact]
    public async Task Nobody_without_Matter_BeManager_gets_a_label_at_all()
    {
        foreach (var client in new[] { _fx.Technician, _fx.Director })
        {
            foreach (var type in new[] { "matter", "project", "asset", "client" })
                (await HitsAsync(client, type, "q=PX")).ShouldAllBe(h => Label(h) == null, type);
        }

        // The raw answer has no value (null or absent), not false.
        var raw = (await HitsAsync(_fx.Technician, "matter", "q=PX")).First();
        (!raw.TryGetProperty("inMyMatters", out var value) || value.ValueKind == JsonValueKind.Null).ShouldBeTrue();
    }

    [Fact]
    public async Task Projects_assets_tasks_and_clients_are_labelled_through_their_matter()
    {
        var projects = await HitsAsync(_fx.PmFew, "project", "q=Project of");
        projects.Count.ShouldBeGreaterThan(40);
        Ids(projects.Where(h => Label(h) == true)).ShouldBe(_fx.ManagedKeys(_fx.PmFewId).Select(k => (long)_fx.Projects[k]).Order().ToList());

        var assets = await HitsAsync(_fx.PmFew, "asset", "q=Asset");
        Ids(assets.Where(h => Label(h) == true)).ShouldBe(_fx.ManagedKeys(_fx.PmFewId).Where(_fx.Assets.ContainsKey).SelectMany(k => _fx.Assets[k]).Select(i => (long)i).Order().ToList());
        assets.Count.ShouldBe(_fx.Assets.Values.Sum(v => v.Count));

        // Tasks: few1 is the PM's, many01 is not.
        (await HitsAsync(_fx.PmFew, "task", $"matter={_fx.Matters["few1"]}")).ShouldAllBe(h => Label(h) == true);
        (await HitsAsync(_fx.PmFew, "task", $"matter={_fx.Matters["many01"]}")).ShouldAllBe(h => Label(h) == false);
        (await HitsAsync(_fx.PmMany, "task", $"matter={_fx.Matters["many01"]}")).ShouldAllBe(h => Label(h) == true);

        // Clients: one of the client's matters is enough.
        var clients = await HitsAsync(_fx.PmFew, "client", "q=Client");
        Ids(clients.Where(h => Label(h) == true)).ShouldBe([(long)_fx.Clients["Managed"]]);
        clients.Count.ShouldBeGreaterThanOrEqualTo(3);
        Ids((await HitsAsync(_fx.PmMany, "client", "q=Client")).Where(h => Label(h) == true)).ShouldBe([(long)_fx.Clients["Mixed"]]);
        Ids((await HitsAsync(_fx.PmOther, "client", "q=Client")).Where(h => Label(h) == true)).ShouldBe(new[] { (long)_fx.Clients["Managed"], _fx.Clients["Mixed"] }.Order().ToList());
    }

    [Fact]
    public async Task The_typeahead_carries_the_label_too()
    {
        var answer = await OkAsync(await _fx.PmFew.GetAsync("/api/v1/search?q=PX few1&limit=5"));
        var matters = answer.GetProperty("groups").EnumerateArray().First(g => g.GetProperty("type").GetString() == "matter").GetProperty("items").EnumerateArray().ToList();
        matters.ShouldContain(h => h.GetProperty("id").GetInt64() == _fx.Matters["few1"] && Label(h) == true);
        var others = (await OkAsync(await _fx.PmFew.GetAsync("/api/v1/search?q=PX many01&limit=5"))).GetProperty("groups").EnumerateArray()
            .First(g => g.GetProperty("type").GetString() == "matter").GetProperty("items").EnumerateArray().ToList();
        others.ShouldContain(h => h.GetProperty("id").GetInt64() == _fx.Matters["many01"] && Label(h) == false);
    }
}
