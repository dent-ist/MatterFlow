using System.Net;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>
/// <c>sort</c> and <c>dir</c> on the user list (#436, additive): the keys <c>name</c>, <c>firstSeen</c> and <c>lastSeen</c>, ties broken by id so paging is
/// stable, people who never signed in last whichever way the last-seen list runs, an unknown key or direction is the standard 400, and without a sort
/// key the queue order (waiting people first) is unchanged. 1,072 people give many equal first-seen and last-seen times to break ties on.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class UsersSortApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const int Bulk = 1072;
    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        await As().GetAsync("/api/v1/me"); // starts the host and provisions the administrator
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync($"""
            ;WITH n AS (SELECT TOP ({Bulk}) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b)
            INSERT INTO dbo.AppUser (DisplayName, Email, IsActive, CreatedAt)
            SELECT CONCAT('Sort User ', RIGHT(CONCAT('0000', i), 4)), NULL, 1, DATEADD(MINUTE, i % 50, '2026-01-01') FROM n;

            INSERT INTO dbo.UserIdentity (UserId, Provider, TenantId, ProviderSubject, Username, LastLoginAt)
            SELECT u.UserId, 'Dev', '', CONCAT('sort', u.UserId), CONCAT('KE\sortuser', u.UserId),
                   CASE WHEN u.UserId % 3 = 0 THEN NULL ELSE DATEADD(HOUR, u.UserId % 40, '2026-06-01') END
            FROM dbo.AppUser u WHERE u.DisplayName LIKE 'Sort User %';
            """));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string user = DatabaseApiFactory.AdminAccount)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(HttpStatusCode.OK, body);
        return JsonDocument.Parse(body).RootElement;
    }

    /// <summary>Every user id the query lists, page by page (100 per page).</summary>
    private async Task<(List<int> Ids, int Total)> AllPagesAsync(string query)
    {
        var ids = new List<int>();
        var total = 0;
        for (var page = 1; ; page++)
        {
            var list = await OkAsync(await As().GetAsync($"/api/v1/users?{query}&pageSize=100&page={page}"));
            total = list.GetProperty("total").GetInt32();
            var items = list.GetProperty("items").EnumerateArray().Select(u => u.GetProperty("userId").GetInt32()).ToList();
            ids.AddRange(items);
            if (items.Count == 0 || ids.Count >= total)
                return (ids, total);
        }
    }

    private async Task<List<(int Id, string Name, DateTime Created, DateTime? LastSeen)>> RowsAsync(string like = "%") =>
        await _factory.WithDbAsync(async db => (await db.Set<AppUser>().AsNoTracking()
                .Where(u => EF.Functions.Like(u.DisplayName, like))
                .Select(u => new { u.Id, u.DisplayName, u.CreatedAtUtc, LastSeen = u.Identities.Max(i => i.LastLoginAt) })
                .ToListAsync())
            .Select(r => (r.Id, r.DisplayName, r.CreatedAtUtc, r.LastSeen))
            .ToList());

    [Theory]
    [InlineData("name", false)]
    [InlineData("name", true)]
    [InlineData("firstSeen", false)]
    [InlineData("firstSeen", true)]
    [InlineData("lastSeen", false)]
    [InlineData("lastSeen", true)]
    public async Task Every_key_and_direction_lists_each_person_once_in_the_expected_order_across_pages(string key, bool descending)
    {
        var rows = await RowsAsync();
        var expected = key switch
        {
            "name" => (descending ? rows.OrderByDescending(r => r.Name, StringComparer.OrdinalIgnoreCase) : rows.OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase)).ThenBy(r => r.Id),
            "firstSeen" => (descending ? rows.OrderByDescending(r => r.Created) : rows.OrderBy(r => r.Created)).ThenBy(r => r.Id),
            _ => (descending
                ? rows.OrderBy(r => r.LastSeen is null).ThenByDescending(r => r.LastSeen)
                : rows.OrderBy(r => r.LastSeen is null).ThenBy(r => r.LastSeen)).ThenBy(r => r.Id),
        };

        var (ids, total) = await AllPagesAsync($"status=all&sort={key}&dir={(descending ? "desc" : "asc")}");

        total.ShouldBe(rows.Count);
        ids.Count.ShouldBe(total);
        ids.Distinct().Count().ShouldBe(total, "paging is stable: no person twice, none missing");
        ids.ShouldBe(expected.Select(r => r.Id).ToList());
    }

    [Fact]
    public async Task People_who_never_signed_in_are_last_in_both_directions_of_Last_seen()
    {
        var neverSeen = (await RowsAsync()).Where(r => r.LastSeen is null).Select(r => r.Id).ToHashSet();
        neverSeen.Count.ShouldBeGreaterThan(300);
        foreach (var dir in new[] { "asc", "desc" })
        {
            var (ids, _) = await AllPagesAsync($"status=all&sort=lastSeen&dir={dir}");
            var firstNever = ids.FindIndex(neverSeen.Contains);
            ids.Skip(firstNever).All(neverSeen.Contains).ShouldBeTrue($"every never-seen person comes after every seen one ({dir})");
        }
    }

    [Fact]
    public async Task A_filter_combines_with_a_sort_and_the_total_follows_the_filter()
    {
        var wanted = (await RowsAsync("Sort User 01%")).ToList(); // 0100 to 0199: a hundred people
        var (ids, total) = await AllPagesAsync("status=all&name=Sort%20User%2001&sort=lastSeen&dir=desc");
        total.ShouldBe(wanted.Count);
        ids.ShouldBe(wanted.OrderBy(r => r.LastSeen is null).ThenByDescending(r => r.LastSeen).ThenBy(r => r.Id).Select(r => r.Id).ToList());
    }

    [Fact]
    public async Task The_direction_defaults_to_ascending_and_the_key_is_case_insensitive()
    {
        var plain = await AllPagesAsync("status=all&sort=firstSeen");
        (await AllPagesAsync("status=all&sort=firstseen&dir=ASC")).Ids.ShouldBe(plain.Ids);
        plain.Ids.ShouldBe((await AllPagesAsync("status=all&sort=firstSeen&dir=asc")).Ids);
    }

    [Theory]
    [InlineData("sort=password", "sort")]
    [InlineData("sort=name&dir=sideways", "dir")]
    public async Task An_unknown_key_or_direction_is_the_standard_400_problem(string query, string field)
    {
        var response = await As().GetAsync($"/api/v1/users?{query}");
        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        problem.GetProperty("code").GetString().ShouldBe("VALIDATION_FAILED");
        problem.GetProperty("errors").GetProperty(field)[0].GetProperty("code").GetString().ShouldBe("INVALID");
    }

    [Fact]
    public async Task Without_a_sort_key_the_queue_order_is_unchanged_waiting_people_first()
    {
        // Everybody in this list is waiting (no role) except the bootstrap administrator: the administrator is not among the first rows.
        var list = await OkAsync(await As().GetAsync("/api/v1/users?status=all&pageSize=5"));
        list.GetProperty("items").EnumerateArray().All(u => u.GetProperty("isPending").GetBoolean()).ShouldBeTrue();
    }

    [Fact]
    public async Task A_person_with_User_View_only_can_sort_too()
    {
        await As(@"KE\viewer").GetAsync("/api/v1/me");
        await _factory.GrantRoleAsync(@"KE\viewer", await _factory.CreateRoleAsync("Viewer", Permissions.User.View));
        var list = await OkAsync(await As(@"KE\viewer").GetAsync("/api/v1/users?status=all&sort=name&dir=desc&pageSize=3"));
        list.GetProperty("items").GetArrayLength().ShouldBe(3);
    }
}
