using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>
/// <c>GET /assets?matterManagedByMe=true&amp;role=</c> (epic #758, PX-03, #761): the Assets of the matters the caller manages, on the data of <see cref="PmScopeFixture"/>.
/// The filter goes through the shared scope seam (<c>ManagedScopeSeamTests</c> proves the visibility hook is called), combines with every other filter and sort, and
/// an unknown combination is a 400.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetsManagedByMeTests(SqlServerFixture sql) : IAsyncLifetime
{
    private PmScopeFixture _fx = null!;

    public async Task InitializeAsync() => _fx = await PmScopeFixture.BuildAsync(new DatabaseApiFactory(await sql.CreateDatabaseAsync()));

    public async Task DisposeAsync() => await _fx.Harness.Factory.DisposeAsync();

    private static int[] AssetIds(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("assetId").GetInt32()).Order()];

    private int[] Expected(IEnumerable<string> matterKeys) => [.. matterKeys.Where(_fx.Assets.ContainsKey).SelectMany(k => _fx.Assets[k]).Order()];

    private async Task<(int[] Ids, int Total)> ListAsync(HttpClient client, string query)
    {
        var page = await OkAsync(await client.GetAsync("/api/v1/assets?pageSize=100&" + query));
        return (AssetIds(page), page.GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task The_filter_returns_the_assets_of_the_callers_matters_and_nothing_else()
    {
        // PmFew: few1 and few2 have two assets each (few3 has none). PmMany: many01 and many02. PmNone: nothing.
        var few = await ListAsync(_fx.PmFew, "matterManagedByMe=true");
        few.Ids.ShouldBe(Expected(_fx.ManagedKeys(_fx.PmFewId)));
        few.Ids.Length.ShouldBe(4);
        few.Total.ShouldBe(4);

        (await ListAsync(_fx.PmMany, "matterManagedByMe=true")).Ids.ShouldBe(Expected(_fx.ManagedKeys(_fx.PmManyId)));
        (await ListAsync(_fx.PmNone, "matterManagedByMe=true")).Total.ShouldBe(0);

        // PmOther shares matters with the others and holds primaryOnly, secondaryOnly and two sensitive-ready matters.
        var other = await ListAsync(_fx.PmOther, "matterManagedByMe=true");
        other.Ids.ShouldBe(Expected(_fx.ManagedKeys(_fx.PmOtherId)));
        other.Ids.ShouldContain(_fx.Assets["primaryOnly"][0]);
        other.Ids.ShouldNotContain(_fx.Assets["none1"][0]);
        other.Ids.ShouldNotContain(_fx.Assets["many01"][0]);

        // A matter without a manager is in nobody's scope; a caller who manages nothing gets an empty list, not an error.
        (await ListAsync(_fx.Director, "matterManagedByMe=true")).Total.ShouldBe(0);
        (await ListAsync(_fx.Technician, "matterManagedByMe=true")).Total.ShouldBe(0);

        // False is the same as leaving it out.
        var everything = await ListAsync(_fx.PmFew, string.Empty);
        var unfiltered = await ListAsync(_fx.PmFew, "matterManagedByMe=false");
        unfiltered.Ids.ShouldBe(everything.Ids);
        unfiltered.Total.ShouldBe(everything.Total);
        everything.Total.ShouldBe(_fx.Assets.Values.Sum(v => v.Count));
    }

    [Fact]
    public async Task The_role_picks_Primary_or_Secondary_and_both_is_the_default()
    {
        (await ListAsync(_fx.PmFew, "matterManagedByMe=true&role=primary")).Ids.ShouldBe(Expected(_fx.ManagedKeys(_fx.PmFewId, "primary"))); // few1
        (await ListAsync(_fx.PmFew, "matterManagedByMe=true&role=secondary")).Ids.ShouldBe(Expected(_fx.ManagedKeys(_fx.PmFewId, "secondary"))); // few2
        (await ListAsync(_fx.PmFew, "matterManagedByMe=true&role=secondary")).Ids.ShouldBe([.. _fx.Assets["few2"].Order()]);
        var both = await ListAsync(_fx.PmFew, "matterManagedByMe=true&role=both");
        both.Ids.ShouldBe((await ListAsync(_fx.PmFew, "matterManagedByMe=true")).Ids);
        (await ListAsync(_fx.PmFew, "matterManagedByMe=true&role=BOTH")).Total.ShouldBe(4);
        (await ListAsync(_fx.PmOther, "matterManagedByMe=true&role=secondary")).Ids.ShouldBe(Expected(_fx.ManagedKeys(_fx.PmOtherId, "secondary")));
    }

    [Fact]
    public async Task An_unknown_combination_is_a_400_and_never_ignored()
    {
        (await ProblemAsync(await _fx.PmFew.GetAsync("/api/v1/assets?role=primary"), HttpStatusCode.BadRequest, "VALIDATION_FAILED")).GetRawText().ShouldContain("ROLE_NEEDS_MATTER_MANAGED_BY_ME");
        (await ProblemAsync(await _fx.PmFew.GetAsync("/api/v1/assets?matterManagedByMe=false&role=primary"), HttpStatusCode.BadRequest, "VALIDATION_FAILED")).GetRawText().ShouldContain("ROLE_NEEDS_MATTER_MANAGED_BY_ME");
        (await ProblemAsync(await _fx.PmFew.GetAsync("/api/v1/assets?matterManagedByMe=true&role=nonsense"), HttpStatusCode.BadRequest, "VALIDATION_FAILED")).GetRawText().ShouldContain("UNKNOWN_ROLE");
        // Parameters this list does not know are a 400 too (managedByMe is the Matters list and Task Queue form).
        (await _fx.PmFew.GetAsync("/api/v1/assets?matterManagedByMe=true&managedByMe=true")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task The_filter_combines_with_every_other_filter_sort_and_paging_and_the_total_stays_right()
    {
        var f1 = _fx.Assets["few1"];
        var f2 = _fx.Assets["few2"];

        // matterId: inside the scope, and a matter outside it gives nothing.
        (await ListAsync(_fx.PmFew, $"matterManagedByMe=true&matterId={_fx.Matters["few1"]}")).Ids.ShouldBe([.. f1.Order()]);
        (await ListAsync(_fx.PmFew, $"matterManagedByMe=true&matterId={_fx.Matters["many01"]}")).Total.ShouldBe(0);
        // q and the column filters.
        (await ListAsync(_fx.PmFew, "matterManagedByMe=true&q=Asset 1 of few")).Ids.ShouldBe([f1[0], f2[0]]);
        (await ListAsync(_fx.PmFew, "matterManagedByMe=true&name=of few2")).Ids.ShouldBe([.. f2.Order()]);
        (await ListAsync(_fx.PmFew, "matterManagedByMe=true&matter=PX few1")).Total.ShouldBe(2);
        (await ListAsync(_fx.PmFew, "matterManagedByMe=true&isActive=false")).Total.ShouldBe(0);

        // Paging keeps the total of the whole filtered set; sorting is applied after the filter.
        var page = await OkAsync(await _fx.PmFew.GetAsync("/api/v1/assets?matterManagedByMe=true&pageSize=1&page=3&sort=-displayName"));
        page.GetProperty("total").GetInt32().ShouldBe(4);
        page.GetProperty("items").GetArrayLength().ShouldBe(1);
        page.GetProperty("items")[0].GetProperty("displayName").GetString().ShouldBe("Asset 1 of few2"); // descending: 2 of few2, 2 of few1, 1 of few2, 1 of few1
        var sorted = await OkAsync(await _fx.PmFew.GetAsync("/api/v1/assets?matterManagedByMe=true&sort=matter,-displayName&pageSize=100"));
        sorted.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("displayName").GetString()).ShouldBe(["Asset 2 of few1", "Asset 1 of few1", "Asset 2 of few2", "Asset 1 of few2"]);
    }

    [Fact]
    public async Task Without_Asset_View_the_list_is_a_403_as_before()
    {
        await ProblemAsync(await _fx.PmNoTaskView.GetAsync("/api/v1/assets?matterManagedByMe=true"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
    }
}
