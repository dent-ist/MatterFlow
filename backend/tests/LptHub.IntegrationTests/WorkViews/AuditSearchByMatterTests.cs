using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.WorkViews;

/// <summary>GET /audit/search?matterId= (MD-07, #1008): the Activities tab of a matter lists only the events scoped to that matter, newest first.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AuditSearchByMatterTests(SqlServerFixture sql) : MyMattersTestBase(sql)
{
    [Fact]
    public async Task The_matter_filter_keeps_only_the_events_of_that_matter()
    {
        var all = await OkAsync(await H.Admin.GetAsync("/api/v1/audit/search?pageSize=200"));
        var m1 = await OkAsync(await H.Admin.GetAsync($"/api/v1/audit/search?matterId={M1}&pageSize=200"));
        var m2 = await OkAsync(await H.Admin.GetAsync($"/api/v1/audit/search?matterId={M2}&pageSize=200"));

        var m1Items = m1.GetProperty("items").EnumerateArray().ToList();
        m1Items.ShouldNotBeEmpty();
        m1Items.ShouldAllBe(i => i.GetProperty("matterId").GetInt32() == M1);
        m2.GetProperty("items").EnumerateArray().ShouldAllBe(i => i.GetProperty("matterId").GetInt32() == M2);
        m1Items.Count.ShouldBeLessThan(all.GetProperty("items").GetArrayLength());
        // Newest first.
        var ids = m1Items.Select(i => i.GetProperty("auditEventId").GetInt64()).ToList();
        ids.ShouldBe([.. ids.OrderByDescending(x => x)]);
    }

    [Fact]
    public async Task A_matter_without_events_gives_an_empty_page()
    {
        var none = await OkAsync(await H.Admin.GetAsync("/api/v1/audit/search?matterId=9999999"));
        none.GetProperty("items").GetArrayLength().ShouldBe(0);
    }
}
