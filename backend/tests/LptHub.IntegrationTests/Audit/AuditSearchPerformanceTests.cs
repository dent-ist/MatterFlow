using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using Xunit.Abstractions;

namespace MatterFlow.IntegrationTests.Audit;

/// <summary>
/// The audit browser against about 200,000 events (a year of firm activity is a few hundred thousand): every filter combination the screen offers
/// must answer within a few seconds (the bound is generous so a slow CI disk does not flake; the plans are index seeks or an early-ending backward scan).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AuditSearchPerformanceTests(SqlServerFixture sql, ITestOutputHelper output)
{
    private const int Rows = 200_000;
    private static readonly TimeSpan Limit = TimeSpan.FromSeconds(5);

    [Fact]
    public async Task Every_filter_answers_quickly_on_200k_events()
    {
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
        client.DefaultRequestHeaders.Add("X-Time-Zone", "America/New_York");
        (await client.GetAsync("/api/v1/audit/facets")).EnsureSuccessStatusCode();

        await factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(
            $"""
            INSERT INTO dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, MatterId, TaskId, FieldKey, OldValue, NewValue, Summary, CorrelationId)
            SELECT TOP ({Rows})
                   DATEADD(MINUTE, -n * 2, '2026-10-14T12:00:00'),
                   CASE WHEN n % 7 = 0 THEN NULL ELSE 1 + n % 50 END,
                   CASE n % 10 WHEN 0 THEN 'TASK_CREATED' WHEN 1 THEN 'FIELD_CHANGED' WHEN 2 THEN 'STEP_COMPLETED' ELSE 'EVENT_' + CAST(n % 10 AS VARCHAR(3)) END,
                   CASE n % 5 WHEN 0 THEN 'Task' WHEN 1 THEN 'Matter' WHEN 2 THEN 'Client' WHEN 3 THEN 'Asset' ELSE 'Project' END,
                   CAST(n % 5000 AS VARCHAR(40)),
                   n % 300, n % 5000, 'field' + CAST(n % 40 AS VARCHAR(5)), 'old ' + CAST(n AS VARCHAR(10)), 'new ' + CAST(n AS VARCHAR(10)),
                   'Summary number ' + CAST(n AS VARCHAR(10)),
                   CAST(HASHBYTES('MD5', CAST(n / 5 AS VARCHAR(10))) AS UNIQUEIDENTIFIER)
            FROM (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_columns a CROSS JOIN sys.all_columns b) x
            """));
        await factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("UPDATE STATISTICS dbo.AuditEvent"));

        string[] queries =
        [
            "?pageSize=200",
            "?objectType=Task&objectId=150",
            "?objectType=Matter",
            "?actor=7",
            "?actor=7&eventType=FIELD_CHANGED",
            "?eventType=TASK_CREATED",
            "?eventType=EVENT_9&objectType=Task",
            "?from=2026-01-01&to=2026-01-31",
            "?from=2026-10-10&to=2026-10-14&actor=3",
            "?q=number%201999",
            "?q=field7",
            "?q=zzz-no-match",
            "?objectType=Asset&q=number%2012",
        ];

        foreach (var query in queries)
        {
            var timer = Stopwatch.StartNew();
            var response = await client.GetAsync("/api/v1/audit/search" + query);
            timer.Stop();
            response.StatusCode.ShouldBe(HttpStatusCode.OK, query);
            _ = await response.Content.ReadFromJsonAsync<JsonElement>();
            output.WriteLine($"{timer.ElapsedMilliseconds,6} ms  {query}");
            timer.Elapsed.ShouldBeLessThan(Limit, query);
        }

        var facets = Stopwatch.StartNew();
        (await client.GetAsync("/api/v1/audit/facets")).EnsureSuccessStatusCode();
        output.WriteLine($"{facets.ElapsedMilliseconds,6} ms  facets");
        facets.Elapsed.ShouldBeLessThan(Limit);
    }
}
