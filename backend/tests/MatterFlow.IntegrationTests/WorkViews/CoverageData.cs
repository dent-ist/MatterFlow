using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// One seeded database for the coverage tests. Completed Tasks get their completion time set with SQL so the period and zone boundaries can be
/// probed exactly. Task Type 1 was completed by A (x2 in 30 days, one 40 days ago) and B, type 2 by A and B, type 3 only by an inactive person.
/// </summary>
public sealed class CoverageData
{
    private readonly Dictionary<string, long> _ids = [];

    public TaskHarness H { get; private set; } = null!;

    public World W { get; private set; } = null!;

    public int Type1 { get; private set; }

    public int Type2 { get; private set; }

    public int Type3 { get; private set; }

    public int TypeNobody { get; private set; }

    public int TechA { get; private set; }

    public int TechB { get; private set; }

    public int TechC { get; private set; }

    public int TechD { get; private set; }

    public int Pending { get; private set; }

    public int InactiveQuiet { get; private set; }

    public int Pod { get; private set; }

    public HttpClient CoverageClient { get; private set; } = null!;

    public HttpClient NoCoverageClient { get; private set; } = null!;

    public async Task<JsonElement> GetAsync(string url, string? timeZone = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (timeZone is not null)
            request.Headers.Add("X-Time-Zone", timeZone);
        return await OkAsync(await H.Admin.SendAsync(request));
    }

    public async Task<CoverageData> BuildAsync(SqlServerFixture sql)
    {
        H = new TaskHarness(new DatabaseApiFactory(await sql.CreateDatabaseAsync()));
        W = await H.CreateWorldAsync();
        Type1 = W.TaskTypeId;
        Type2 = await H.CreateTaskTypeAsync("Coverage Review", [W.OrderedWorkflowId, W.UnorderedWorkflowId]);
        Type3 = await H.CreateTaskTypeAsync("Coverage Archive", [W.OrderedWorkflowId, W.UnorderedWorkflowId]);
        TypeNobody = await H.CreateTaskTypeAsync("Coverage Nobody", [W.OrderedWorkflowId, W.UnorderedWorkflowId]);

        var viewer = TaskHarness.AllTaskPermissions.Concat(new[] { "Dashboard.View", "Dashboard.ViewUsers" }).ToArray();
        await H.UserWithAsync(@"KE\cova", viewer);
        await H.UserWithAsync(@"KE\covb", viewer);
        await H.UserWithAsync(@"KE\covc", viewer);
        await H.UserWithAsync(@"KE\covd", viewer);
        await H.UserWithAsync(@"KE\covquiet", viewer);
        CoverageClient = await H.UserWithAsync(@"KE\covviewer", viewer.Append("Dashboard.ViewCoverage").ToArray());
        NoCoverageClient = H.As(@"KE\cova");
        await H.As(@"KE\covpending").GetAsync("/api/v1/me");
        TechA = await H.UserIdAsync(@"KE\cova");
        TechB = await H.UserIdAsync(@"KE\covb");
        TechC = await H.UserIdAsync(@"KE\covc");
        TechD = await H.UserIdAsync(@"KE\covd");
        InactiveQuiet = await H.UserIdAsync(@"KE\covquiet");
        Pending = await H.UserIdAsync(@"KE\covpending");
        Pod = await H.CreatePodAsync("Coverage Pod", TechA, TechB);

        var now = DateTime.UtcNow;
        await CompletedAsync("a1-1", Type1, TechA, now.AddDays(-1));
        await CompletedAsync("a1-2", Type1, TechA, now.AddDays(-2));
        await CompletedAsync("a1-old", Type1, TechA, now.AddDays(-40));
        await CompletedAsync("a2-1", Type2, TechA, now.AddDays(-5));
        await CompletedAsync("b1-1", Type1, TechB, now.AddDays(-3));
        await CompletedAsync("b2-1", Type2, TechB, now.AddDays(-4));
        await CompletedAsync("b2-2", Type2, TechB, now.AddDays(-4));
        await CompletedAsync("c3-1", Type3, TechC, now.AddDays(-6));
        await CompletedAsync("unassigned-1", Type1, null, now.AddDays(-1));
        await CompletedAsync("boundary", Type1, TechD, new DateTime(2025, 3, 10, 10, 0, 0, DateTimeKind.Utc));
        await CompletedAsync("cancelled-a", Type1, TechA, now.AddDays(-1), cancel: true);
        await OpenAsync("open-b3", Type3, TechB);

        await H.ExecuteAsync($"UPDATE dbo.AppUser SET IsActive = 0 WHERE UserId IN ({TechC}, {InactiveQuiet})");
        H.Factory.InvalidateAll();
        return this;
    }

    private async Task<JsonElement> NewAsync(string title, int typeId, int? assignee)
    {
        var extra = new Dictionary<string, object?>();
        if (assignee is { } a)
            extra["assignedUserId"] = a;
        var body = H.NewTask(W with { TaskTypeId = typeId }, ordered: false, title: title, extra: extra);
        var task = await OkAsync(await H.Admin.PostAsJsonAsync("/api/v1/tasks", body), System.Net.HttpStatusCode.Created);
        _ids[title] = TaskId(task);
        return task;
    }

    private Task OpenAsync(string title, int typeId, int? assignee) => NewAsync(title, typeId, assignee);

    private async Task CompletedAsync(string title, int typeId, int? assignee, DateTime completedAtUtc, bool cancel = false)
    {
        var task = await NewAsync(title, typeId, assignee);
        string status;
        if (cancel)
        {
            await H.StatusAsync(task, "CANCELLED", "No longer needed");
            status = "CANCELLED";
        }
        else
        {
            await H.CompleteAsync(task);
            status = "COMPLETED";
        }

        await H.ExecuteAsync($"UPDATE dbo.Task SET StatusCode = '{status}', StatusChangedAt = '{completedAtUtc:yyyy-MM-ddTHH:mm:ss.fff}', CompletedAt = {(cancel ? "NULL" : $"'{completedAtUtc:yyyy-MM-ddTHH:mm:ss.fff}'")} WHERE TaskId = {_ids[title]}");
    }
}
