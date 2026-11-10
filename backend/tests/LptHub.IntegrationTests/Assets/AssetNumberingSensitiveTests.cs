using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Assets;

/// <summary>
/// The numbering counters under the sensitive-matter rule (epic #788, issue #1297): the counter list, one counter and the next-number control show and change only matters the caller may see;
/// a hidden matter looks like a missing one, and the asset type's example never names a hidden matter. Personas of README 12.2, all holding AssetType.Manage so only the rule differs.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AssetNumberingSensitiveTests(SqlServerFixture sql)
{
    private const int Missing = 999_999;

    private static async Task<JsonElement> JsonOf(HttpResponseMessage response, HttpStatusCode expected)
    {
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(expected, text);
        return JsonDocument.Parse(text).RootElement;
    }

    private static string[] Refs(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterRef").GetString()!).Order(StringComparer.Ordinal)];

    [Fact]
    public async Task Counters_of_hidden_matters_are_not_listed_read_or_changed_and_the_example_never_names_them()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;
        var type = await OkAsync(await admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Media", numbering = new { enabled = true } }), HttpStatusCode.Created);
        var typeId = type.GetProperty("assetTypeId").GetInt32();
        foreach (var matter in new[] { u.N1, u.S1, u.S2 }) // the sensitive S2 is numbered last, so it is the "latest" matter
            (await admin.PostAsJsonAsync("/api/v1/assets", new { matterId = matter, assetTypeId = typeId, displayName = "Disc " + matter })).StatusCode.ShouldBe(HttpStatusCode.Created);

        var role = await u.H.Factory.CreateRoleAsync("Numbering admin", "AssetType.Manage");
        foreach (var user in new[] { @"KE\pmprimary", @"KE\unrelated", @"KE\viewer", @"KE\assignee", @"KE\noperm" })
            await u.H.Factory.GrantRoleAsync(user, role);

        const string n1 = "00343-00012", s1 = "00343-00021", s2 = "00343-00022";
        var all = Refs(await OkAsync(await admin.GetAsync($"/api/v1/asset-types/{typeId}/numbering/counters")));
        all.ShouldBe([n1, s1, s2]);

        // (persona, matters it may see)
        var personas = new (string Name, HttpClient Client, string[] Sees)[]
        {
            ("unrelated", u.UnrelatedClient, [n1]),
            ("assignee", u.AssigneeClient, [n1]),
            ("pm primary", u.PmPrimaryClient, [n1, s1]),
            ("viewer with Matter.ViewSensitive", u.ViewerClient, [n1, s1, s2]),
        };
        var hiddenCounterBody = new Dictionary<string, string>();
        foreach (var (name, client, sees) in personas)
        {
            var page = await OkAsync(await client.GetAsync($"/api/v1/asset-types/{typeId}/numbering/counters"));
            Refs(page).ShouldBe(sees, name);
            page.GetProperty("total").GetInt32().ShouldBe(sees.Length, name);
            foreach (var hidden in all.Except(sees))
                page.ToString().ShouldNotContain(hidden, Case.Insensitive, name);
            if (sees.All(r => r == n1))
                page.ToString().ShouldNotContain(SensitiveUniverse.SentinelPrefix, Case.Sensitive, name);

            // The CM Number search does not find a hidden matter either.
            Refs(await OkAsync(await client.GetAsync($"/api/v1/asset-types/{typeId}/numbering/counters?q=00021"))).ShouldBe(sees.Contains(s1) ? [s1] : [], name);

            foreach (var (matter, matterRef) in new[] { (u.S1, s1), (u.S2, s2) })
            {
                var visible = sees.Contains(matterRef);
                var get = await client.GetAsync($"/api/v1/asset-types/{typeId}/numbering/counters/{matter}");
                if (visible)
                    get.StatusCode.ShouldBe(HttpStatusCode.OK, name);
                else
                {
                    await ProblemAsync(get, HttpStatusCode.NotFound, "NOT_FOUND");
                    var missing = await client.GetAsync($"/api/v1/asset-types/{typeId}/numbering/counters/{Missing}");
                    (await get.Content.ReadAsStringAsync()).ShouldNotContain(SensitiveUniverse.SentinelPrefix);
                    ((int)missing.StatusCode).ShouldBe((int)get.StatusCode);
                    hiddenCounterBody[name] = Normalise(await get.Content.ReadAsStringAsync());
                    Normalise(await missing.Content.ReadAsStringAsync()).ShouldBe(hiddenCounterBody[name].Replace(matter.ToString(), Missing.ToString()), name);
                }

                var put = await client.PutAsJsonAsync($"/api/v1/asset-types/{typeId}/numbering/counters/{matter}", new { nextNumber = visible ? 5 : 500 });
                put.StatusCode.ShouldBe(visible ? HttpStatusCode.OK : HttpStatusCode.NotFound, name);
            }
        }

        // The hidden writes changed nothing: S1 and S2 are at 5 (written by the personas that see them), never 500.
        (await admin.GetAsync($"/api/v1/asset-types/{typeId}/numbering/counters/{u.S1}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var s2Counter = await OkAsync(await admin.GetAsync($"/api/v1/asset-types/{typeId}/numbering/counters/{u.S2}"));
        s2Counter.GetProperty("nextNumber").GetInt32().ShouldBe(5);

        // The asset type's example: the unrelated persona sees the normal matter's CM Number, the viewer may see the latest (sensitive) one.
        var hiddenExample = (await OkAsync(await u.UnrelatedClient.GetAsync($"/api/v1/asset-types/{typeId}"))).GetProperty("numbering").GetProperty("example");
        hiddenExample.GetProperty("cmNumber").GetString().ShouldBe(n1);
        hiddenExample.GetProperty("isSample").GetBoolean().ShouldBeFalse();
        var types = await OkAsync(await u.UnrelatedClient.GetAsync("/api/v1/asset-types?pageSize=100"));
        types.ToString().ShouldNotContain(s1);
        types.ToString().ShouldNotContain(s2);
        var visibleExample = (await OkAsync(await u.ViewerClient.GetAsync($"/api/v1/asset-types/{typeId}"))).GetProperty("numbering").GetProperty("example");
        visibleExample.GetProperty("cmNumber").GetString().ShouldBe(s2);

        // A persona without AssetType.Manage gets 403 for everything, whatever the matter.
        var plain = await u.H.UserWithAsync(@"KE\plain", "Matter.View", "Asset.View");
        (await plain.GetAsync($"/api/v1/asset-types/{typeId}/numbering/counters/{u.N1}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    private static string Normalise(string body)
    {
        var node = System.Text.Json.Nodes.JsonNode.Parse(body)!.AsObject();
        node.Remove("traceId");
        node.Remove("instance");
        return node.ToJsonString();
    }
}
