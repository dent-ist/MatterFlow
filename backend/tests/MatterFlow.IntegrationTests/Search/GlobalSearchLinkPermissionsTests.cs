using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Search.SearchData;

namespace MatterFlow.IntegrationTests.Search;

/// <summary>Hit links and permissions (#461): what a caller without Matter.View is given, so no row can link to a page they cannot open.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class GlobalSearchLinkPermissionsTests(SqlServerFixture sql)
{
    private Task<SearchData> DataAsync() => SearchData.GetAsync(sql);

    [Fact]
    public async Task Hits_of_a_caller_without_Matter_View_carry_no_matter_text_so_no_row_can_link_to_a_page_they_cannot_open()
    {
        var d = await DataAsync();
        var projectOnly = await d.H.UserWithAsync(@"KE\projectonly", "Project.View");

        foreach (var (client, type) in new[] { (d.TaskOnly, "task"), (d.AssetOnly, "asset"), (projectOnly, "project") })
        {
            var r = await d.SearchAsync("00002-00001", client);
            Types(r).ShouldBe([type]);
            var hit = Group(r, type)!.Value.GetProperty("items")[0];
            hit.GetProperty("path").GetString()!.ShouldStartWith("/" + type + "s/");
            hit.GetProperty("matterRef").ValueKind.ShouldBe(System.Text.Json.JsonValueKind.Null);
            hit.GetProperty("matterName").ValueKind.ShouldBe(System.Text.Json.JsonValueKind.Null);
            hit.GetProperty("isSensitive").GetBoolean().ShouldBeTrue(); // the badge stays (addendum O); it names nothing
        }

        // With Matter.View the same hits carry the matter (as text).
        var admin = Group(await d.SearchAsync("00002-00001"), "task")!.Value.GetProperty("items")[0];
        admin.GetProperty("matterRef").GetString().ShouldBe("00002-00001");
    }
}
