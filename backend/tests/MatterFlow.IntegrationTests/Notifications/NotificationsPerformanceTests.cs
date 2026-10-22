using System.Diagnostics;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Notifications;

/// <summary>
/// Poll and list against 100,000 notification rows (#733): a person with a large inbox and 49 others; the poll must stay cheap (server and request
/// time are measured together here, so the budget is generous) and the unread count never scans more than 100 rows.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class NotificationsPerformanceTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private HttpClient _ann = null!;
    private int _annId;
    private long _taskId;
    private int _matterId;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var h = new TaskHarness(_factory);
        var w = await h.CreateWorldAsync();
        _matterId = w.MatterId;
        _taskId = TaskId(await h.CreateTaskAsync(w));
        _ann = await h.UserWithAsync(@"KE\ann", "Task.View");
        _annId = await h.UserIdAsync(@"KE\ann");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task Poll_p95_stays_low_with_100000_rows()
    {
        var annId = _annId;
        var taskId = _taskId;
        var matterId = _matterId;
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync($@"
            WITH n AS (SELECT TOP (100000) ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b)
            INSERT dbo.Notification (RecipientUserId, EventType, ObjectKind, ObjectId, MatterId, Message, DedupeKey, CreatedUtc, ReadUtc)
            SELECT {annId}, 'TaskAssigned', 'Task', {taskId}, {matterId}, N'Ann Lee assigned you TSK-1 ""x"" (m).', CAST(i AS NVARCHAR(20)),
                   DATEADD(SECOND, i, '2026-01-01'), CASE WHEN i % 10 = 0 THEN NULL ELSE DATEADD(SECOND, i + 5, '2026-01-01') END FROM n"));

        await OkAsync(await _ann.GetAsync("/api/v1/me/notifications/poll?initial=true"));
        var times = new List<long>();
        for (var i = 0; i < 40; i++)
        {
            var watch = Stopwatch.StartNew();
            var body = await OkAsync(await _ann.GetAsync("/api/v1/me/notifications/poll?sinceId=99990"));
            watch.Stop();
            times.Add(watch.ElapsedMilliseconds);
            body.GetProperty("unreadCount").GetInt32().ShouldBe(100);
        }

        var p95 = times.Order().ElementAt((int)(times.Count * 0.95) - 1);
        output.WriteLine($"poll with 100,000 rows: median {times.Order().ElementAt(20)} ms, p95 {p95} ms");
        p95.ShouldBeLessThan(250);

        var list = Stopwatch.StartNew();
        var page = await OkAsync(await _ann.GetAsync("/api/v1/me/notifications?pageSize=10"));
        list.Stop();
        output.WriteLine($"first page of the list: {list.ElapsedMilliseconds} ms, total {page.GetProperty("totalCount").GetInt32()}");
        page.GetProperty("items").GetArrayLength().ShouldBe(10);
    }
}
