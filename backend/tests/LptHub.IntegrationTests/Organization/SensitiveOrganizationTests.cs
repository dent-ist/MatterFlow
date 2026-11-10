using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Organization;

/// <summary>
/// The Organization read and write paths under the sensitive-matter rule (epic #788, SM-04, inventory R01 to R12): the personas of README 12.2 walk
/// clients, matters and projects. A hidden record answers exactly like a missing id, lists and counts agree, and no sentinel text leaves the server.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveOrganizationTests(SqlServerFixture sql)
{
    private const int Missing = 999_999;
    private const string Stale = "AAAAAAAAB9E=";

    private static async Task<string> BodyAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        if (text.Length == 0 || !text.TrimStart().StartsWith('{'))
            return $"{(int)response.StatusCode}|{text}";

        var node = JsonNode.Parse(text)!.AsObject();
        node.Remove("traceId");
        node.Remove("instance");
        return $"{(int)response.StatusCode}|{node.ToJsonString()}";
    }

    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private static int[] Ids(JsonElement page, string property) => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty(property).GetInt32()).Order()];

    private static (string Name, Func<SensitiveUniverse, HttpClient> Client, Func<SensitiveUniverse, int[]> Sees)[] Personas() =>
    [
        ("P1 primary manager", u => u.PmPrimaryClient, u => [u.N1, u.S1]),
        ("P2 secondary manager", u => u.PmSecondaryClient, u => [u.N1, u.S1]),
        ("P3 task assignee", u => u.AssigneeClient, u => [u.N1]),
        ("P4 view-sensitive holder", u => u.ViewerClient, u => u.AllMatters),
        ("P5 unrelated", u => u.UnrelatedClient, u => [u.N1]),
        ("Administrator", u => u.H.Admin, u => u.AllMatters),
    ];

    [Fact]
    public async Task With_the_switch_off_every_persona_sees_every_matter_project_and_count()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: false);
        try
        {
            foreach (var (name, client, _) in Personas())
            {
                Ids(await GetAsync(client(u), "/api/v1/matters?pageSize=100"), "matterId").ShouldBe([.. u.AllMatters.Order()], name);
                Ids(await GetAsync(client(u), "/api/v1/projects?pageSize=100"), "projectId").ShouldBe([.. new[] { u.World.ProjectId, u.PN1, u.PS1, u.PS2, u.PS3 }.Order()], name);
                (await client(u).GetAsync($"/api/v1/matters/{u.S2}")).StatusCode.ShouldBe(HttpStatusCode.OK, name);
            }
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Matters_lists_lookups_and_counts_show_each_persona_only_what_the_rule_gives()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var expected = sees(u).Order().ToArray();
                var list = await GetAsync(http, "/api/v1/matters?pageSize=100");
                Ids(list, "matterId").ShouldBe(expected, name);
                list.GetProperty("total").GetInt32().ShouldBe(expected.Length, name + ": total equals the rows");

                // The Sensitive filter only ever yields visible rows; paging by one yields the same set.
                Ids(await GetAsync(http, "/api/v1/matters?pageSize=100&isSensitive=true"), "matterId").ShouldBe([.. expected.Intersect(u.SensitiveMatters)], name);
                var paged = new List<int>();
                for (var page = 1; page <= expected.Length; page++)
                    paged.AddRange(Ids(await GetAsync(http, $"/api/v1/matters?pageSize=1&page={page}"), "matterId"));
                paged.Order().ToArray().ShouldBe(expected, name + ": paging");
                (await GetAsync(http, "/api/v1/matters?pageSize=1")).GetProperty("total").GetInt32().ShouldBe(expected.Length, name + ": total ignores the page size");

                // No sentinel of a hidden matter anywhere in any of the answers.
                var hidden = u.SensitiveMatters.Except(expected).ToArray();
                foreach (var url in new[] { "/api/v1/matters?pageSize=100", "/api/v1/matters?pageSize=100&q=ZZSENS", $"/api/v1/clients?pageSize=100", "/api/v1/projects?pageSize=100", "/api/v1/projects?pageSize=100&q=ZZSENS" })
                {
                    var body = await (await http.GetAsync(url)).Content.ReadAsStringAsync();
                    foreach (var matter in hidden)
                        body.ShouldNotContain(SensitiveUniverse.Sentinel(matter), Case.Sensitive, $"{name}: {url}");
                }

                // A search that names a hidden matter finds nothing, a visible one is found.
                foreach (var matter in hidden)
                    Ids(await GetAsync(http, $"/api/v1/matters?pageSize=100&q={SensitiveUniverse.Sentinel(matter)}"), "matterId").ShouldBeEmpty(name);
            }
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_hidden_matter_answers_every_read_and_write_exactly_like_a_missing_id()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var hiddenFrom = new (string Name, HttpClient Client, int Hidden)[]
            {
                ("P3 assignee, S1", u.AssigneeClient, u.S1),
                ("P3 assignee, S3 (their own task's matter)", u.AssigneeClient, u.S3),
                ("P5 unrelated, S2", u.UnrelatedClient, u.S2),
                ("P2 secondary manager, S2 (no manager)", u.PmSecondaryClient, u.S2),
            };

            (string Label, Func<HttpClient, int, Task<HttpResponseMessage>> Call)[] calls =
            [
                ("GET matter", (c, id) => c.GetAsync($"/api/v1/matters/{id}")),
                ("GET summary", (c, id) => c.GetAsync($"/api/v1/matters/{id}/summary")),
                ("PUT matter", (c, id) => c.PutAsJsonAsync($"/api/v1/matters/{id}", new { name = "Renamed", isSensitive = false, rowVersion = Stale })),
                ("PUT managers", (c, id) => c.PutAsJsonAsync($"/api/v1/matters/{id}/managers", new { primaryManagerId = (int?)null, secondaryManagerId = (int?)null, rowVersion = Stale })),
                ("PUT number", (c, id) => c.PutAsJsonAsync($"/api/v1/matters/{id}/number", new { number = "00099", rowVersion = Stale })),
                ("POST active", (c, id) => c.PostAsJsonAsync($"/api/v1/matters/{id}/active", new { isActive = false, rowVersion = Stale })),
            ];

            foreach (var (name, client, hidden) in hiddenFrom)
            {
                foreach (var (label, call) in calls)
                {
                    var forHidden = await BodyAsync(await call(client, hidden));
                    var forMissing = await BodyAsync(await call(client, Missing));
                    forHidden.ShouldBe(forMissing, $"{name}: {label}");
                    forHidden.ShouldStartWith("404|", Case.Sensitive, $"{name}: {label}");
                }
            }

            // Lookup by reference: a hidden matter's reference answers like one that does not exist.
            var hiddenRef = (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S1}")).GetProperty("matterRef").GetString()!;
            (await BodyAsync(await u.UnrelatedClient.GetAsync($"/api/v1/matters/lookup?ref={hiddenRef}")))
                .ShouldBe(await BodyAsync(await u.UnrelatedClient.GetAsync("/api/v1/matters/lookup?ref=00343-09999")));
            (await u.PmPrimaryClient.GetAsync($"/api/v1/matters/lookup?ref={hiddenRef}")).StatusCode.ShouldBe(HttpStatusCode.OK);

            // The hidden matter was not touched by any of the 404 writes above.
            var untouched = await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S2}");
            untouched.GetProperty("name").GetString()!.ShouldContain(SensitiveUniverse.Sentinel(u.S2));
            untouched.GetProperty("isActive").GetBoolean().ShouldBeTrue();

            // P6b: without the permission the policy answers 403 for everything, hidden or not.
            await ProblemAsync(await u.NoPermClient.GetAsync($"/api/v1/matters/{u.S1}"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
            await ProblemAsync(await u.NoPermClient.GetAsync($"/api/v1/matters/{Missing}"), HttpStatusCode.Forbidden, "PERMISSION_DENIED");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Projects_follow_their_matter_for_lists_reads_and_writes()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var all = new[] { (u.N1, u.PN1), (u.N1, u.World.ProjectId), (u.S1, u.PS1), (u.S2, u.PS2), (u.S3, u.PS3) };
            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var visibleMatters = sees(u);
                var expected = all.Where(a => visibleMatters.Contains(a.Item1)).Select(a => a.Item2).Order().ToArray();
                var list = await GetAsync(http, "/api/v1/projects?pageSize=100");
                Ids(list, "projectId").ShouldBe(expected, name);
                list.GetProperty("total").GetInt32().ShouldBe(expected.Length, name);
                foreach (var (matter, project) in all.Where(a => !visibleMatters.Contains(a.Item1)))
                {
                    (await BodyAsync(await http.GetAsync($"/api/v1/projects/{project}"))).ShouldBe(await BodyAsync(await http.GetAsync($"/api/v1/projects/{Missing}")), $"{name}: project of {matter}");
                    (await BodyAsync(await http.GetAsync($"/api/v1/projects/{project}/summary"))).ShouldBe(await BodyAsync(await http.GetAsync($"/api/v1/projects/{Missing}/summary")), name);
                    (await BodyAsync(await http.PutAsJsonAsync($"/api/v1/projects/{project}", new { name = "Renamed", rowVersion = Stale })))
                        .ShouldBe(await BodyAsync(await http.PutAsJsonAsync($"/api/v1/projects/{Missing}", new { name = "Renamed", rowVersion = Stale })), name);
                    (await BodyAsync(await http.PostAsJsonAsync($"/api/v1/projects/{project}/active", new { isActive = false, rowVersion = Stale })))
                        .ShouldBe(await BodyAsync(await http.PostAsJsonAsync($"/api/v1/projects/{Missing}/active", new { isActive = false, rowVersion = Stale })), name);
                    // Creating a project on a hidden matter (matter id in the body) is the same validation as on a matter that does not exist.
                    (await BodyAsync(await http.PostAsJsonAsync("/api/v1/projects", new { matterId = matter, name = "Sneaky" })))
                        .ShouldBe(await BodyAsync(await http.PostAsJsonAsync("/api/v1/projects", new { matterId = Missing, name = "Sneaky" })), $"{name}: create on {matter}");
                }
            }

            // A manager can create a project on their sensitive matter.
            (await u.PmPrimaryClient.PostAsJsonAsync("/api/v1/projects", new { matterId = u.S1, name = "Second project" })).StatusCode.ShouldBe(HttpStatusCode.Created);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Client_matter_counts_summary_and_top_matters_exclude_hidden_matters_and_equal_the_lists()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var clientId = (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.N1}")).GetProperty("clientId").GetInt32();
            foreach (var (name, client, sees) in Personas())
            {
                var http = client(u);
                var visible = sees(u);
                var summary = await GetAsync(http, $"/api/v1/clients/{clientId}/summary");
                summary.GetProperty("matterCount").GetInt32().ShouldBe(visible.Length, name + ": summary matters");
                (await GetAsync(http, $"/api/v1/clients/{clientId}")).GetProperty("matterCount").GetInt32().ShouldBe(visible.Length, name + ": client row");
                var listed = await GetAsync(http, "/api/v1/clients?pageSize=100");
                listed.GetProperty("items").EnumerateArray().Single(c => c.GetProperty("clientId").GetInt32() == clientId).GetProperty("matterCount").GetInt32().ShouldBe(visible.Length, name + ": client list");
                (await GetAsync(http, $"/api/v1/matters?pageSize=100&clientId={clientId}")).GetProperty("total").GetInt32().ShouldBe(visible.Length, name + ": matters list opened from the count");

                // "Matters with most open tasks" names only visible matters; the assignee's task on a hidden matter does not make that matter appear.
                var top = summary.GetProperty("topMatters");
                if (top.ValueKind == JsonValueKind.Array)
                    top.EnumerateArray().Select(t => t.GetProperty("matterId").GetInt32()).ShouldAllBe(id => visible.Contains(id), name + ": top matters");

                var body = summary.GetRawText();
                foreach (var matter in u.SensitiveMatters.Except(visible))
                    body.ShouldNotContain(SensitiveUniverse.Sentinel(matter), Case.Sensitive, name);
            }

            // Open tasks of the client: a visible matter counts all its tasks; a hidden one counts only the caller's own (P3 has one task on S3).
            async Task<int> OpenAsync(HttpClient c) => (await GetAsync(c, $"/api/v1/clients/{clientId}/summary")).GetProperty("openTasks").GetInt32();
            (await OpenAsync(u.UnrelatedClient)).ShouldBe(1);
            (await OpenAsync(u.AssigneeClient)).ShouldBe(2);
            (await OpenAsync(u.PmPrimaryClient)).ShouldBe(2);
            (await OpenAsync(u.ViewerClient)).ShouldBe(4);
            (await OpenAsync(u.H.Admin)).ShouldBe(4);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_taken_number_is_reported_without_revealing_a_hidden_matter()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var clientId = (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.N1}")).GetProperty("clientId").GetInt32();
            var hiddenNumber = (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S2}")).GetProperty("matterNumber").GetString()!;
            var visibleNumber = (await GetAsync(u.H.Admin, $"/api/v1/matters/{u.N1}")).GetProperty("matterNumber").GetString()!;

            var hidden = await u.UnrelatedClient.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = hiddenNumber, name = "Copy" });
            var visible = await u.UnrelatedClient.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = visibleNumber, name = "Copy" });
            hidden.StatusCode.ShouldBe(HttpStatusCode.Conflict);
            visible.StatusCode.ShouldBe(HttpStatusCode.Conflict);
            var hiddenBody = await hidden.Content.ReadAsStringAsync();
            hiddenBody.ShouldNotContain("existingId");
            hiddenBody.ShouldNotContain(SensitiveUniverse.SentinelPrefix);
            (await visible.Content.ReadAsStringAsync()).ShouldContain("existingId");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_actor_gets_the_answer_to_their_own_write_even_when_it_ends_their_access()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // P1 removes themselves and the Secondary from S1: the write succeeds and answers once, then S1 is gone for P1.
            var matter = await GetAsync(u.PmPrimaryClient, $"/api/v1/matters/{u.S1}");
            var response = await u.PmPrimaryClient.PutAsJsonAsync($"/api/v1/matters/{u.S1}/managers", new { primaryManagerId = (int?)null, secondaryManagerId = (int?)null, rowVersion = matter.GetProperty("rowVersion").GetString() });
            response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
            (await u.PmPrimaryClient.GetAsync($"/api/v1/matters/{u.S1}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            Ids(await GetAsync(u.PmPrimaryClient, "/api/v1/matters?pageSize=100"), "matterId").ShouldBe([u.N1]);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
