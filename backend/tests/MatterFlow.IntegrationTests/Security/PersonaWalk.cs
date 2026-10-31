using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using MatterFlow.IntegrationTests.Fixtures;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Security;

/// <summary>One persona of README 12.2 with what the access matrix says they may see (data, not code).</summary>
public sealed record WalkPersona(string Name, HttpClient Client, HashSet<int> Matters, HashSet<long> Tasks, HashSet<int> Projects, HashSet<int> Assets, HashSet<int> HeaderOnlyMatters);

/// <summary>The records of the universe the walk addresses: matters, tasks, projects and the assets the walk adds.</summary>
public sealed record WalkIds(int[] Matters, long[] Tasks, int[] Projects, int[] Assets, int Client, int User, int AssetType, int TaskType, Dictionary<string, int> MatterRefs);

/// <summary>
/// The systematic security suite of README 12.2: walks every classified GET endpoint as every persona against the access matrix, compares each hidden id with a missing id
/// byte for byte, and sweeps every response (body and headers) for the sentinel of every sensitive matter the persona may not see. It returns the violations instead of
/// asserting, so the same walk can be run against a deliberately broken rule to prove it is not vacuous (SM-16 mutation test).
/// </summary>
public sealed class PersonaWalk
{
    private const long MissingId = 999_999_999;

    private readonly SensitiveUniverse _u;
    private readonly WalkIds _ids;
    private readonly List<string> _violations = [];

    private PersonaWalk(SensitiveUniverse u, WalkIds ids)
    {
        _u = u;
        _ids = ids;
    }

    /// <summary>The ids the walk addresses (so a second walk can address the same records).</summary>
    public WalkIds Ids => _ids;

    /// <summary>Entry keys that were sent at least once to each persona (coverage check).</summary>
    public Dictionary<string, HashSet<string>> Covered { get; } = [];

    public IReadOnlyList<string> Violations => _violations;

    public int Requests { get; private set; }

    /// <summary>Adds an asset type and the assets the walk needs on top of the universe (one normal, one per sensitive matter, one linked to the assignee's task).</summary>
    public static async Task<WalkIds> PrepareAsync(SensitiveUniverse u)
    {
        var type = await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Walk type" }), HttpStatusCode.Created);
        var typeId = type.GetProperty("assetTypeId").GetInt32();
        async Task<int> AssetOn(int matter, string name) =>
            (await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = matter, assetTypeId = typeId, displayName = name }), HttpStatusCode.Created)).GetProperty("assetId").GetInt32();

        var an = await AssetOn(u.N1, "Normal asset");
        var a1 = await AssetOn(u.S1, $"{SensitiveUniverse.Sentinel(u.S1)} asset");
        var a2 = await AssetOn(u.S2, $"{SensitiveUniverse.Sentinel(u.S2)} asset");
        var a3 = await AssetOn(u.S3, $"{SensitiveUniverse.Sentinel(u.S3)} linked asset");
        var a3b = await AssetOn(u.S3, $"{SensitiveUniverse.Sentinel(u.S3)} other asset");
        (await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.TS3}/assets", new { assetId = a3 })).EnsureSuccessStatusCode();
        var clientId = (await OkAsync(await u.H.Admin.GetAsync($"/api/v1/matters/{u.N1}"))).GetProperty("clientId").GetInt32();
        var refs = new Dictionary<string, int>();
        foreach (var matter in u.AllMatters)
            refs[(await OkAsync(await u.H.Admin.GetAsync($"/api/v1/matters/{matter}"))).GetProperty("matterRef").GetString()!] = matter;

        return new WalkIds(u.AllMatters, [u.TN1, u.TS1, u.TS2, u.TS3], [u.World.ProjectId, u.PN1, u.PS1, u.PS2, u.PS3], [an, a1, a2, a3, a3b], clientId, u.Assignee, typeId, u.World.TaskTypeId, refs);
    }

    public static PersonaWalk Create(SensitiveUniverse u, WalkIds ids) => new(u, ids);

    /// <summary>The access matrix: who may see what (README 12.2 step 2). Asset order in <see cref="WalkIds.Assets"/>: normal, S1, S2, S3 linked, S3 other.</summary>
    public IReadOnlyList<WalkPersona> Personas(bool primaryStillManages = true, bool ts3MovedToUnrelated = false)
    {
        var u = _u;
        var a = _ids.Assets;
        HashSet<int> ProjectsOf(IEnumerable<int> matters) => [.. ProjectMatters().Where(p => matters.Contains(p.Matter)).Select(p => p.Project)];
        var p1Matters = primaryStillManages ? new HashSet<int> { u.N1, u.S1 } : [u.N1];
        return
        [
            new("P1 primary manager", u.PmPrimaryClient, p1Matters, [.. primaryStillManages ? new[] { u.TN1, u.TS1 } : [u.TN1]], ProjectsOf(p1Matters), [.. primaryStillManages ? new[] { a[0], a[1] } : [a[0]]], []),
            new("P2 secondary manager", u.PmSecondaryClient, [u.N1, u.S1], [u.TN1, u.TS1], ProjectsOf([u.N1, u.S1]), [a[0], a[1]], []),
            new("P3 task assignee", u.AssigneeClient, [u.N1], [.. ts3MovedToUnrelated ? new[] { u.TN1 } : [u.TN1, u.TS3]], ProjectsOf([u.N1]), [.. ts3MovedToUnrelated ? new[] { a[0] } : [a[0], a[3]]], ts3MovedToUnrelated ? [] : [u.S3]),
            new("P4 view-sensitive holder", u.ViewerClient, [.. u.AllMatters], [.. _ids.Tasks], [.. _ids.Projects], [.. a], []),
            new("P5 unrelated", u.UnrelatedClient, [u.N1], [.. ts3MovedToUnrelated ? new[] { u.TN1, u.TS3 } : [u.TN1]], ProjectsOf([u.N1]), [.. ts3MovedToUnrelated ? new[] { a[0], a[3] } : [a[0]]], ts3MovedToUnrelated ? [u.S3] : []),
            new("Administrator", u.H.Admin, [.. u.AllMatters], [.. _ids.Tasks], [.. _ids.Projects], [.. a], []),
        ];
    }

    /// <summary>
    /// The access matrix with the go-live switch off (<c>Features:SensitiveMatterAccess=false</c>): the sensitive-matter rule is not applied, so everybody who holds the permissions sees
    /// every matter, task, project and asset (README 12.2: the suite passes with the switch on and off, each against its own matrix).
    /// </summary>
    public IReadOnlyList<WalkPersona> PersonasWithTheRuleOff() =>
    [
        .. Personas().Select(p => p with { Matters = [.. _ids.Matters], Tasks = [.. _ids.Tasks], Projects = [.. _ids.Projects], Assets = [.. _ids.Assets], HeaderOnlyMatters = [] }),
    ];

    private IEnumerable<(int Matter, int Project)> ProjectMatters() =>
    [
        (_u.N1, _u.World.ProjectId), (_u.N1, _u.PN1), (_u.S1, _u.PS1), (_u.S2, _u.PS2), (_u.S3, _u.PS3),
    ];

    private int MatterOfAsset(int asset) => asset == _ids.Assets[0] ? _u.N1 : asset == _ids.Assets[1] ? _u.S1 : asset == _ids.Assets[2] ? _u.S2 : _u.S3;

    /// <summary>Runs the whole walk: every persona, every catalogued GET with a request, then the unauthenticated and no-permission clients.</summary>
    public async Task RunAsync(IReadOnlyList<WalkPersona> personas)
    {
        foreach (var persona in personas)
        {
            foreach (var (key, entry) in SensitiveAccessCatalog.All.Where(kv => IsWalked(kv.Key, kv.Value)).OrderBy(kv => kv.Key, StringComparer.Ordinal))
                await WalkEntryAsync(persona, key, entry);
        }

        var anonymous = new WalkPersona("P6a unauthenticated", _u.H.Factory.CreateClient(), [], [], [], [], []);
        var noPerm = new WalkPersona("P6b no permission", _u.NoPermClient, [], [], [], [], []);
        foreach (var (key, entry) in SensitiveAccessCatalog.All.Where(kv => IsWalked(kv.Key, kv.Value) && kv.Value.Kind != AccessKind.Open))
        {
            if (key.StartsWith("GET ", StringComparison.Ordinal))
                await WalkAnonymousAsync(anonymous, key, entry);
            await WalkEntryAsync(noPerm, key, entry);
        }
    }

    /// <summary>
    /// Every classified GET is walked. A POST is walked only when it is a read in disguise (a request body too big for a query string, like running an asset report) and the
    /// catalog gives it calls, written <c>url|json body</c> (README 12.2, epic #851 PV-37).
    /// </summary>
    public static bool IsWalked(string key, AccessEntry entry) =>
        (key.StartsWith("GET ", StringComparison.Ordinal) && !IsPublicBranding(key)) || (key.StartsWith("POST ", StringComparison.Ordinal) && entry.Calls.Length > 0 && entry.Kind is not (AccessKind.Write or AccessKind.Open));

    /// <summary>The public application name and icon (epic #850) are readable by anyone and hold no matter data; BrandingApiTests walks them.</summary>
    private static bool IsPublicBranding(string key) => key is "GET api/v1/branding" or "GET api/v1/branding/icon";

    private async Task<HttpResponseMessage> SendAsync(WalkPersona persona, string key, string url)
    {
        if (!key.StartsWith("POST ", StringComparison.Ordinal))
            return await persona.Client.GetAsync("/" + url);

        var split = url.IndexOf('|', StringComparison.Ordinal);
        var content = new StringContent(url[(split + 1)..], System.Text.Encoding.UTF8, "application/json");
        return await persona.Client.PostAsync("/" + url[..split], content);
    }

    private IEnumerable<string> Expand(string template)
    {
        string[] tokens = ["{matterref}", "{matter}", "{task}", "{project}", "{asset}", "{client}", "{user}", "{assettype}", "{tasktype}"];
        var found = tokens.FirstOrDefault(template.Contains);
        if (found is null)
        {
            yield return template;
            yield break;
        }

        if (found == "{matterref}")
        {
            foreach (var reference in _ids.MatterRefs.Keys)
            {
                foreach (var rest in Expand(template.Replace(found, reference, StringComparison.Ordinal)))
                    yield return rest;
            }

            yield break;
        }

        IEnumerable<long> values = found switch
        {
            "{matter}" => _ids.Matters.Select(i => (long)i),
            "{task}" => _ids.Tasks,
            "{project}" => _ids.Projects.Select(i => (long)i),
            "{asset}" => _ids.Assets.Select(i => (long)i),
            "{client}" => [_ids.Client],
            "{user}" => [_ids.User],
            "{assettype}" => [_ids.AssetType],
            _ => [_ids.TaskType],
        };
        foreach (var value in values)
        {
            foreach (var rest in Expand(template.Replace(found, value.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal)))
                yield return rest;
        }
    }

    private async Task WalkAnonymousAsync(WalkPersona persona, string key, AccessEntry entry)
    {
        var calls = CallsOf(key, entry);
        if (calls.Length == 0)
            return;

        var url = Expand(calls[0]).First();
        var response = await persona.Client.GetAsync("/" + url);
        Requests++;
        Cover(key, persona.Name);
        var open = key.Contains("/health", StringComparison.Ordinal) || key.Contains("openapi", StringComparison.Ordinal) || key.Contains("system/ping", StringComparison.Ordinal);
        if (!open && response.StatusCode != HttpStatusCode.Unauthorized)
            _violations.Add($"{persona.Name}: {key} answered {(int)response.StatusCode}, expected 401");
        await SweepAsync(persona, key, url, response);
    }

    private static string[] CallsOf(string key, AccessEntry entry)
    {
        if (entry.Calls.Length > 0)
            return entry.Calls;

        var route = key[(key.IndexOf(' ', StringComparison.Ordinal) + 1)..];
        return route.Contains('{', StringComparison.Ordinal) || entry.Kind == AccessKind.Write || route.StartsWith("api/v1/test/", StringComparison.Ordinal) ? [] : [route.TrimStart('/')];
    }

    private async Task WalkEntryAsync(WalkPersona persona, string key, AccessEntry entry)
    {
        if (entry.Kind is AccessKind.Write or AccessKind.Open)
            return;

        var calls = CallsOf(key, entry);
        if (calls.Length == 0)
            return;

        Cover(key, persona.Name);
        foreach (var template in calls)
        {
            foreach (var url in Expand(template))
            {
                var response = await SendAsync(persona, key, url);
                Requests++;
                var body = await ReadAsync(response);
                if (entry.Kind == AccessKind.Gated)
                    await CheckGatedAsync(persona, key, entry, template, url, response, body);
                else
                    CheckStatus(persona, key, url, response);

                if (response.IsSuccessStatusCode && key.EndsWith("asset-reports/run", StringComparison.Ordinal))
                    CheckReportRows(persona, key, url, body);

                await SweepAsync(persona, key, url, response, body);
            }
        }
    }

    /// <summary>
    /// A report grouped by matter has one row per matter, keyed by the matter id (a number in a string): every row must be a matter the persona may see. Reports follow the matter rule,
    /// so an assignee of a task on a hidden matter gets no row for it either.
    /// </summary>
    private void CheckReportRows(WalkPersona persona, string key, string url, string body)
    {
        using var doc = JsonDocument.Parse(body);
        if (!url.Contains("\"groupBy\":\"matter\"", StringComparison.Ordinal) || !doc.RootElement.TryGetProperty("rows", out var rows))
            return;

        foreach (var row in rows.EnumerateArray())
        {
            if (int.TryParse(row.GetProperty("key").GetString(), out var matter) && _ids.Matters.Contains(matter) && !persona.Matters.Contains(matter))
                _violations.Add($"{persona.Name}: {key} has a row for matter {matter}, which the persona may not see ({url})");
        }
    }

    private async Task CheckGatedAsync(WalkPersona persona, string key, AccessEntry entry, string template, string url, HttpResponseMessage response, string body)
    {
        var id = IdOfUrl(template, url, entry.Id);
        var visible = id is not null && IsVisible(persona, entry.Id, id.Value);
        if (persona.Name.StartsWith("P6b", StringComparison.Ordinal))
        {
            // Without the permission the policy answers for hidden and visible alike (403), never a 404 that tells them apart.
            if (response.StatusCode == HttpStatusCode.NotFound)
                _violations.Add($"{persona.Name}: {key} answered 404 for {url} to a caller without the permission");
            return;
        }

        if (visible)
        {
            // A visible task with a made-up comment id may legitimately answer 404 (revisions); every other visible resource answers 2xx.
            var ok = response.IsSuccessStatusCode || (response.StatusCode == HttpStatusCode.NotFound && url.Contains("/revisions", StringComparison.Ordinal));
            if (!ok)
                _violations.Add($"{persona.Name}: {key} answered {(int)response.StatusCode} for visible {url}");
            return;
        }

        if (response.StatusCode != HttpStatusCode.NotFound)
        {
            _violations.Add($"{persona.Name}: {key} answered {(int)response.StatusCode} for hidden {url}, expected 404");
            return;
        }

        var reference = _ids.MatterRefs.Keys.FirstOrDefault(r => template.Contains("{matterref}", StringComparison.Ordinal) && url.Contains(r, StringComparison.Ordinal));
        var missingUrl = reference is not null
            ? url.Replace(reference, "00343-99999", StringComparison.Ordinal)
            : url.Replace(id!.Value.ToString(System.Globalization.CultureInfo.InvariantCulture), MissingId.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal);
        var missing = await persona.Client.GetAsync("/" + missingUrl);
        Requests++;
        var forMissing = await ReadAsync(missing);
        if (missing.StatusCode != HttpStatusCode.NotFound || Normalize(body) != Normalize(forMissing))
            _violations.Add($"{persona.Name}: {key} answers hidden {url} differently from a missing id");
    }

    private static string Normalize(string body)
    {
        if (!body.TrimStart().StartsWith('{'))
            return body;

        var node = JsonNode.Parse(body)!.AsObject();
        node.Remove("traceId");
        node.Remove("instance");
        return node.ToJsonString();
    }

    private long? IdOfUrl(string template, string url, IdKind kind)
    {
        if (template.Contains("{matterref}", StringComparison.Ordinal))
        {
            var reference = _ids.MatterRefs.Keys.FirstOrDefault(r => url.Contains(r, StringComparison.Ordinal));
            return reference is null ? null : _ids.MatterRefs[reference];
        }

        var token = kind switch { IdKind.Task => "{task}", IdKind.Matter => "{matter}", IdKind.Project => "{project}", IdKind.Asset or IdKind.MatterAsset => "{asset}", _ => null };
        if (token is null)
            return null;

        var prefix = template[..template.IndexOf(token, StringComparison.Ordinal)];
        var rest = url[prefix.Length..];
        var digits = new string(rest.TakeWhile(char.IsDigit).ToArray());
        return long.TryParse(digits, out var value) ? value : null;
    }

    private bool IsVisible(WalkPersona persona, IdKind kind, long id) => kind switch
    {
        IdKind.Task => persona.Tasks.Contains(id),
        IdKind.Matter => persona.Matters.Contains((int)id),
        IdKind.Project => persona.Projects.Contains((int)id),
        IdKind.Asset => persona.Assets.Contains((int)id),
        IdKind.MatterAsset => persona.Matters.Contains(MatterOfAsset((int)id)),
        _ => true,
    };

    private void CheckStatus(WalkPersona persona, string key, string url, HttpResponseMessage response)
    {
        // A policy denial (403) reveals nothing and is allowed (the personas do not all hold every administration permission); a list never answers 404 or 5xx.
        var ok = response.IsSuccessStatusCode || response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotModified || (persona.Name.StartsWith("P6b", StringComparison.Ordinal) && response.StatusCode == HttpStatusCode.BadRequest);
        if (!ok)
            _violations.Add($"{persona.Name}: {key} answered {(int)response.StatusCode} for {url}");
    }

    private async Task SweepAsync(WalkPersona persona, string key, string url, HttpResponseMessage response, string? body = null)
    {
        body ??= await ReadAsync(response);
        if (response.IsSuccessStatusCode)
            SweepIds(persona, key, url, body);
        var headers = string.Join('\n', response.Headers.Concat(response.Content.Headers).Select(h => h.Key + ": " + string.Join(',', h.Value)));
        foreach (var matter in _u.SensitiveMatters.Where(m => !persona.Matters.Contains(m) && !persona.HeaderOnlyMatters.Contains(m)))
        {
            var sentinel = SensitiveUniverse.Sentinel(matter);
            if (body.Contains(sentinel, StringComparison.Ordinal) || headers.Contains(sentinel, StringComparison.Ordinal))
                _violations.Add($"{persona.Name}: {key} leaked {sentinel} in {url}");
        }
    }

    private static async Task<string> ReadAsync(HttpResponseMessage response) => await response.Content.ReadAsStringAsync();

    /// <summary>
    /// The id sweep: any <c>matterId</c>, <c>taskId</c>, <c>projectId</c> or <c>assetId</c> in a JSON answer that the persona may not see is a leak, even when no sentinel text
    /// travels with it (an audit event, a notification, a count row). A header-only matter (an assignee's task) and its project may appear; nothing else of it.
    /// </summary>
    private void SweepIds(WalkPersona persona, string key, string url, string body)
    {
        if (!body.TrimStart().StartsWith('{') && !body.TrimStart().StartsWith('['))
            return;

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            return;
        }

        using (doc)
        {
            var projectsOfHeader = ProjectMatters().Where(p => persona.HeaderOnlyMatters.Contains(p.Matter)).Select(p => p.Project).ToHashSet();
            void Visit(JsonElement e)
            {
                switch (e.ValueKind)
                {
                    case JsonValueKind.Object:
                        foreach (var property in e.EnumerateObject())
                        {
                            if (property.Value.ValueKind == JsonValueKind.Number && property.Value.TryGetInt64(out var id))
                            {
                                var hidden = property.Name switch
                                {
                                    "matterId" => _ids.Matters.Contains((int)id) && !persona.Matters.Contains((int)id) && !persona.HeaderOnlyMatters.Contains((int)id),
                                    "taskId" => _ids.Tasks.Contains(id) && !persona.Tasks.Contains(id),
                                    "projectId" => _ids.Projects.Contains((int)id) && !persona.Projects.Contains((int)id) && !projectsOfHeader.Contains((int)id),
                                    "assetId" => _ids.Assets.Contains((int)id) && !persona.Assets.Contains((int)id),
                                    _ => false,
                                };
                                if (hidden)
                                    _violations.Add($"{persona.Name}: {key} leaked {property.Name} {id} in {url}");
                            }

                            Visit(property.Value);
                        }

                        break;
                    case JsonValueKind.Array:
                        foreach (var item in e.EnumerateArray())
                            Visit(item);
                        break;
                }
            }

            Visit(doc.RootElement);
        }
    }

    private void Cover(string key, string persona)
    {
        if (!Covered.TryGetValue(key, out var set))
            Covered[key] = set = [];
        set.Add(persona);
    }
}
