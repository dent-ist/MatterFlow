using System.Net;
using System.Net.Http.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests;

/// <summary>SEC2-03: per-user budgets for the expensive API calls, 429 with Retry-After, and the query string caps.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ApiRateLimitingTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> _limited = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _limited = _factory.WithWebHostBuilder(b =>
        {
            foreach (var budget in new[] { "CommentWritesPerMinute", "TaskWritesPerMinute", "SearchPerMinute", "AdvancedSearchPerMinute", "AuditPerMinute", "DashboardPerMinute" })
                b.UseSetting("RateLimits:" + budget, "3");
            b.UseSetting("RateLimits:MaxQueryValues", "20");
        });
    }

    public async Task DisposeAsync()
    {
        await _limited.DisposeAsync();
        await _factory.DisposeAsync();
    }

    private HttpClient As(string user)
    {
        var client = _limited.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static async Task ExpectBudgetAsync(Func<Task<HttpResponseMessage>> call)
    {
        for (var i = 0; i < 3; i++)
            (await call()).StatusCode.ShouldNotBe(HttpStatusCode.TooManyRequests, "call " + (i + 1));

        var rejected = await call();
        await ProblemAsync(rejected, HttpStatusCode.TooManyRequests, "TOO_MANY_REQUESTS");
        rejected.Headers.Contains("Retry-After").ShouldBeTrue();
        int.Parse(rejected.Headers.GetValues("Retry-After").Single()).ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task Comment_writes_are_limited_per_user()
    {
        var admin = As(DatabaseApiFactory.AdminAccount);
        await ExpectBudgetAsync(() => admin.PostAsJsonAsync("/api/v1/tasks/999999/comments", new { bodyHtml = "<p>x</p>" }));
        (await admin.GetAsync("/api/v1/tasks/999999/comments")).StatusCode.ShouldNotBe(HttpStatusCode.TooManyRequests); // reads have their own (high) budget

        var other = As(@"KE\director");
        (await other.PostAsJsonAsync("/api/v1/tasks/999999/comments", new { bodyHtml = "<p>x</p>" })).StatusCode.ShouldNotBe(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task Task_writes_are_limited()
    {
        var admin = As(DatabaseApiFactory.AdminAccount);
        await ExpectBudgetAsync(() => admin.PostAsJsonAsync("/api/v1/tasks", new { }));
    }

    [Fact]
    public async Task Search_typeahead_is_limited()
    {
        var admin = As(DatabaseApiFactory.AdminAccount);
        await ExpectBudgetAsync(() => admin.GetAsync("/api/v1/search?q=ab"));
    }

    [Fact]
    public async Task Advanced_search_is_limited()
    {
        var admin = As(DatabaseApiFactory.AdminAccount);
        await ExpectBudgetAsync(() => admin.GetAsync("/api/v1/search/advanced?type=client&q=ab"));
    }

    [Fact]
    public async Task Audit_search_is_limited()
    {
        var admin = As(DatabaseApiFactory.AdminAccount);
        await ExpectBudgetAsync(() => admin.GetAsync("/api/v1/audit/search?q=ab"));
    }

    [Fact]
    public async Task Dashboard_is_limited()
    {
        var admin = As(DatabaseApiFactory.AdminAccount);
        await ExpectBudgetAsync(() => admin.GetAsync("/api/v1/dashboard"));
    }

    [Fact]
    public async Task Too_many_repeated_query_parameters_are_rejected()
    {
        var admin = As(DatabaseApiFactory.AdminAccount);
        var query = string.Join('&', Enumerable.Range(1, 25).Select(i => "status=" + i));
        await ProblemAsync(await admin.GetAsync("/api/v1/task-queue?" + query), HttpStatusCode.BadRequest, "QUERY_TOO_LARGE");

        var longQuery = "q=" + new string('a', 5000);
        await ProblemAsync(await As(DatabaseApiFactory.AdminAccount).GetAsync("/api/v1/search?" + longQuery), HttpStatusCode.BadRequest, "QUERY_TOO_LARGE");
    }
}
