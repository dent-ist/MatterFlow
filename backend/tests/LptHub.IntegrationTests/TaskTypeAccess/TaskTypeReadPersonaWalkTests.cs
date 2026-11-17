using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using LptHub.IntegrationTests.Fixtures;
using LptHub.IntegrationTests.Security;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.TaskTypeAccess;

/// <summary>
/// "Walk every task-reading endpoint as personas" for the Task Type access rule (epic #1397, issue #1400, README 12.2 step 2): every endpoint of <see cref="TaskTypeAccessCatalog"/> classified
/// as <see cref="TypeHandling.Port"/>, <see cref="TypeHandling.ById"/> or <see cref="TypeHandling.Exception"/> is sent, with the calls of <see cref="SensitiveAccessCatalog"/>, as the people who
/// hold none of the Can View roles (an assignee and project manager, a plain user, a holder of <c>Matter.ViewSensitive</c>); no body, header or CSV may carry the sentinel of the restricted type,
/// and a hidden task id answers byte for byte like a missing one. The role holder and the System Admin are walked as the positive control: the sentinel IS reachable, so the sweep is not vacuous.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeReadPersonaWalkTests(SqlServerFixture sql)
{
    private const long MissingId = 999_999_999;

    private sealed record Ids(long[] Tasks, int Matter, int Project, int Client, int User, int AssetType, int TaskType, int[] Assets);

    private static async Task<Ids> PrepareAsync(TaskTypeUniverse u)
    {
        var type = await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Walk type" }), HttpStatusCode.Created);
        var typeId = type.GetProperty("assetTypeId").GetInt32();
        async Task<int> AssetOn(string name) =>
            (await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = u.Matter, assetTypeId = typeId, displayName = name }), HttpStatusCode.Created)).GetProperty("assetId").GetInt32();

        var linkedToSecret = await AssetOn("Asset linked to the secret task");
        var plain = await AssetOn("Plain asset");
        (await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.T3}/assets", new { assetId = linkedToSecret })).EnsureSuccessStatusCode();
        (await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.T4}/assets", new { assetId = plain })).EnsureSuccessStatusCode();
        var clientId = (await OkAsync(await u.H.Admin.GetAsync($"/api/v1/matters/{u.Matter}"))).GetProperty("clientId").GetInt32();
        return new Ids(u.AllTasks, u.Matter, u.Project, clientId, u.OutsiderId, typeId, u.SecretTypeId, [linkedToSecret, plain]);
    }

    private static IEnumerable<string> Expand(string template, Ids ids)
    {
        string[] tokens = ["{task}", "{matter}", "{project}", "{asset}", "{client}", "{user}", "{assettype}", "{tasktype}"];
        var found = tokens.FirstOrDefault(template.Contains);
        if (found is null)
        {
            yield return template;
            yield break;
        }

        IEnumerable<long> values = found switch
        {
            "{task}" => ids.Tasks,
            "{matter}" => [ids.Matter],
            "{project}" => [ids.Project],
            "{asset}" => ids.Assets.Select(i => (long)i),
            "{client}" => [ids.Client],
            "{user}" => [ids.User],
            "{assettype}" => [ids.AssetType],
            _ => [ids.TaskType],
        };
        foreach (var value in values)
        {
            foreach (var rest in Expand(template.Replace(found, value.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal), ids))
                yield return rest;
        }
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, string key, string url)
    {
        if (!key.StartsWith("POST ", StringComparison.Ordinal))
            return await client.GetAsync("/" + url);

        var split = url.IndexOf('|', StringComparison.Ordinal);
        return await client.PostAsync("/" + url[..split], new StringContent(url[(split + 1)..], Encoding.UTF8, "application/json"));
    }

    private static IEnumerable<(string Key, TypeEntry Entry, string[] Calls)> Walked() =>
        TaskTypeAccessCatalog.All
            .Where(kv => kv.Value.Handling is TypeHandling.Port or TypeHandling.ById or TypeHandling.Exception)
            .Select(kv => (kv.Key, kv.Value, SensitiveAccessCatalog.All[kv.Key].Calls))
            .Where(x => x.Calls.Length > 0 && !x.Key.Contains("/reports/", StringComparison.Ordinal));

    private static string Snippet(string text)
    {
        var at = text.IndexOf(TaskTypeUniverse.Sentinel, StringComparison.OrdinalIgnoreCase);
        return at < 0 ? "(in a header)" : text.Substring(Math.Max(0, at - 200), Math.Min(320, text.Length - Math.Max(0, at - 200)));
    }

    private static async Task<(string Body, string Headers)> ReadAsync(HttpResponseMessage response) =>
        (await response.Content.ReadAsStringAsync(), string.Join('\n', response.Headers.Select(h => h.Key + ": " + string.Join(',', h.Value))));

    [Fact]
    public async Task No_walked_endpoint_gives_a_person_without_the_role_anything_of_the_restricted_type_and_the_role_holder_does_reach_it()
    {
        var u = await TaskTypeUniverse.BuildAsync(sql, typeRule: true);
        try
        {
            var ids = await PrepareAsync(u);
            u.H.Factory.InvalidateAll();
            var violations = new List<string>();
            var reached = new Dictionary<string, int>();
            var requests = 0;
            var personas = new (string Name, HttpClient Client, bool MaySee)[]
            {
                ("Outsider", u.Outsider, false), ("Plain", u.Plain, false), ("Sensitive holder", u.SensitiveHolder, false), ("Viewer", u.Viewer, true), ("System Admin", u.H.Admin, true),
            };

            foreach (var (name, client, maySee) in personas)
            {
                foreach (var (key, entry, calls) in Walked())
                {
                    foreach (var template in calls)
                    {
                        foreach (var url in Expand(template.Replace("ZZSENS", "secret", StringComparison.Ordinal), ids))
                        {
                            var response = await SendAsync(client, key, url);
                            requests++;
                            var (body, headers) = await ReadAsync(response);
                            var leaked = body.Contains(TaskTypeUniverse.Sentinel, StringComparison.OrdinalIgnoreCase) || headers.Contains(TaskTypeUniverse.Sentinel, StringComparison.OrdinalIgnoreCase);
                            if (leaked && !maySee)
                                violations.Add($"{name}: {key} <- {url} carries the sentinel of the restricted type: ..." + Snippet(body));
                            if (leaked && maySee)
                                reached[key] = reached.GetValueOrDefault(key) + 1;

                            // A hidden task by id answers byte for byte like a missing id.
                            if (entry.Handling == TypeHandling.ById && !maySee && url.Contains("/tasks/", StringComparison.Ordinal) && ids.Tasks.Where(t => t == u.T2 || t == u.T3 || t == u.T6).Any(t => url.Contains($"/tasks/{t}", StringComparison.Ordinal)))
                            {
                                var hidden = ids.Tasks.First(t => url.Contains($"/tasks/{t}", StringComparison.Ordinal));
                                var missing = await SendAsync(client, key, url.Replace($"/tasks/{hidden}", $"/tasks/{MissingId}", StringComparison.Ordinal));
                                if (response.StatusCode != missing.StatusCode)
                                    violations.Add($"{name}: {url} answered {(int)response.StatusCode}, a missing id answers {(int)missing.StatusCode}");
                                else if (TaskTypeUniverse.WithoutTrace(body).Replace(hidden.ToString(CultureInfo.InvariantCulture), "ID", StringComparison.Ordinal) != TaskTypeUniverse.WithoutTrace(await missing.Content.ReadAsStringAsync()).Replace(MissingId.ToString(CultureInfo.InvariantCulture), "ID", StringComparison.Ordinal))
                                    violations.Add($"{name}: {url} body differs from the body of a missing id");
                            }
                        }
                    }
                }
            }

            violations.ShouldBeEmpty(string.Join(Environment.NewLine, violations.Take(40)));
            requests.ShouldBeGreaterThan(300);

            // The positive control: the sentinel is reachable through the main task readers for the role holder and the System Admin (otherwise the sweep proves nothing).
            foreach (var key in new[] { "GET api/v1/tasks", "GET api/v1/task-queue", "GET api/v1/task-queue/export", "GET api/v1/search", "GET api/v1/tasks/{taskId:long}", "GET api/v1/tasks/{taskId:long}/comments", "GET api/v1/audit/events", "GET api/v1/assets/{assetId:int}/linked-tasks" })
                reached.ShouldContainKey(key);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_same_walk_finds_the_leaks_when_the_switch_is_off_so_the_sweep_is_not_vacuous()
    {
        var u = await TaskTypeUniverse.BuildAsync(sql, typeRule: false);
        try
        {
            var ids = await PrepareAsync(u);
            u.H.Factory.InvalidateAll();
            var found = 0;
            foreach (var (key, _, calls) in Walked().Where(w => w.Key is "GET api/v1/tasks" or "GET api/v1/task-queue" or "GET api/v1/search" or "GET api/v1/my-work"))
            {
                foreach (var url in calls.SelectMany(c => Expand(c.Replace("ZZSENS", "secret", StringComparison.Ordinal), ids)))
                {
                    var (body, _) = await ReadAsync(await SendAsync(u.Outsider, key, url));
                    if (body.Contains(TaskTypeUniverse.Sentinel, StringComparison.OrdinalIgnoreCase))
                        found++;
                }
            }

            found.ShouldBeGreaterThan(0, "with the switch off the Outsider sees the restricted tasks: the walk must notice");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
