using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Search;

/// <summary>
/// One seeded database shared by the search tests (building it through the real APIs takes a while and the tests only read). Names are unique so a
/// test can find its rows in the result lists.
/// </summary>
public sealed class SearchData
{
    private static readonly object Gate = new();
    private static Task<SearchData>? _shared;

    public TaskHarness H { get; private set; } = null!;

    public World W { get; private set; } = null!;

    public HttpClient Admin => H.Admin;

    /// <summary>Client 00002 "Beta Industries" with Matter 00002-00001 (sensitive) and its related records (SCN-020).</summary>
    public int BetaClientId { get; private set; }

    public int BetaMatterId { get; private set; }

    public int BetaProjectId { get; private set; }

    public long BetaTaskId { get; private set; }

    public string BetaTaskNumber { get; private set; } = string.Empty;

    public int BetaAssetId { get; private set; }

    /// <summary>Matter 00002-00099, the decoy: same Client, different Matter, with its own related records.</summary>
    public int DecoyMatterId { get; private set; }

    public int AssetTypeLaptop { get; private set; }

    public int AssetTypeServer { get; private set; }

    /// <summary>A Task whose sequence number was reused as a Client and Matter number, so one numeric term hits all three types (FND-17).</summary>
    public long TwinTaskId { get; private set; }

    public int TwinNumber { get; private set; }

    public int TwinClientId { get; private set; }

    public int TwinMatterId { get; private set; }

    public int AcmeClientId { get; private set; }

    public HttpClient ClientOnly { get; private set; } = null!;

    public HttpClient MatterOnly { get; private set; } = null!;

    public HttpClient TaskOnly { get; private set; } = null!;

    public HttpClient AssetOnly { get; private set; } = null!;

    public HttpClient NoSearch { get; private set; } = null!;

    public static Task<SearchData> GetAsync(SqlServerFixture sql)
    {
        lock (Gate)
            return _shared ??= new SearchData().BuildAsync(sql);
    }

    public async Task<JsonElement> SearchAsync(string query, HttpClient? client = null, string extra = "")
    {
        var url = "/api/v1/search?q=" + Uri.EscapeDataString(query) + extra;
        return await OkAsync(await (client ?? Admin).GetAsync(url));
    }

    public async Task<JsonElement> AdvancedAsync(string query, HttpClient? client = null)
    {
        return await OkAsync(await (client ?? Admin).GetAsync("/api/v1/search/advanced?" + query));
    }

    /// <summary>The group of one type; null when the response has no such group.</summary>
    public static JsonElement? Group(JsonElement response, string type) =>
        response.GetProperty("groups").EnumerateArray().Where(g => g.GetProperty("type").GetString() == type).Select(g => (JsonElement?)g).FirstOrDefault();

    public static List<string> Labels(JsonElement response, string type) =>
        Group(response, type) is { } group ? [.. group.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("label").GetString()!)] : [];

    public static List<string> References(JsonElement response, string type) =>
        Group(response, type) is { } group ? [.. group.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("reference").GetString() ?? string.Empty)] : [];

    public static List<string> Types(JsonElement response) =>
        [.. response.GetProperty("groups").EnumerateArray().Select(g => g.GetProperty("type").GetString()!)];

    public static List<string> Labels(JsonElement advancedPage) =>
        [.. advancedPage.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("label").GetString()!)];

    public async Task<int> CreateClientAsync(string number, string name)
    {
        var client = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/clients", new { clientNumber = number, name }), HttpStatusCode.Created);
        return client.GetProperty("clientId").GetInt32();
    }

    public async Task<int> CreateMatterAsync(int clientId, string number, string name, bool sensitive = false)
    {
        var matter = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = number, name, isSensitive = sensitive }), HttpStatusCode.Created);
        return matter.GetProperty("matterId").GetInt32();
    }

    public async Task<JsonElement> CreateTaskAsync(int matterId, string title, string requestor = "Pat Partner", int? projectId = null)
    {
        var body = H.NewTask(W, title: title, extra: new() { ["matterId"] = matterId, ["requestorName"] = requestor, ["projectId"] = projectId });
        return await OkAsync(await Admin.PostAsJsonAsync("/api/v1/tasks", body), HttpStatusCode.Created);
    }

    public async Task<int> CreateAssetAsync(int matterId, int typeId, string name, string? externalReference = null)
    {
        var asset = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/assets", new { matterId, assetTypeId = typeId, displayName = name, externalReference }), HttpStatusCode.Created);
        return asset.GetProperty("assetId").GetInt32();
    }

    private async Task<SearchData> BuildAsync(SqlServerFixture sql)
    {
        var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        H = new TaskHarness(factory);
        W = await H.CreateWorldAsync(); // Client 00343 "Acme Corp 343", Matter 00343-00012 "Merger Review 12", Project "Phase 1"
        AcmeClientId = await H.ScalarAsync("SELECT ClientId AS [Value] FROM dbo.Matter WHERE MatterId = " + W.MatterId);

        AssetTypeLaptop = (await OkAsync(await Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created)).GetProperty("assetTypeId").GetInt32();
        AssetTypeServer = (await OkAsync(await Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Server" }), HttpStatusCode.Created)).GetProperty("assetTypeId").GetInt32();

        // SCN-020 data: Matter 00002-00001 with a Project, a Task and an Asset, and a decoy Matter 00002-00099 with its own.
        BetaClientId = await CreateClientAsync("2", "Beta Industries");
        BetaMatterId = await CreateMatterAsync(BetaClientId, "1", "Beta Litigation", sensitive: true);
        DecoyMatterId = await CreateMatterAsync(BetaClientId, "99", "Beta Other Matter");
        BetaProjectId = await H.CreateProjectAsync(BetaMatterId, "Beta Phase");
        await H.CreateProjectAsync(DecoyMatterId, "Decoy Phase");
        var betaTask = await CreateTaskAsync(BetaMatterId, "Collect beta documents", "Rita Requestor");
        BetaTaskId = TaskId(betaTask);
        BetaTaskNumber = betaTask.GetProperty("taskNumber").GetString()!;
        await CreateTaskAsync(DecoyMatterId, "Collect decoy documents", "Dora Decoy");
        BetaAssetId = await CreateAssetAsync(BetaMatterId, AssetTypeLaptop, "Beta custodian laptop", "EVID-0002");
        await CreateAssetAsync(DecoyMatterId, AssetTypeServer, "Decoy file server", "EXT-99");

        // Other Matters of Acme (00343) and of a Client whose number extends it.
        await CreateMatterAsync(AcmeClientId, "13", "Acme second matter");
        var zeta = await CreateClientAsync("34", "Zeta Thirty Four");
        await CreateMatterAsync(zeta, "1", "Zeta Matter");

        // Ranking: whole name, start, word start, inside.
        await CreateClientAsync("501", "Orbit");
        await CreateClientAsync("502", "Orbit Holdings");
        await CreateClientAsync("503", "Big Orbit Group");
        await CreateClientAsync("504", "Reorbital Ltd");

        // LIKE wildcards in names.
        await CreateClientAsync("601", "Rate 100% [Final]_Set");
        await CreateClientAsync("602", "Rate 100 Final Set X");
        await CreateClientAsync("603", @"Back\slash Corp");

        // FND-17: a Task number reused as a Client number and as a Matter number.
        var twin = await CreateTaskAsync(W.MatterId, "Number twin task", "Terry Twin");
        TwinTaskId = TaskId(twin);
        TwinNumber = int.Parse(twin.GetProperty("taskNumber").GetString()!["TSK-".Length..]);
        TwinClientId = await CreateClientAsync(TwinNumber.ToString(), "Twin Client");
        TwinMatterId = await CreateMatterAsync(TwinClientId, TwinNumber.ToString(), "Twin Matter");

        // Requestor-only and asset-only text.
        await CreateTaskAsync(W.MatterId, "Quarterly report", "Zelda Requestor");

        // Users: each holds one View permission (plus what they need to be provisioned).
        ClientOnly = await H.UserWithAsync(@"KE\clientonly", "Client.View");
        MatterOnly = await H.UserWithAsync(@"KE\matteronly", "Matter.View");
        TaskOnly = await H.UserWithAsync(@"KE\taskonly", "Task.View");
        AssetOnly = await H.UserWithAsync(@"KE\assetonly", "Asset.View");
        NoSearch = await H.UserWithAsync(@"KE\nosearch", "Pod.View");
        return this;
    }
}
