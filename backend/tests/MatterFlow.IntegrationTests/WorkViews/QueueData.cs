using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// One seeded database shared by the Task Queue, My Work and Pod Work tests (building it through the real APIs takes a while, and the tests only read).
/// Tasks are found by title; every title is unique.
/// </summary>
public sealed class QueueData
{
    private static readonly object Gate = new();
    private static Task<QueueData>? _shared;

    private readonly Dictionary<string, long> _ids = [];

    public TaskHarness H { get; private set; } = null!;

    public World W { get; private set; } = null!;

    public int Matter2Id { get; private set; }

    public int Client1Id { get; private set; }

    public int Client2Id { get; private set; }

    public int PodA { get; private set; }

    public int PodB { get; private set; }

    public int PodC { get; private set; }

    public int TechA { get; private set; }

    public int TechB { get; private set; }

    public int TechC { get; private set; }

    public int Admin { get; private set; }

    public HttpClient TechAClient { get; private set; } = null!;

    public HttpClient TechBClient { get; private set; } = null!;

    public int Critical { get; private set; }

    public int High { get; private set; }

    public int Normal { get; private set; }

    public int Low { get; private set; }

    public DateOnly UtcToday { get; } = DateOnly.FromDateTime(DateTime.UtcNow);

    public long Id(string title) => _ids[title];

    public IReadOnlyCollection<string> Titles => _ids.Keys;

    public static Task<QueueData> GetAsync(SqlServerFixture sql)
    {
        lock (Gate)
            return _shared ??= new QueueData().BuildAsync(sql);
    }

    /// <summary>The titles on a page of any of the queue responses, in order.</summary>
    public static List<string> TitlesOf(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("title").GetString()!)];

    public static JsonElement Row(JsonElement page, string title) =>
        page.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("title").GetString() == title);

    /// <summary>The titles of the seeded Tasks in the page, in page order (other Tasks are ignored).</summary>
    public List<string> Seeded(JsonElement page) => [.. TitlesOf(page).Where(_ids.ContainsKey)];

    public async Task<JsonElement> GetAsync(string url, HttpClient? client = null, string? timeZone = null)
    {
        var http = client ?? H.Admin;
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (timeZone is not null)
            request.Headers.Add("X-Time-Zone", timeZone);
        return await OkAsync(await http.SendAsync(request));
    }

    public Task<JsonElement> QueueAsync(string query = "", HttpClient? client = null, string? timeZone = null) =>
        GetAsync("/api/v1/task-queue?pageSize=100" + (query.Length > 0 ? "&" + query : string.Empty), client, timeZone);

    private async Task<QueueData> BuildAsync(SqlServerFixture sql)
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

        var perms = TaskHarness.AllTaskPermissions.Append("Pod.View").ToArray();
        TechAClient = await H.UserWithAsync(@"KE\techa", perms);
        TechBClient = await H.UserWithAsync(@"KE\techb", perms);
        await H.UserWithAsync(@"KE\techc", perms);
        Admin = await H.UserIdAsync(DatabaseApiFactory.AdminAccount);
        TechA = await H.UserIdAsync(@"KE\techa");
        TechB = await H.UserIdAsync(@"KE\techb");
        TechC = await H.UserIdAsync(@"KE\techc");

        PodA = await H.CreatePodAsync("Pod A", TechA, TechB);
        PodB = await H.CreatePodAsync("Pod B", TechA);
        PodC = await H.CreatePodAsync("Pod C");
        await H.ExecuteAsync($"UPDATE dbo.PodMember SET IsPrimary = 1 WHERE UserId = {TechA} AND PodId = {PodA}");

        var tomorrow = UtcToday.AddDays(1).ToString("yyyy-MM-dd");

        // Ordering set: unassigned, no Pod, created in this order.
        await MakeAsync("crit-future", new() { ["priorityId"] = Critical, ["dueDate"] = "2099-01-01" });
        await MakeAsync("crit-asap-old", new() { ["priorityId"] = Critical });
        await MakeAsync("crit-overdue", new() { ["priorityId"] = Critical, ["dueDate"] = "2000-01-01" });
        await MakeAsync("crit-asap-new", new() { ["priorityId"] = Critical });
        await MakeAsync("high-asap", new() { ["priorityId"] = High });
        await MakeAsync("norm-timed-past", new() { ["dueDate"] = "2000-01-02", ["dueTime"] = "09:00" });
        await MakeAsync("norm-asap", []);
        await MakeAsync("low-future-timed", new() { ["priorityId"] = Low, ["dueDate"] = "2099-05-05", ["dueTime"] = "14:00" });

        // Assigned to tech A (My Work).
        await MakeAsync("mine-soon", new() { ["assignedUserId"] = TechA, ["dueDate"] = tomorrow });
        await MakeAsync("mine-asap", new() { ["assignedUserId"] = TechA, ["priorityId"] = High });
        await MakeAsync("mine-overdue", new() { ["assignedUserId"] = TechA, ["dueDate"] = "2000-01-03" });
        await MakeAsync("mine-far", new() { ["assignedUserId"] = TechA, ["dueDate"] = "2099-02-02" });
        await MakeAsync("mine-hold", new() { ["assignedUserId"] = TechA }, "ON_HOLD");
        await MakeAsync("mine-done", new() { ["assignedUserId"] = TechA, ["dueDate"] = "2000-02-02" }, "COMPLETED");
        await MakeAsync("mine-cancelled", new() { ["assignedUserId"] = TechA }, "CANCELLED");
        await MakeAsync("mine-pod-a", new() { ["assignedUserId"] = TechA, ["assignedPodId"] = PodA });
        await MakeAsync("mine-pod-b", new() { ["assignedUserId"] = TechA, ["assignedPodId"] = PodB });

        // Pod tasks.
        await MakeAsync("poda-queue-1", new() { ["assignedPodId"] = PodA, ["priorityId"] = High });
        await MakeAsync("poda-queue-2", new() { ["assignedPodId"] = PodA, ["dueDate"] = "2000-01-04" });
        await MakeAsync("poda-hold", new() { ["assignedPodId"] = PodA }, "ON_HOLD");
        await MakeAsync("poda-member", new() { ["assignedPodId"] = PodA, ["assignedUserId"] = TechB });
        await MakeAsync("poda-done", new() { ["assignedPodId"] = PodA }, "COMPLETED");
        await MakeAsync("podb-queue", new() { ["assignedPodId"] = PodB });
        await MakeAsync("podc-queue", new() { ["assignedPodId"] = PodC });

        // Created by tech A.
        await MakeAsync("created-by-tech", [], creator: TechAClient);
        await MakeAsync("created-by-tech-b", new() { ["assignedUserId"] = TechB }, creator: TechAClient);

        // Other Client / Matter / Project / workflow / requestor / former employee.
        await MakeAsync("other-matter", new() { ["matterId"] = Matter2Id }, unordered: true);
        await MakeAsync("with-project", new() { ["projectId"] = W.ProjectId });
        await MakeAsync("requested-by-zed", new() { ["requestorName"] = "Zed Requestor", ["requestorEmail"] = "zed@client.example" }, unordered: true);
        var pago = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTime.UtcNow, "Pacific/Pago_Pago"));
        await MakeAsync("tz-date-only", new() { ["dueDate"] = pago.ToString("yyyy-MM-dd") });
        await MakeAsync("former-employee", new() { ["assignedUserId"] = TechC });
        await H.ExecuteAsync($"UPDATE dbo.AppUser SET IsActive = 0 WHERE UserId = {TechC}");
        H.Factory.InvalidateAll();
        return this;
    }

    private async Task MakeAsync(string title, Dictionary<string, object?> extra, string? finalStatus = null, HttpClient? creator = null, bool unordered = false)
    {
        // Bulk completion needs steps without required inputs, which only the unordered workflow has.
        var body = H.NewTask(W, ordered: !(unordered || finalStatus == "COMPLETED"), title: title, extra: extra);
        var task = await OkAsync(await (creator ?? H.Admin).PostAsJsonAsync("/api/v1/tasks", body), HttpStatusCode.Created);
        var id = TaskId(task);
        _ids[title] = id;
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
