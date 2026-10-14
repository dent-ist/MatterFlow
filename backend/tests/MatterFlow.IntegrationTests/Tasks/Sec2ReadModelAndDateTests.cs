using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>SEC2-09 (dates that overflow DateOnly arithmetic) and SEC2-11 (read models must not expose data of types the caller cannot view).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class Sec2ReadModelAndDateTests(SqlServerFixture sql) : IAsyncLifetime
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

    [Theory]
    [InlineData("/api/v1/task-queue?createdTo=9999-12-31")]
    [InlineData("/api/v1/task-queue?completedTo=9999-12-31")]
    [InlineData("/api/v1/task-queue?createdFrom=0001-01-01&createdTo=9999-12-31&completedFrom=0001-01-01&completedTo=9999-12-31")]
    [InlineData("/api/v1/my-work?createdTo=9999-12-31")]
    [InlineData("/api/v1/pod-work?createdTo=9999-12-31")]
    [InlineData("/api/v1/audit/search?to=9999-12-31")]
    [InlineData("/api/v1/audit/search?from=0001-01-01&to=9999-12-31")]
    public async Task Sec2_09_extreme_dates_do_not_cause_a_server_error(string url)
    {
        await _h.CreateTaskAsync(_w);
        var response = await _h.Admin.GetAsync(url);
        response.StatusCode.ShouldNotBe(HttpStatusCode.InternalServerError, await response.Content.ReadAsStringAsync());
        ((int)response.StatusCode).ShouldBeLessThan(500);
    }

    [Fact]
    public async Task Sec2_09_a_far_future_end_date_still_includes_everything_created_before_it()
    {
        await _h.CreateTaskAsync(_w);
        var queue = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-queue?createdTo=9999-12-31"));
        queue.GetProperty("total").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task Sec2_11_linked_assets_show_names_only_to_callers_who_can_view_assets()
    {
        var type = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Drive" }), HttpStatusCode.Created);
        var asset = await OkAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = _w.MatterId, assetTypeId = type.GetProperty("assetTypeId").GetInt32(), displayName = "Secret evidence drive", externalReference = "EVID-77" }),
            HttpStatusCode.Created);
        var assetId = asset.GetProperty("assetId").GetInt32();
        var task = await _h.CreateTaskAsync(_w);
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/tasks/{TaskId(task)}/assets", new { assetId }), HttpStatusCode.Created);

        var taskOnly = await _h.UserWithAsync(@"KE\taskonly", "Task.View");
        var seen = await OkAsync(await taskOnly.GetAsync($"/api/v1/tasks/{TaskId(task)}/assets"));
        var item = seen.GetProperty("items").EnumerateArray().Single();
        item.GetProperty("assetId").GetInt32().ShouldBe(assetId);
        item.GetProperty("displayName").GetString().ShouldBe($"Asset {assetId}");
        item.GetProperty("assetTypeName").GetString().ShouldBeEmpty();
        item.GetProperty("externalReference").ValueKind.ShouldBe(JsonValueKind.Null);
        seen.GetRawText().ShouldNotContain("Secret evidence drive");
        seen.GetRawText().ShouldNotContain("EVID-77");

        var withAssets = await _h.UserWithAsync(@"KE\withassets", "Task.View", "Asset.View");
        var full = (await OkAsync(await withAssets.GetAsync($"/api/v1/tasks/{TaskId(task)}/assets"))).GetProperty("items").EnumerateArray().Single();
        full.GetProperty("displayName").GetString().ShouldBe("Secret evidence drive");
        full.GetProperty("externalReference").GetString().ShouldBe("EVID-77");
    }

    [Fact]
    public async Task Sec2_11_search_hits_carry_the_matter_only_for_callers_who_can_view_matters()
    {
        var projectOnly = await _h.UserWithAsync(@"KE\projectonly", "Project.View");
        var hit = await FirstProjectHitAsync(projectOnly);
        hit.GetProperty("matterRef").ValueKind.ShouldBe(JsonValueKind.Null);
        hit.GetProperty("matterName").ValueKind.ShouldBe(JsonValueKind.Null);
        hit.GetProperty("secondary").ValueKind.ShouldBe(JsonValueKind.Null);

        var both = await _h.UserWithAsync(@"KE\projectmatter", "Project.View", "Matter.View");
        var full = await FirstProjectHitAsync(both);
        full.GetProperty("matterName").GetString().ShouldNotBeNullOrEmpty();
    }

    private static async Task<JsonElement> FirstProjectHitAsync(HttpClient client)
    {
        var result = await OkAsync(await client.GetAsync("/api/v1/search?q=Phase"));
        return result.GetProperty("groups").EnumerateArray()
            .Single(g => g.GetProperty("type").GetString() == "project")
            .GetProperty("items")[0];
    }
}
