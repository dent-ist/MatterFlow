using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>
/// The data of the Project Manager experience work (epic #758, PX-01, issue #759; spec docs/ux/pm-experience/README.md section 3): who manages what,
/// built through the public API (managers through <c>PUT /matters/{id}/managers</c>, so the audit trail is real) on top of a <see cref="TaskHarness"/>.
/// Reusable by every integration test of the epic and by the sensitive-matter tests of epic #788 (the "sensitive-ready" matters carry the flag).
/// <code>
/// var fx = await PmScopeFixture.BuildAsync(new DatabaseApiFactory(await sql.CreateDatabaseAsync()));
/// (await fx.PmFew.GetAsync("/api/v1/matters?managedByMe=true")) // the three matters of PM Few
/// </code>
/// People (all hold the roles named, created per database):
/// <list type="bullet">
/// <item><c>PmFew</c> manages 3 matters, <c>PmMany</c> 40, <c>PmNone</c> none (a PM with an empty scope); <c>PmOther</c> is a second PM who shares some matters.</item>
/// <item><c>PmNoTaskView</c> holds Matter.View, Matter.BeManager and Matter.AssignManagers but not Task.View.</item>
/// <item><c>Director</c> holds Matter.AssignManagers (may use scope=all) and cannot be named a manager; <c>Technician</c> works tasks and has no manager permission.</item>
/// </list>
/// Matters (keys in <see cref="Matters"/>): <c>few1</c> Primary PmFew; <c>few2</c> Secondary PmFew (Primary PmOther); <c>few3</c> both PmFew and PmOther;
/// <c>many01</c> to <c>many40</c> Primary PmMany (every fifth has PmOther as Secondary); <c>primaryOnly</c> Primary PmOther only;
/// <c>secondaryOnly</c> Secondary PmOther, no Primary; <c>none1</c>, <c>none2</c> no manager (normal, nothing flagged);
/// <c>sensitiveManaged</c> flagged sensitive with Primary PmOther; <c>sensitiveOpen</c> flagged sensitive with no manager; <c>sensitiveOther</c> flagged sensitive, Secondary PmOther only. So PmFew manages exactly 3 matters and PmMany exactly 40.
/// Clients: <c>Managed</c> (matters of PmFew and PmOther, nothing of PmMany), <c>Mixed</c> (managed and unmanaged matters), <c>Unmanaged</c> (no matter any PM manages).
/// Every managed and unmanaged matter has a project; the matters named in <see cref="Assets"/> have two assets each; <c>few1</c>, <c>many01</c>, <c>primaryOnly</c>,
/// <c>none1</c> and <c>sensitiveManaged</c> have one task; the tasks of <c>none1</c> and <c>sensitiveManaged</c> are assigned to the technician (an assignee of a task on a sensitive matter).
/// The flag column is data only: with <c>Features:SensitiveMatterAccess</c> off nothing in the product changes because of it.
/// </summary>
public sealed class PmScopeFixture
{
    private PmScopeFixture(TaskHarness harness) => Harness = harness;

    public TaskHarness Harness { get; }

    public HttpClient Admin => Harness.Admin;

    public HttpClient PmFew { get; private set; } = null!;

    public HttpClient PmMany { get; private set; } = null!;

    public HttpClient PmNone { get; private set; } = null!;

    public HttpClient PmOther { get; private set; } = null!;

    public HttpClient PmNoTaskView { get; private set; } = null!;

    public HttpClient Director { get; private set; } = null!;

    public HttpClient Technician { get; private set; } = null!;

    public int PmFewId { get; private set; }

    public int PmManyId { get; private set; }

    public int PmNoneId { get; private set; }

    public int PmOtherId { get; private set; }

    public int TechnicianId { get; private set; }

    /// <summary>Matter id by key (see the class summary).</summary>
    public Dictionary<string, int> Matters { get; } = [];

    /// <summary>Client id by key: <c>Managed</c>, <c>Mixed</c>, <c>Unmanaged</c>.</summary>
    public Dictionary<string, int> Clients { get; } = [];

    /// <summary>Project id by matter key.</summary>
    public Dictionary<string, int> Projects { get; } = [];

    /// <summary>Asset ids by matter key.</summary>
    public Dictionary<string, List<int>> Assets { get; } = [];

    /// <summary>Task id by matter key.</summary>
    public Dictionary<string, long> Tasks { get; } = [];

    public TaskHarness.World World { get; private set; } = null!;

    /// <summary>Keys of the matters the person manages, as Primary, Secondary or either (<paramref name="role"/> null).</summary>
    public IReadOnlyList<string> ManagedKeys(int userId, string? role = null) =>
        [.. _managers.Where(kv => (role != "secondary" && kv.Value.Primary == userId) || (role != "primary" && kv.Value.Secondary == userId)).Select(kv => kv.Key).Order(StringComparer.Ordinal)];

    private readonly Dictionary<string, (int? Primary, int? Secondary)> _managers = [];

    public IReadOnlyList<string> SensitiveKeys { get; } = ["sensitiveManaged", "sensitiveOpen", "sensitiveOther"];

    public static async Task<PmScopeFixture> BuildAsync(DatabaseApiFactory factory)
    {
        var fx = new PmScopeFixture(new TaskHarness(factory));
        await fx.InitAsync();
        return fx;
    }

    private async Task InitAsync()
    {
        var h = Harness;
        World = await h.CreateWorldAsync();

        string[] view = ["Task.View", "Matter.View", "Client.View", "Project.View", "Asset.View", "Asset.Create", "Asset.Link"];
        PmFew = await h.UserWithAsync(@"KE\pmfew", [.. view, "Matter.BeManager"]);
        PmMany = await h.UserWithAsync(@"KE\pmmany", [.. view, "Matter.BeManager"]);
        PmNone = await h.UserWithAsync(@"KE\pmnone", [.. view, "Matter.BeManager"]);
        PmOther = await h.UserWithAsync(@"KE\pmother", [.. view, "Matter.BeManager"]);
        PmNoTaskView = await h.UserWithAsync(@"KE\pmnotask", "Matter.View", "Matter.BeManager", "Matter.AssignManagers");
        Director = await h.UserWithAsync(@"KE\fxdirector", [.. view, "Matter.AssignManagers"]);
        Technician = await h.UserWithAsync(@"KE\technician", view);
        PmFewId = await h.UserIdAsync(@"KE\pmfew");
        PmManyId = await h.UserIdAsync(@"KE\pmmany");
        PmNoneId = await h.UserIdAsync(@"KE\pmnone");
        PmOtherId = await h.UserIdAsync(@"KE\pmother");
        TechnicianId = await h.UserIdAsync(@"KE\technician");

        Clients["Managed"] = await ClientAsync("401", "Managed Client");
        Clients["Mixed"] = await ClientAsync("402", "Mixed Client");
        Clients["Unmanaged"] = await ClientAsync("403", "Unmanaged Client");

        var number = 0;
        async Task<int> MatterAsync(string key, string client, int? primary, int? secondary, bool sensitive = false)
        {
            var clientId = Clients[client];
            var created = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/matters", new { clientId, matterNumber = (++number + 100).ToString("00000", System.Globalization.CultureInfo.InvariantCulture), name = "PX " + key }), HttpStatusCode.Created);
            var id = created.GetProperty("matterId").GetInt32();
            if (primary is not null || secondary is not null)
                await OkAsync(await Admin.PutAsJsonAsync($"/api/v1/matters/{id}/managers", new { primaryManagerId = primary, secondaryManagerId = secondary, rowVersion = created.GetProperty("rowVersion").GetString() }));
            if (sensitive)
                await h.ExecuteAsync($"UPDATE dbo.Matter SET IsSensitive = 1 WHERE MatterId = {id}");
            Matters[key] = id;
            _managers[key] = (primary, secondary);
            Projects[key] = await h.CreateProjectAsync(id, "Project of " + key);
            return id;
        }

        await MatterAsync("few1", "Managed", PmFewId, null);
        await MatterAsync("few2", "Managed", PmOtherId, PmFewId);
        await MatterAsync("few3", "Managed", PmFewId, PmOtherId);
        for (var i = 1; i <= 40; i++)
            await MatterAsync($"many{i:00}", "Mixed", PmManyId, i % 5 == 0 ? PmOtherId : null);
        await MatterAsync("primaryOnly", "Mixed", PmOtherId, null);
        await MatterAsync("secondaryOnly", "Mixed", null, PmOtherId);
        await MatterAsync("none1", "Unmanaged", null, null);
        await MatterAsync("none2", "Unmanaged", null, null);
        await MatterAsync("sensitiveManaged", "Managed", PmOtherId, null, sensitive: true);
        await MatterAsync("sensitiveOpen", "Unmanaged", null, null, sensitive: true);
        await MatterAsync("sensitiveOther", "Mixed", null, PmOtherId, sensitive: true);

        // Two assets on managed and unmanaged matters of different clients.
        var assetType = (await OkAsync(await Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created)).GetProperty("assetTypeId").GetInt32();
        foreach (var key in new[] { "few1", "few2", "many01", "many02", "primaryOnly", "none1", "sensitiveManaged" })
        {
            Assets[key] = [];
            for (var i = 1; i <= 2; i++)
            {
                var asset = await OkAsync(await Admin.PostAsJsonAsync("/api/v1/assets", new { matterId = Matters[key], assetTypeId = assetType, displayName = $"Asset {i} of {key}" }), HttpStatusCode.Created);
                Assets[key].Add(asset.GetProperty("assetId").GetInt32());
            }
        }

        foreach (var key in new[] { "few1", "many01", "primaryOnly", "none1", "sensitiveManaged" })
        {
            var extra = new Dictionary<string, object?> { ["matterId"] = Matters[key], ["projectId"] = Projects[key] };
            if (key is "none1" or "sensitiveManaged")
                extra["assignedUserId"] = TechnicianId;
            Tasks[key] = TaskId(await h.CreateTaskAsync(World, false, extra));
        }

        h.Factory.InvalidateAll();
    }

    private async Task<int> ClientAsync(string number, string name) =>
        (await OkAsync(await Admin.PostAsJsonAsync("/api/v1/clients", new { clientNumber = number, name }), HttpStatusCode.Created)).GetProperty("clientId").GetInt32();

    /// <summary>The matter ids of the <c>items</c> of a list answer, sorted.</summary>
    public static int[] MatterIds(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("matterId").GetInt32()).Order()];

    public int[] IdsOf(IEnumerable<string> keys) => [.. keys.Select(k => Matters[k]).Order()];
}
