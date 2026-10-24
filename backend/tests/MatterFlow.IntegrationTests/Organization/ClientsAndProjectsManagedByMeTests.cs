using System.Net;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// <c>GET /clients</c> and <c>GET /projects</c> with <c>matterManagedByMe=true&amp;role=</c> (epic #758, PX-04, #762), on the data of <see cref="PmScopeFixture"/>: a client is "mine" when at least one of
/// its matters is (once, whatever the number of my matters), a project is mine when its matter is. Both go through the shared scope seam.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class ClientsAndProjectsManagedByMeTests(SqlServerFixture sql) : IAsyncLifetime
{
    private PmScopeFixture _fx = null!;

    public async Task InitializeAsync() => _fx = await PmScopeFixture.BuildAsync(new DatabaseApiFactory(await sql.CreateDatabaseAsync()));

    public async Task DisposeAsync() => await _fx.Harness.Factory.DisposeAsync();

    private async Task<(string Ids, int Total)> ClientsAsync(HttpClient client, string query)
    {
        var page = await OkAsync(await client.GetAsync("/api/v1/clients?pageSize=100&" + query));
        return (string.Join(',', page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("clientId").GetInt32()).Order()), page.GetProperty("total").GetInt32());
    }

    private async Task<(string Ids, int Total)> ProjectsAsync(HttpClient client, string query)
    {
        var page = await OkAsync(await client.GetAsync("/api/v1/projects?pageSize=100&" + query));
        return (string.Join(',', page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("projectId").GetInt32()).Order()), page.GetProperty("total").GetInt32());
    }

    private string ClientIds(params string[] keys) => string.Join(',', keys.Select(k => _fx.Clients[k]).Order());

    private string ProjectIds(IEnumerable<string> matterKeys) => string.Join(',', matterKeys.Select(k => _fx.Projects[k]).Order());

    [Fact]
    public async Task A_client_is_mine_when_one_of_its_matters_is_once_and_with_the_right_total()
    {
        // PmFew: few1, few2, few3 are all matters of the client "Managed". PmMany: 40 matters of "Mixed", still one client row.
        (await ClientsAsync(_fx.PmFew, "matterManagedByMe=true")).ShouldBe((ClientIds("Managed"), 1));
        (await ClientsAsync(_fx.PmMany, "matterManagedByMe=true")).ShouldBe((ClientIds("Mixed"), 1));
        (await ClientsAsync(_fx.PmNone, "matterManagedByMe=true")).Total.ShouldBe(0);
        // PmOther shares matters of two clients (Managed: few2, few3, sensitiveManaged; Mixed: primaryOnly, secondaryOnly, ...) and none of Unmanaged.
        (await ClientsAsync(_fx.PmOther, "matterManagedByMe=true")).ShouldBe((ClientIds("Managed", "Mixed"), 2));
        (await ClientsAsync(_fx.Director, "matterManagedByMe=true")).Total.ShouldBe(0);
        (await ClientsAsync(_fx.Technician, "matterManagedByMe=true")).Total.ShouldBe(0);

        // The "Unmanaged" client has matters without any manager: it is in nobody's scope, and the unfiltered list still has it.
        var all = await ClientsAsync(_fx.PmFew, string.Empty);
        all.Ids.Split(',').ShouldContain(_fx.Clients["Unmanaged"].ToString());
        (await ClientsAsync(_fx.PmFew, "matterManagedByMe=false")).Total.ShouldBe(all.Total);
    }

    [Fact]
    public async Task The_role_and_the_other_filters_combine_with_the_scope()
    {
        (await ClientsAsync(_fx.PmFew, "matterManagedByMe=true&role=primary")).Ids.ShouldBe(ClientIds("Managed")); // few1, few3
        (await ClientsAsync(_fx.PmFew, "matterManagedByMe=true&role=secondary")).Ids.ShouldBe(ClientIds("Managed")); // few2
        (await ClientsAsync(_fx.PmMany, "matterManagedByMe=true&role=secondary")).Total.ShouldBe(0); // PmMany is only ever Primary
        (await ClientsAsync(_fx.PmMany, "matterManagedByMe=true&role=primary")).Ids.ShouldBe(ClientIds("Mixed"));
        (await ClientsAsync(_fx.PmOther, "matterManagedByMe=true&role=secondary")).Ids.ShouldBe(ClientIds("Managed", "Mixed")); // few3 / secondaryOnly
        (await ClientsAsync(_fx.PmOther, "matterManagedByMe=true&role=both")).Total.ShouldBe(2);

        // name filter, status and q narrow inside the scope; sorting and paging keep the total.
        (await ClientsAsync(_fx.PmOther, "matterManagedByMe=true&name=Mixed")).Ids.ShouldBe(ClientIds("Mixed"));
        (await ClientsAsync(_fx.PmOther, "matterManagedByMe=true&isActive=false")).Total.ShouldBe(0);
        (await ClientsAsync(_fx.PmOther, "matterManagedByMe=true&q=Unmanaged")).Total.ShouldBe(0);
        var page = await OkAsync(await _fx.PmOther.GetAsync("/api/v1/clients?matterManagedByMe=true&pageSize=1&page=2&sort=-name"));
        page.GetProperty("total").GetInt32().ShouldBe(2);
        page.GetProperty("items").GetArrayLength().ShouldBe(1);
        page.GetProperty("items")[0].GetProperty("name").GetString().ShouldBe("Managed Client");
    }

    [Fact]
    public async Task A_project_is_mine_when_its_matter_is()
    {
        (await ProjectsAsync(_fx.PmFew, "matterManagedByMe=true")).ShouldBe((ProjectIds(_fx.ManagedKeys(_fx.PmFewId)), 3));
        (await ProjectsAsync(_fx.PmMany, "matterManagedByMe=true")).ShouldBe((ProjectIds(_fx.ManagedKeys(_fx.PmManyId)), 40));
        (await ProjectsAsync(_fx.PmNone, "matterManagedByMe=true")).Total.ShouldBe(0);
        (await ProjectsAsync(_fx.PmOther, "matterManagedByMe=true")).Ids.ShouldBe(ProjectIds(_fx.ManagedKeys(_fx.PmOtherId)));
        (await ProjectsAsync(_fx.PmFew, "matterManagedByMe=true&role=primary")).Ids.ShouldBe(ProjectIds(_fx.ManagedKeys(_fx.PmFewId, "primary")));
        (await ProjectsAsync(_fx.PmFew, "matterManagedByMe=true&role=secondary")).Ids.ShouldBe(ProjectIds(["few2"]));
        (await ProjectsAsync(_fx.PmFew, "matterManagedByMe=false")).Total.ShouldBe((await ProjectsAsync(_fx.PmFew, string.Empty)).Total);

        // matterId inside and outside the scope, the Matter column filter, paging.
        (await ProjectsAsync(_fx.PmFew, $"matterManagedByMe=true&matterId={_fx.Matters["few1"]}")).Ids.ShouldBe(ProjectIds(["few1"]));
        (await ProjectsAsync(_fx.PmFew, $"matterManagedByMe=true&matterId={_fx.Matters["many01"]}")).Total.ShouldBe(0);
        (await ProjectsAsync(_fx.PmFew, "matterManagedByMe=true&name=few3")).Ids.ShouldBe(ProjectIds(["few3"]));
        var paged = await OkAsync(await _fx.PmMany.GetAsync("/api/v1/projects?matterManagedByMe=true&pageSize=10&page=4"));
        paged.GetProperty("total").GetInt32().ShouldBe(40);
        paged.GetProperty("items").GetArrayLength().ShouldBe(10);
    }

    [Fact]
    public async Task An_unknown_combination_is_a_400_on_both_lists_and_the_permissions_are_as_before()
    {
        foreach (var list in new[] { "clients", "projects" })
        {
            (await ProblemAsync(await _fx.PmFew.GetAsync($"/api/v1/{list}?role=primary"), HttpStatusCode.BadRequest, "VALIDATION_FAILED")).GetRawText().ShouldContain("ROLE_NEEDS_MATTER_MANAGED_BY_ME");
            (await ProblemAsync(await _fx.PmFew.GetAsync($"/api/v1/{list}?matterManagedByMe=true&role=nope"), HttpStatusCode.BadRequest, "VALIDATION_FAILED")).GetRawText().ShouldContain("UNKNOWN_ROLE");
            (await _fx.PmFew.GetAsync($"/api/v1/{list}?matterManagedByMe=true&managedByMe=true")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }

        await ProblemAsync(await _fx.PmNoTaskView.GetAsync("/api/v1/clients?matterManagedByMe=true"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        await ProblemAsync(await _fx.PmNoTaskView.GetAsync("/api/v1/projects?matterManagedByMe=true"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
    }
}
