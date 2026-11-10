using System.Net;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Search.SearchData;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Search;

/// <summary>GET /api/v1/search/advanced (ticket 53): per-type filters, paging, permissions, validation.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AdvancedSearchApiTests(SqlServerFixture sql)
{
    private Task<SearchData> DataAsync() => SearchData.GetAsync(sql);

    [Fact]
    public async Task Matters_filter_by_client_active_sensitive_and_text()
    {
        var d = await DataAsync();

        Labels(await d.AdvancedAsync($"type=matter&client={d.BetaClientId}")).ShouldBe(["Beta Litigation", "Beta Other Matter"]);
        Labels(await d.AdvancedAsync($"type=matter&client={d.BetaClientId}&sensitive=true")).ShouldBe(["Beta Litigation"]);
        Labels(await d.AdvancedAsync($"type=matter&client={d.BetaClientId}&sensitive=false")).ShouldBe(["Beta Other Matter"]);
        Labels(await d.AdvancedAsync($"type=matter&client={d.BetaClientId}&q=other")).ShouldBe(["Beta Other Matter"]);
        Labels(await d.AdvancedAsync("type=matter&q=00002-00099")).ShouldBe(["Beta Other Matter"]);

        await d.H.ExecuteAsync($"UPDATE dbo.Matter SET IsActive = 0 WHERE MatterId = {d.DecoyMatterId}");
        try
        {
            Labels(await d.AdvancedAsync($"type=matter&client={d.BetaClientId}&active=false")).ShouldBe(["Beta Other Matter"]);
            Labels(await d.AdvancedAsync($"type=matter&client={d.BetaClientId}&active=true")).ShouldBe(["Beta Litigation"]);
        }
        finally
        {
            await d.H.ExecuteAsync($"UPDATE dbo.Matter SET IsActive = 1 WHERE MatterId = {d.DecoyMatterId}");
        }
    }

    [Fact]
    public async Task Clients_filter_by_active_state_and_text_and_page_with_a_total()
    {
        var d = await DataAsync();
        var page = await d.AdvancedAsync("type=client&q=orbit&pageSize=2&page=1");
        page.GetProperty("total").GetInt32().ShouldBe(4);
        page.GetProperty("page").GetInt32().ShouldBe(1);
        page.GetProperty("pageSize").GetInt32().ShouldBe(2);
        Labels(page).ShouldBe(["Orbit", "Orbit Holdings"]);
        Labels(await d.AdvancedAsync("type=client&q=orbit&pageSize=2&page=2")).ShouldBe(["Big Orbit Group", "Reorbital Ltd"]);
        Labels(await d.AdvancedAsync("type=client&q=orbit&pageSize=2&page=3")).ShouldBeEmpty();
        Labels(await d.AdvancedAsync("type=client&q=orbit&active=false")).ShouldBeEmpty();
        Labels(await d.AdvancedAsync("type=client&q=orbit&active=true")).Count.ShouldBe(4);

        // Without text, clients come back by name.
        Labels(await d.AdvancedAsync("type=client&pageSize=100")).ShouldContain("Beta Industries");
    }

    [Fact]
    public async Task Projects_filter_by_matter_and_active()
    {
        var d = await DataAsync();
        Labels(await d.AdvancedAsync($"type=project&matter={d.BetaMatterId}")).ShouldBe(["Beta Phase"]);
        Labels(await d.AdvancedAsync($"type=project&matter={d.DecoyMatterId}")).ShouldBe(["Decoy Phase"]);
        Labels(await d.AdvancedAsync($"type=project&matter={d.BetaMatterId}&active=false")).ShouldBeEmpty();
        Labels(await d.AdvancedAsync("type=project&q=phase")).ShouldBe(["Beta Phase", "Decoy Phase", "Phase 1"], ignoreOrder: true);
    }

    [Fact]
    public async Task Assets_filter_by_matter_type_status_and_text()
    {
        var d = await DataAsync();
        Labels(await d.AdvancedAsync($"type=asset&matter={d.BetaMatterId}")).ShouldBe(["Beta custodian laptop"]);
        Labels(await d.AdvancedAsync($"type=asset&assetType={d.AssetTypeServer}")).ShouldBe(["Decoy file server"]);
        Labels(await d.AdvancedAsync($"type=asset&assetType={d.AssetTypeLaptop}&q=ext")).ShouldBeEmpty();
        Labels(await d.AdvancedAsync($"type=asset&assetType={d.AssetTypeServer}&q=EXT-99")).ShouldBe(["Decoy file server"]);
        Labels(await d.AdvancedAsync("type=asset&q=custodian&active=true")).ShouldBe(["Beta custodian laptop"]);
        Labels(await d.AdvancedAsync("type=asset&q=custodian&active=false")).ShouldBeEmpty();
    }

    [Fact]
    public async Task Tasks_filter_like_the_task_queue_by_status_client_matter_project_and_requestor()
    {
        var d = await DataAsync();
        Labels(await d.AdvancedAsync($"type=task&matter={d.BetaMatterId}")).ShouldBe(["Collect beta documents"]);
        Labels(await d.AdvancedAsync($"type=task&client={d.BetaClientId}")).ShouldBe(["Collect decoy documents", "Collect beta documents"], ignoreOrder: true);
        Labels(await d.AdvancedAsync("type=task&requestor=rita")).ShouldBe(["Collect beta documents"]);
        Labels(await d.AdvancedAsync($"type=task&matter={d.BetaMatterId}&status=NEW")).ShouldBe(["Collect beta documents"]);
        Labels(await d.AdvancedAsync($"type=task&matter={d.BetaMatterId}&status=COMPLETED&status=CANCELLED")).ShouldBeEmpty();
        Labels(await d.AdvancedAsync($"type=task&matter={d.BetaMatterId}&status=NEW,ON_HOLD")).ShouldBe(["Collect beta documents"]);
        Labels(await d.AdvancedAsync($"type=task&q={d.BetaTaskNumber}")).ShouldBe(["Collect beta documents"]);
        var page = await d.AdvancedAsync($"type=task&matter={d.BetaMatterId}");
        page.GetProperty("items")[0].GetProperty("status").GetString().ShouldBe("NEW");
        page.GetProperty("items")[0].GetProperty("reference").GetString().ShouldBe(d.BetaTaskNumber);
    }

    [Fact]
    public async Task The_caller_needs_the_view_permission_of_the_chosen_type_and_filters_must_fit_the_type()
    {
        var d = await DataAsync();
        await ProblemAsync(await d.ClientOnly.GetAsync("/api/v1/search/advanced?type=matter"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await d.TaskOnly.GetAsync("/api/v1/search/advanced?type=asset"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await d.NoSearch.GetAsync("/api/v1/search/advanced?type=client"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        Labels(await d.AdvancedAsync("type=matter&q=beta", d.MatterOnly)).ShouldBe(["Beta Litigation", "Beta Other Matter"]);

        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search/advanced"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search/advanced?type=people"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search/advanced?type=client&sensitive=true"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search/advanced?type=task&active=true"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search/advanced?type=task&status=DONE"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search/advanced?type=client&q=a"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search/advanced?type=client&pageSize=101"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await d.Admin.GetAsync("/api/v1/search/advanced?type=client&nope=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Advanced_text_is_escaped_like_the_global_search()
    {
        var d = await DataAsync();
        Labels(await d.AdvancedAsync("type=client&q=100%25")).ShouldBe(["Rate 100% [Final]_Set"]);
        Labels(await d.AdvancedAsync("type=client&q=%25%25")).ShouldBeEmpty();
        Labels(await d.AdvancedAsync("type=matter&q=%25%25")).ShouldBeEmpty();
        Labels(await d.AdvancedAsync("type=task&q=%25%25")).ShouldBeEmpty();
    }
}
