using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;
using Shouldly;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// The column filters of the Clients, Matters and Projects lists (epic #75, Batch 2): each box searches its own column with a
/// parameterised Contains (case-insensitive, <c>%</c> / <c>_</c> / <c>[</c> literal) and the filters combine with AND.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class OrganizationColumnFilterTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string user, WebApplicationFactory<Program>? factory = null)
    {
        var client = (factory ?? _factory).CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private HttpClient Admin() => As(DatabaseApiFactory.AdminAccount);

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, body);
        return JsonDocument.Parse(body).RootElement;
    }

    private async Task<int> ClientAsync(string number, string name) =>
        (await OkAsync(await Admin().PostAsJsonAsync("/api/v1/clients", new { clientNumber = number, name }), HttpStatusCode.Created)).GetProperty("clientId").GetInt32();

    private async Task<int> MatterAsync(int clientId, string number, string name, bool sensitive = false) =>
        (await OkAsync(await Admin().PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = number, name, isSensitive = sensitive }), HttpStatusCode.Created))
            .GetProperty("matterId").GetInt32();

    private async Task ProjectAsync(int matterId, string name) =>
        await OkAsync(await Admin().PostAsJsonAsync("/api/v1/projects", new { matterId, name }), HttpStatusCode.Created);

    private async Task<string[]> Field(string path, string field) =>
        [.. (await OkAsync(await Admin().GetAsync(path))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty(field).GetString()!)];

    // ---- Clients

    [Fact]
    public async Task Clients_filter_by_number_fragment_and_name_literally_and_combine()
    {
        await ClientAsync("343", "Acme Corp");
        await ClientAsync("1343", "100% Pure_Co");
        await ClientAsync("34", "Bracket [Ltd]");
        await ClientAsync("99999", "acme holdings");

        Task<string[]> Numbers(string query) => Field($"/api/v1/clients?sort=clientNumber&{query}", "clientNumber");

        (await Numbers("name=ACME")).ShouldBe(["00343", "99999"]); // case-insensitive
        (await Numbers("name=pure")).ShouldBe(["01343"]);
        (await Numbers("name=100%25")).ShouldBe(["01343"]); // % is literal
        (await Numbers("name=%25")).ShouldBe(["01343"]);
        (await Numbers("name=_")).ShouldBe(["01343"]); // _ is not "any character"
        (await Numbers("name=%5B")).ShouldBe(["00034"]); // [ is literal
        (await Numbers("name=%5Bab")).ShouldBeEmpty();

        (await Numbers("clientNumber=343")).ShouldBe(["00343", "01343"]); // a fragment of the padded number
        (await Numbers("clientNumber=00343")).ShouldBe(["00343"]);
        (await Numbers("clientNumber=34")).ShouldBe(["00034", "00343", "01343"]);
        (await Numbers("clientNumber=9")).ShouldBe(["99999"]);
        (await Numbers("clientNumber=%25")).ShouldBeEmpty(); // a wildcard is not "every client"
        (await Numbers("clientNumber=ab")).ShouldBeEmpty(); // not digits: nothing, never everything
        (await Numbers("clientNumber=343&name=acme")).ShouldBe(["00343"]); // combined

        // Alongside the legacy q and the status.
        (await Numbers("q=acme&name=corp")).ShouldBe(["00343"]);
        (await Admin().GetAsync("/api/v1/clients?isActive=false&name=acme")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await OkAsync(await Admin().GetAsync("/api/v1/clients?isActive=false&name=acme"))).GetProperty("total").GetInt32().ShouldBe(0);

        // Totals follow the filter and paging works with it.
        var page = await OkAsync(await Admin().GetAsync("/api/v1/clients?clientNumber=34&pageSize=2&page=2&sort=clientNumber"));
        page.GetProperty("total").GetInt32().ShouldBe(3);
        page.GetProperty("items").GetArrayLength().ShouldBe(1);

        (await Admin().GetAsync($"/api/v1/clients?name={new string('x', 201)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await Admin().GetAsync($"/api/v1/clients?clientNumber={new string('1', 201)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    // ---- Matters

    [Fact]
    public async Task Matters_filter_by_reference_name_client_and_sensitivity_literally_and_combine()
    {
        var acme = await ClientAsync("343", "Acme Corp");
        var other = await ClientAsync("77", "100% Pure_Co");
        await MatterAsync(acme, "12", "Merger Review");
        await MatterAsync(acme, "120", "Audit 100% done_set", sensitive: true);
        await MatterAsync(other, "5", "Merger elsewhere");

        Task<string[]> Refs(string query) => Field($"/api/v1/matters?sort=matterRef&{query}", "matterRef");

        // Matter reference: padded, the typed pair (also while typing), a fragment.
        (await Refs("matterRef=00343-00012")).ShouldBe(["00343-00012"]);
        (await Refs("matterRef=343-12")).ShouldBe(["00343-00012", "00343-00120"]);
        (await Refs("matterRef=343-1")).ShouldBe(["00343-00012", "00343-00120"]); // typed so far: also 12 and 120
        (await Refs("matterRef=-00120")).ShouldBe(["00343-00120"]);
        (await Refs("matterRef=00077")).ShouldBe(["00077-00005"]);
        (await Refs("matterRef=%25")).ShouldBeEmpty();
        (await Refs("matterRef=_")).ShouldBeEmpty();
        (await Refs("matterRef=MERGER")).ShouldBeEmpty(); // the name is not the reference

        // Name: this column only, case-insensitive, wildcards literal.
        (await Refs("name=merger")).ShouldBe(["00077-00005", "00343-00012"]);
        (await Refs("name=100%25")).ShouldBe(["00343-00120"]);
        (await Refs("name=%25")).ShouldBe(["00343-00120"]);
        (await Refs("name=_")).ShouldBe(["00343-00120"]);
        (await Refs("name=acme")).ShouldBeEmpty(); // that is a client name

        // Client: name fragment or digits of the client number.
        (await Refs("client=acme")).ShouldBe(["00343-00012", "00343-00120"]);
        (await Refs("client=PURE")).ShouldBe(["00077-00005"]);
        (await Refs("client=343")).ShouldBe(["00343-00012", "00343-00120"]);
        (await Refs("client=77")).ShouldBe(["00077-00005"]);
        (await Refs("client=100%25")).ShouldBe(["00077-00005"]);
        (await Refs("client=%25")).ShouldBe(["00077-00005"]);
        (await Refs("client=_")).ShouldBe(["00077-00005"]);
        (await Refs("client=zzz")).ShouldBeEmpty();

        // Sensitive flag, both ways, and combinations with each other and with the status and clientId.
        (await Refs("isSensitive=true")).ShouldBe(["00343-00120"]);
        (await Refs("isSensitive=false")).ShouldBe(["00077-00005", "00343-00012"]);
        (await Refs("client=acme&name=merger")).ShouldBe(["00343-00012"]);
        (await Refs("matterRef=343&isSensitive=true&name=audit")).ShouldBe(["00343-00120"]);
        (await Refs($"clientId={other}&name=merger")).ShouldBe(["00077-00005"]);
        (await Refs($"clientId={acme}&name=elsewhere")).ShouldBeEmpty();
        (await OkAsync(await Admin().GetAsync("/api/v1/matters?isActive=false&client=acme"))).GetProperty("total").GetInt32().ShouldBe(0);

        (await Admin().GetAsync($"/api/v1/matters?client={new string('x', 201)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await Admin().GetAsync($"/api/v1/matters?matterRef={new string('x', 201)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    // ---- Projects

    [Fact]
    public async Task Projects_filter_by_name_and_matter_literally_and_combine()
    {
        var acme = await ClientAsync("343", "Acme Corp");
        var m12 = await MatterAsync(acme, "12", "Merger Review");
        var m13 = await MatterAsync(acme, "13", "Audit");
        await ProjectAsync(m12, "Phase One");
        await ProjectAsync(m12, "100% done_set");
        await ProjectAsync(m13, "Phase Two");

        Task<string[]> Names(string query) => Field($"/api/v1/projects?sort=name&{query}", "name");

        (await Names("name=PHASE")).ShouldBe(["Phase One", "Phase Two"]);
        (await Names("name=100%25")).ShouldBe(["100% done_set"]);
        (await Names("name=%25")).ShouldBe(["100% done_set"]);
        (await Names("name=_")).ShouldBe(["100% done_set"]);
        (await Names("name=merger")).ShouldBeEmpty(); // that is a matter name

        (await Names("matter=00343-00012")).ShouldBe(["100% done_set", "Phase One"]);
        (await Names("matter=343-13")).ShouldBe(["Phase Two"]);
        (await Names("matter=-00013")).ShouldBe(["Phase Two"]);
        (await Names("matter=merger")).ShouldBe(["100% done_set", "Phase One"]);
        (await Names("matter=AUDIT")).ShouldBe(["Phase Two"]);
        (await Names("matter=%25")).ShouldBeEmpty();
        (await Names("matter=_")).ShouldBeEmpty();

        (await Names("matter=343-12&name=phase")).ShouldBe(["Phase One"]);
        (await Names($"matterId={m13}&name=phase")).ShouldBe(["Phase Two"]);
        (await Names($"matterId={m13}&matter=merger")).ShouldBeEmpty();
        (await OkAsync(await Admin().GetAsync("/api/v1/projects?isActive=false&name=phase"))).GetProperty("total").GetInt32().ShouldBe(0);

        (await Admin().GetAsync($"/api/v1/projects?matter={new string('x', 201)}")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    // ---- Permissions

    [Fact]
    public async Task Column_filters_keep_the_list_permissions()
    {
        var acme = await ClientAsync("343", "Acme Corp");
        var matter = await MatterAsync(acme, "12", "Merger Review");
        await ProjectAsync(matter, "Phase One");

        await As(@"KE\nobody").GetAsync("/api/v1/me");
        var noRole = await _factory.CreateRoleAsync("Tasks only", Permissions.Task.View);
        await _factory.GrantRoleAsync(@"KE\nobody", noRole);
        var nobody = As(@"KE\nobody");
        (await nobody.GetAsync("/api/v1/clients?name=acme")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.GetAsync("/api/v1/matters?client=acme")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.GetAsync("/api/v1/projects?name=phase")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // Matter.View alone does not open the client list, and the client filter on matters needs nothing more than Matter.View.
        await As(@"KE\matters").GetAsync("/api/v1/me");
        await _factory.GrantRoleAsync(@"KE\matters", await _factory.CreateRoleAsync("Matters", Permissions.Matter.View));
        var matters = As(@"KE\matters");
        (await matters.GetAsync("/api/v1/clients?name=acme")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await OkAsync(await matters.GetAsync("/api/v1/matters?client=acme"))).GetProperty("total").GetInt32().ShouldBe(1);
    }
}
