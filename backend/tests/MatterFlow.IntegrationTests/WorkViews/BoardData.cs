using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// One seeded database shared by the Swimlane and Team workload tests (they only read). Tasks are found by title; every title is unique.
/// Closed Tasks get their status change time set with SQL so the 7-day window can be probed exactly.
/// </summary>
public sealed class BoardData
{
    private static readonly object Gate = new();
    private static Task<BoardData>? _shared;

    private readonly Dictionary<string, long> _ids = [];

    public TaskHarness H { get; private set; } = null!;

    public World W { get; private set; } = null!;

    public int Matter2Id { get; private set; }

    public int Client1Id { get; private set; }

    public int Client2Id { get; private set; }

    public int PodA { get; private set; }

    public int Admin { get; private set; }

    public int TechA { get; private set; }

    public int TechB { get; private set; }

    public int Director { get; private set; }

    public int Scientist { get; private set; }

    public int Pending { get; private set; }

    public int Inactive { get; private set; }

    public int Critical { get; private set; }

    public int High { get; private set; }

    public int Normal { get; private set; }

    public int Low { get; private set; }

    public HttpClient TechAClient { get; private set; } = null!;

    public HttpClient NoDashboardClient { get; private set; } = null!;

    public long Id(string title) => _ids[title];

    public static Task<BoardData> GetAsync(SqlServerFixture sql)
    {
        lock (Gate)
            return _shared ??= new BoardData().BuildAsync(sql);
    }

    public async Task<JsonElement> GetAsync(string url, HttpClient? client = null, string? timeZone = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (timeZone is not null)
            request.Headers.Add("X-Time-Zone", timeZone);
        return await OkAsync(await (client ?? H.Admin).SendAsync(request));
    }

    public static List<string> Titles(JsonElement lane) => [.. lane.GetProperty("cards").EnumerateArray().Select(c => c.GetProperty("title").GetString()!)];

    public static JsonElement Lane(JsonElement board, string status) =>
        board.GetProperty("lanes").EnumerateArray().Single(l => l.GetProperty("status").GetString() == status);

    /// <summary>The titles of the seeded Tasks in a lane, in order.</summary>
    public List<string> Seeded(JsonElement board, string status) => [.. Titles(Lane(board, status)).Where(_ids.ContainsKey)];

    public Task SetClosedAsync(string title, string status, DateTime changedAtUtc) =>
        H.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = '{status}', StatusChangedAt = '{changedAtUtc:yyyy-MM-ddTHH:mm:ss.fff}', CompletedAt = '{changedAtUtc:yyyy-MM-ddTHH:mm:ss.fff}' WHERE TaskId = {_ids[title]}");

    private async Task<BoardData> BuildAsync(SqlServerFixture sql)
    {
        var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        H = new TaskHarness(factory);
        W = await H.CreateWorldAsync();
        Matter2Id = await H.CreateMatterAsync("500", "7");
        Client1Id = await H.ScalarAsync("SELECT ClientId AS [Value] FROM dbo.Matter WHERE MatterId = " + W.MatterId);
        Client2Id = await H.ScalarAsync("SELECT ClientId AS [Value] FROM dbo.Matter WHERE MatterId = " + Matter2Id);

        var priorities = await OkAsync(await H.Admin.GetAsync("/api/v1/priorities"));
        int PriorityId(string label) => priorities.EnumerateArray().First(p => p.GetProperty("label").GetString() == label).GetProperty("id").GetInt32();
        Critical = PriorityId("Critical");
        High = PriorityId("High");
        Normal = PriorityId("Normal");
        Low = PriorityId("Low");

        var perms = TaskHarness.AllTaskPermissions.Append("Pod.View").Append("Dashboard.ViewDepartment").ToArray();
        TechAClient = await H.UserWithAsync(@"KE\techa", perms);
        await H.UserWithAsync(@"KE\techb", TaskHarness.AllTaskPermissions);
        NoDashboardClient = H.As(@"KE\techb");
        await H.UserWithAsync(@"KE\techc", TaskHarness.AllTaskPermissions);
        await H.As(@"KE\pendingperson").GetAsync("/api/v1/me");
        Admin = await H.UserIdAsync(DatabaseApiFactory.AdminAccount);
        TechA = await H.UserIdAsync(@"KE\techa");
        TechB = await H.UserIdAsync(@"KE\techb");
        Inactive = await H.UserIdAsync(@"KE\techc");
        Pending = await H.UserIdAsync(@"KE\pendingperson");
        Director = await H.UserIdAsync(@"KE\director");
        Scientist = await H.UserIdAsync(@"KE\scientist");
        PodA = await H.CreatePodAsync("Board Pod A", TechA, TechB);

        var tomorrow = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1).ToString("yyyy-MM-dd");
        // Assigning a person starts a Task (NEW -> IN_PROGRESS), so NEW Tasks have no person.
        await MakeAsync("sw-new-crit-asap", new() { ["priorityId"] = Critical, ["assignedPodId"] = PodA });
        await MakeAsync("sw-new-overdue", new() { ["priorityId"] = Normal, ["dueDate"] = "2000-01-01" });
        await MakeAsync("sw-new-low-future", new() { ["priorityId"] = Low, ["dueDate"] = "2099-01-01" });
        await MakeAsync("sw-new-high-tomorrow", new() { ["priorityId"] = High, ["dueDate"] = tomorrow });
        await MakeAsync("sw-other-client", new() { ["matterId"] = Matter2Id, ["priorityId"] = Normal });
        await MakeAsync("sw-prog", new() { ["priorityId"] = High, ["assignedUserId"] = TechB, ["dueDate"] = tomorrow });
        await MakeAsync("sw-prog-a", new() { ["priorityId"] = Critical, ["assignedUserId"] = TechA, ["assignedPodId"] = PodA });
        await MakeAsync("sw-prog-low", new() { ["priorityId"] = Low, ["assignedUserId"] = TechB, ["dueDate"] = "2099-01-01" });
        await MakeAsync("sw-hold", new() { ["priorityId"] = Critical, ["assignedUserId"] = TechA, ["dueDate"] = "2000-03-03" }, "ON_HOLD");
        await MakeAsync("sw-done-today", [], "COMPLETED");
        await MakeAsync("sw-done-3d", new() { ["assignedUserId"] = TechA }, "COMPLETED");
        await MakeAsync("sw-done-10d", [], "COMPLETED");
        await MakeAsync("sw-cancelled", [], "CANCELLED");
        await SetClosedAsync("sw-done-3d", "COMPLETED", DateTime.UtcNow.AddDays(-3));
        await SetClosedAsync("sw-done-10d", "COMPLETED", DateTime.UtcNow.AddDays(-10));

        // Tech A is out of office; the cards of their Tasks show it.
        var own = await OkAsync(await TechAClient.GetAsync("/api/v1/me/availability"));
        await OkAsync(await TechAClient.PutAsJsonAsync("/api/v1/me/availability", new { status = "OUT_OF_OFFICE", until = "2099-12-31", note = "Conference", rowVersion = own.GetProperty("rowVersion").GetString() }));

        await H.ExecuteAsync($"UPDATE dbo.AppUser SET IsActive = 0 WHERE UserId = {Inactive}");
        H.Factory.InvalidateAll();
        return this;
    }

    private async Task MakeAsync(string title, Dictionary<string, object?> extra, string? finalStatus = null)
    {
        var body = H.NewTask(W, ordered: finalStatus != "COMPLETED", title: title, extra: extra);
        var task = await OkAsync(await H.Admin.PostAsJsonAsync("/api/v1/tasks", body), System.Net.HttpStatusCode.Created);
        _ids[title] = TaskId(task);
        switch (finalStatus)
        {
            case "ON_HOLD":
                await H.StatusAsync(task, "ON_HOLD", "Waiting for the client");
                break;
            case "CANCELLED":
                await H.StatusAsync(task, "CANCELLED", "No longer needed");
                break;
            case "COMPLETED":
                await H.CompleteAsync(task);
                break;
        }
    }
}
