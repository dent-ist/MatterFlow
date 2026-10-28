using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// The matters, managers and tasks the My Matters API tests read (epic #667, WP-PM2). Two project managers A and B, a technician, a director who may
/// assign managers, an observer and a manager without Task.View. Dates are relative to today with a margin of a day so the viewer's time zone cannot
/// move a task over a boundary. Every test class builds its own database.
/// </summary>
public abstract class MyMattersTestBase(SqlServerFixture sql) : IAsyncLifetime
{
    protected TaskHarness H { get; private set; } = null!;

    protected TaskHarness.World W { get; private set; } = null!;

    protected int PmA { get; private set; }

    protected int PmB { get; private set; }

    protected int Tech { get; private set; }

    protected int PodX { get; private set; }

    /// <summary>A is Primary.</summary>
    protected int M1 { get; private set; }

    /// <summary>B is Primary, A is Secondary.</summary>
    protected int M2 { get; private set; }

    /// <summary>No manager at all.</summary>
    protected int M3 { get; private set; }

    /// <summary>A is Primary, B is Secondary; another client.</summary>
    protected int M4 { get; private set; }

    /// <summary>A is Primary but the matter is inactive.</summary>
    protected int M5 { get; private set; }

    /// <summary>A is Primary and the matter has no tasks.</summary>
    protected int M6 { get; private set; }

    protected HttpClient A { get; private set; } = null!;

    protected HttpClient B { get; private set; } = null!;

    protected HttpClient TechClient { get; private set; } = null!;

    protected HttpClient Director { get; private set; } = null!;

    protected HttpClient Observer { get; private set; } = null!;

    protected HttpClient NoTaskView { get; private set; } = null!;

    protected Dictionary<string, long> Ids { get; } = [];

    public static string In(int days) => ViewerDay.Today().AddDays(days).ToString("yyyy-MM-dd");

    public virtual async Task InitializeAsync()
    {
        H = new TaskHarness(new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { Clock = ViewerDay.HostClock });
        W = await H.CreateWorldAsync();
        string[] pm = ["Task.View", "Matter.View", "Matter.BeManager"];
        A = await H.UserWithAsync(@"KE\pma", pm);
        B = await H.UserWithAsync(@"KE\pmb", pm);
        TechClient = await H.UserWithAsync(@"KE\tech", "Task.View", "Matter.View");
        Director = await H.UserWithAsync(@"KE\director", "Task.View", "Matter.View", "Matter.AssignManagers");
        Observer = await H.UserWithAsync(@"KE\observer", "Task.View", "Matter.View");
        NoTaskView = await H.UserWithAsync(@"KE\notasks", "Matter.View", "Matter.BeManager");
        PmA = await H.UserIdAsync(@"KE\pma");
        PmB = await H.UserIdAsync(@"KE\pmb");
        Tech = await H.UserIdAsync(@"KE\tech");
        PodX = await H.CreatePodAsync("Pod X", Tech);

        M1 = W.MatterId;
        M2 = await H.CreateMatterAsync("343", "13");
        M3 = await H.CreateMatterAsync("343", "14");
        M4 = await H.CreateMatterAsync("344", "15");
        M5 = await H.CreateMatterAsync("344", "16");
        M6 = await H.CreateMatterAsync("343", "17");
        await H.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {PmA} WHERE MatterId IN ({M1}, {M5}, {M6})");
        await H.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {PmB}, SecondaryManagerId = {PmA} WHERE MatterId = {M2}");
        await H.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {PmA}, SecondaryManagerId = {PmB} WHERE MatterId = {M4}");
        await H.SetMatterActiveAsync(M5, false);

        await MakeAsync("m1-soon", M1, new() { ["dueDate"] = In(2) });
        await MakeAsync("m1-overdue", M1, new() { ["dueDate"] = "2000-01-01" });
        await MakeAsync("m1-asap", M1, []);
        await MakeAsync("m1-hold", M1, [], "ON_HOLD");
        await MakeAsync("m2-in5", M2, new() { ["dueDate"] = In(5) });
        await MakeAsync("m2-far", M2, new() { ["dueDate"] = "2099-01-01" });
        await MakeAsync("m2-hold", M2, [], "ON_HOLD");
        await MakeAsync("m3-overdue", M3, new() { ["dueDate"] = "2000-01-01" });
        await MakeAsync("m4-ok", M4, new() { ["dueDate"] = "2099-01-01", ["assignedPodId"] = PodX, ["assignedUserId"] = Tech });
        await H.ExecuteAsync("UPDATE dbo.Task SET StatusChangedAt = DATEADD(day, -10, SYSUTCDATETIME()) WHERE Title = 'm1-hold'");
        await H.ExecuteAsync("UPDATE dbo.Task SET StatusChangedAt = DATEADD(day, -2, SYSUTCDATETIME()) WHERE Title = 'm2-hold'");
        H.Factory.InvalidateAll();
    }

    public async Task DisposeAsync() => await H.Factory.DisposeAsync();

    protected async Task<JsonElement> MakeAsync(string title, int matterId, Dictionary<string, object?> extra, string? finalStatus = null)
    {
        extra["matterId"] = matterId;
        var task = await OkAsync(await H.Admin.PostAsJsonAsync("/api/v1/tasks", H.NewTask(W, ordered: false, title: title, extra: extra)), HttpStatusCode.Created);
        Ids[title] = TaskId(task);
        return finalStatus == "ON_HOLD" ? await H.StatusAsync(task, "ON_HOLD", "Waiting for the client") : task;
    }

    protected static Task<JsonElement> GetAsync(HttpClient client, string url) => client.GetAsync(url).ContinueWith(t => OkAsync(t.Result)).Unwrap();

    protected Task<JsonElement> Mine(string path, HttpClient? client = null) => GetAsync(client ?? A, "/api/v1/my-matters/" + path);

    protected static List<string> Titles(JsonElement items) => [.. items.EnumerateArray().Select(i => i.GetProperty("title").GetString()!)];

    /// <summary>The total of the Task Queue (or Matters list) for a count's query string, read by the same person.</summary>
    protected static async Task<int> TotalAsync(HttpClient client, string path, string query) =>
        (await OkAsync(await client.GetAsync($"/api/v1/{path}?pageSize=1&{query}"))).GetProperty("total").GetInt32();
}
