using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Audit;

/// <summary>GET /api/v1/audit/search and /audit/facets against a real database, signed in through the Dev provider (admin holds Audit.View).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class AuditSearchApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly Guid BulkCorrelation = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private DatabaseApiFactory _factory = null!;
    private HttpClient _admin = null!;
    private int _adminId;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _admin = Client(DatabaseApiFactory.AdminAccount);
        (await _admin.GetAsync("/api/v1/audit/facets")).EnsureSuccessStatusCode(); // first sign-in provisions the user
        _adminId = await _factory.WithDbAsync(async db =>
            await db.Database.SqlQueryRaw<int>("SELECT TOP 1 UserId AS Value FROM dbo.AppUser ORDER BY UserId").SingleAsync());
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient Client(string user, string? timeZone = null)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        if (timeZone is not null)
            client.DefaultRequestHeaders.Add("X-Time-Zone", timeZone);
        return client;
    }

    private async Task InsertAsync(
        string occurredUtc,
        string eventType,
        string objectType,
        string objectId,
        int? actor = null,
        string? field = null,
        string? oldValue = null,
        string? newValue = null,
        string? summary = null,
        Guid? correlation = null,
        long? taskId = null)
    {
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO dbo.AuditEvent (OccurredAtUtc, ActorUserId, EventType, ObjectType, ObjectId, TaskId, FieldKey, OldValue, NewValue, Summary, CorrelationId)
            VALUES (@at, @actor, @type, @objType, @objId, @task, @field, @old, @new, @summary, @corr)
            """,
            new SqlParameter("@at", DateTime.Parse(occurredUtc, null, System.Globalization.DateTimeStyles.AdjustToUniversal)),
            new SqlParameter("@actor", actor ?? (object)DBNull.Value),
            new SqlParameter("@type", eventType),
            new SqlParameter("@objType", objectType),
            new SqlParameter("@objId", objectId),
            new SqlParameter("@task", taskId ?? (object)DBNull.Value),
            new SqlParameter("@field", field ?? (object)DBNull.Value),
            new SqlParameter("@old", oldValue ?? (object)DBNull.Value),
            new SqlParameter("@new", newValue ?? (object)DBNull.Value),
            new SqlParameter("@summary", summary ?? (object)DBNull.Value),
            new SqlParameter("@corr", correlation ?? Guid.NewGuid())));
    }

    private static string[] Ids(JsonElement page) =>
        [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("object").GetProperty("id").GetString()!)];

    /// <summary>Startup writes its own audit rows (bootstrap, role sync), so tests look only at the "Doc" object type unless they pick another.</summary>
    private static string Scoped(string query) =>
        query.Contains("objectType=", StringComparison.Ordinal) ? query : (query.Length == 0 ? "?" : query + "&") + "objectType=Doc";

    private async Task<JsonElement> SearchAsync(string query, HttpClient? client = null)
    {
        var response = await (client ?? _admin).GetAsync("/api/v1/audit/search" + Scoped(query));
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Without_Audit_View_the_endpoints_are_forbidden()
    {
        var scientist = Client(@"KE\scientist");

        (await scientist.GetAsync("/api/v1/audit/search")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await scientist.GetAsync("/api/v1/audit/facets")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Filters_by_object_type_object_id_actor_event_type_and_correlation()
    {
        await InsertAsync("2026-10-01T10:00:00Z", "TASK_CREATED", "Doc", "1", _adminId, summary: "Task TSK-1 created");
        await InsertAsync("2026-10-01T10:01:00Z", "FIELD_CHANGED", "Doc", "2", _adminId, "title", "a", "b");
        await InsertAsync("2026-10-01T10:02:00Z", "FIELD_CHANGED", "DocB", "3", null, "Name", "x", "y");
        await InsertAsync("2026-10-01T10:03:00Z", "STEP_COMPLETED", "DocB", "4", _adminId, taskId: 1, correlation: BulkCorrelation);
        await InsertAsync("2026-10-01T10:04:00Z", "STEP_COMPLETED", "DocB", "5", _adminId, taskId: 1, correlation: BulkCorrelation);

        Ids(await SearchAsync("?objectType=Doc")).ShouldBe(["2", "1"]);
        Ids(await SearchAsync("?objectType=Doc&objectId=1")).ShouldBe(["1"]);
        Ids(await SearchAsync("?objectType=DocB")).ShouldBe(["5", "4", "3"]);
        Ids(await SearchAsync("?eventType=FIELD_CHANGED&objectType=DocB")).ShouldBe(["3"]);
        Ids(await SearchAsync("?eventType=STEP_COMPLETED&objectType=DocB")).ShouldBe(["5", "4"]);
        Ids(await SearchAsync($"?actor={_adminId}")).ShouldBe(["2", "1"]);
        Ids(await SearchAsync($"?objectType=DocB&actor={_adminId}")).ShouldBe(["5", "4"]);
        Ids(await SearchAsync($"?objectType=DocB&correlationId={BulkCorrelation}")).ShouldBe(["5", "4"]);
    }

    [Fact]
    public async Task An_object_id_without_an_object_type_is_a_400()
    {
        (await _admin.GetAsync("/api/v1/audit/search?objectId=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _admin.GetAsync("/api/v1/audit/search?from=2026-10-05&to=2026-10-01")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _admin.GetAsync("/api/v1/audit/search?from=not-a-date")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _admin.GetAsync("/api/v1/audit/search?pageSize=201")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await _admin.GetAsync("/api/v1/audit/search?pageSize=0")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Free_text_matches_the_summary_and_the_field_key_and_treats_wildcards_literally()
    {
        await InsertAsync("2026-10-01T10:00:00Z", "TASK_CREATED", "Doc", "1", summary: "Task TSK-1 created for Smith");
        await InsertAsync("2026-10-01T10:01:00Z", "FIELD_CHANGED", "Doc", "2", field: "form:billing_code", oldValue: "a", newValue: "b");
        await InsertAsync("2026-10-01T10:02:00Z", "FIELD_CHANGED", "Doc", "3", field: "title", oldValue: "a", newValue: "b", summary: "100% done");

        Ids(await SearchAsync("?q=smith")).ShouldBe(["1"]);
        Ids(await SearchAsync("?q=billing_code")).ShouldBe(["2"]);
        Ids(await SearchAsync("?q=100%25")).ShouldBe(["3"]);
        Ids(await SearchAsync("?q=%25")).ShouldBe(["3"]);
        Ids(await SearchAsync("?q=billing%25code")).ShouldBeEmpty();
    }

    [Fact]
    public async Task Date_range_is_read_in_the_viewers_time_zone_with_inclusive_end_day()
    {
        // New York is UTC-4 (EDT) in October: Oct 14 local runs from 04:00Z to 03:59:59.999Z of Oct 15.
        await InsertAsync("2026-10-14T03:59:59Z", "DOC_E", "Doc", "before", null);
        await InsertAsync("2026-10-14T04:00:00Z", "DOC_E", "Doc", "start", null);
        await InsertAsync("2026-10-15T03:59:59Z", "DOC_E", "Doc", "end", null);
        await InsertAsync("2026-10-15T04:00:00Z", "DOC_E", "Doc", "after", null);

        var newYork = Client(DatabaseApiFactory.AdminAccount, "America/New_York");
        var utc = Client(DatabaseApiFactory.AdminAccount, "UTC");
        var tokyo = Client(DatabaseApiFactory.AdminAccount, "Asia/Tokyo"); // UTC+9: Oct 14 local is 2026-10-13T15:00Z to 2026-10-14T14:59:59Z

        Ids(await SearchAsync("?from=2026-10-14&to=2026-10-14", newYork)).ShouldBe(["end", "start"]);
        Ids(await SearchAsync("?from=2026-10-14&to=2026-10-14", utc)).ShouldBe(["start", "before"]);
        Ids(await SearchAsync("?from=2026-10-14&to=2026-10-14", tokyo)).ShouldBe(["start", "before"]);
        Ids(await SearchAsync("?from=2026-10-15", newYork)).ShouldBe(["after"]);
        Ids(await SearchAsync("?to=2026-10-13", newYork)).ShouldBe(["before"]);
        (await SearchAsync("?from=2026-10-14&to=2026-10-14", newYork)).GetProperty("timeZone").GetString().ShouldBe("America/New_York");
    }

    [Fact]
    public async Task Date_range_across_the_spring_forward_day_uses_the_real_day_length()
    {
        // US spring forward 2026-03-08: local day Mar 8 starts at 05:00Z (EST) and ends at 03:59:59Z of Mar 9 (EDT, 23 hours long).
        await InsertAsync("2026-03-08T04:59:59Z", "DOC_E", "Doc", "mar7", null);
        await InsertAsync("2026-03-08T05:00:00Z", "DOC_E", "Doc", "mar8-start", null);
        await InsertAsync("2026-03-09T03:59:59Z", "DOC_E", "Doc", "mar8-end", null);
        await InsertAsync("2026-03-09T04:00:00Z", "DOC_E", "Doc", "mar9", null);

        Ids(await SearchAsync("?from=2026-03-08&to=2026-03-08", Client(DatabaseApiFactory.AdminAccount, "America/New_York")))
            .ShouldBe(["mar8-end", "mar8-start"]);
    }

    [Fact]
    public async Task Pages_newest_first_with_a_stable_cursor_and_a_capped_page_size()
    {
        for (var i = 1; i <= 7; i++)
            await InsertAsync($"2026-10-01T10:0{i}:00Z", "DOC_E", "Doc", i.ToString(), null);

        var page1 = await SearchAsync("?pageSize=3");
        Ids(page1).ShouldBe(["7", "6", "5"]);
        page1.GetProperty("pageSize").GetInt32().ShouldBe(3);
        var c1 = page1.GetProperty("nextCursor").GetInt64();

        var page2 = await SearchAsync($"?pageSize=3&cursor={c1}");
        Ids(page2).ShouldBe(["4", "3", "2"]);

        // An event written between two page loads does not shift the next page: the cursor is an id boundary, not an offset.
        await InsertAsync("2026-10-02T10:00:00Z", "DOC_E", "Doc", "late", null);
        var c2 = page2.GetProperty("nextCursor").GetInt64();
        var page3 = await SearchAsync($"?pageSize=3&cursor={c2}");
        Ids(page3).ShouldBe(["1"]);
        page3.GetProperty("nextCursor").ValueKind.ShouldBe(JsonValueKind.Null);

        (await SearchAsync(string.Empty)).GetProperty("pageSize").GetInt32().ShouldBe(50);
    }

    [Fact]
    public async Task Returns_actor_names_summaries_values_and_correlation_group_sizes()
    {
        await InsertAsync("2026-10-01T10:00:00Z", "TASK_STATUS_CHANGED", "Doc", "9", _adminId, oldValue: "IN_PROGRESS", newValue: "ON_HOLD", taskId: 9);
        await InsertAsync("2026-10-01T10:01:00Z", "FIELD_CHANGED", "Doc", "9", null, "priority", "Normal", "High", taskId: 9, correlation: BulkCorrelation);
        await InsertAsync("2026-10-01T10:02:00Z", "FIELD_CHANGED", "Doc", "9", null, "form:billing_code", null, "B-7", taskId: 9, correlation: BulkCorrelation);
        await InsertAsync("2026-10-01T10:03:00Z", "STEP_COMPLETED", "Doc", "5", null, summary: "Step 'Intake review' completed (bulk=true)", taskId: 9);

        var items = (await SearchAsync(string.Empty)).GetProperty("items").EnumerateArray().ToList();

        var step = items[0];
        step.GetProperty("summary").GetString().ShouldBe("Step 'Intake review' completed (bulk)");
        step.GetProperty("actor").GetProperty("displayName").GetString().ShouldBe("System");
        step.GetProperty("taskId").GetInt64().ShouldBe(9);
        step.GetProperty("object").GetProperty("type").GetString().ShouldBe("Doc");

        var billing = items[1];
        billing.GetProperty("summary").GetString().ShouldBe("Billing code set to B-7");
        billing.GetProperty("correlationEventCount").GetInt32().ShouldBe(2);
        billing.GetProperty("correlationId").GetGuid().ShouldBe(BulkCorrelation);
        items[2].GetProperty("summary").GetString().ShouldBe("Priority changed from Normal to High");
        items[2].GetProperty("oldValue").GetString().ShouldBe("Normal");

        var status = items[3];
        status.GetProperty("summary").GetString().ShouldBe("Status changed from In Progress to On Hold");
        status.GetProperty("actor").GetProperty("userId").GetInt32().ShouldBe(_adminId);
        status.GetProperty("actor").GetProperty("displayName").GetString().ShouldNotBeNullOrWhiteSpace();
        status.GetProperty("actor").GetProperty("displayName").GetString().ShouldNotStartWith("User ");
    }

    [Fact]
    public async Task Never_returns_secrets_or_tokens()
    {
        const string jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        await InsertAsync("2026-10-01T10:00:00Z", "FIELD_CHANGED", "Doc", "1", null, "api_token", "old-secret-123", "new-secret-456");
        await InsertAsync("2026-10-01T10:01:00Z", "FIELD_CHANGED", "Doc", "2", null, "form:notes", "plain", jwt);
        await InsertAsync("2026-10-01T10:02:00Z", "FIELD_CHANGED", "Doc", "3", null, "form:notes", "x", "Server=a;Password=hunter2;");
        await InsertAsync("2026-10-01T10:03:00Z", "FIELD_CHANGED", "Doc", "4", null, "ConnectionString", "Server=a;Pwd=zzz", "Server=b");
        await InsertAsync("2026-10-01T10:04:00Z", "CUSTOM", "Doc", "5", null, summary: "Login with Bearer abcdefghijklmnop1234567890");
        await InsertAsync("2026-10-01T10:05:00Z", "FIELD_CHANGED", "Doc", "6", null, "form:notes", "visible old", "visible new");

        var response = await _admin.GetAsync("/api/v1/audit/search?objectType=Doc");
        var body = await response.Content.ReadAsStringAsync();

        foreach (var secret in new[] { "old-secret-123", "new-secret-456", jwt, "hunter2", "zzz", "abcdefghijklmnop1234567890" })
            body.ShouldNotContain(secret);

        var items = JsonDocument.Parse(body).RootElement.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("object").GetProperty("id").GetString()!);
        items["1"].GetProperty("newValue").GetString().ShouldBe("[REDACTED]");
        items["1"].GetProperty("valuesRedacted").GetBoolean().ShouldBeTrue();
        items["1"].GetProperty("summary").GetString().ShouldBe("Api token changed");
        items["2"].GetProperty("newValue").GetString().ShouldBe("[REDACTED]");
        items["5"].GetProperty("summary").GetString().ShouldBe("Custom");
        items["6"].GetProperty("newValue").GetString().ShouldBe("visible new");
        items["6"].GetProperty("valuesRedacted").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Long_values_are_truncated_for_display_and_flagged()
    {
        await InsertAsync("2026-10-01T10:00:00Z", "FIELD_CHANGED", "Doc", "1", null, "description", "short", new string('x', 5000));

        var item = (await SearchAsync(string.Empty)).GetProperty("items")[0];

        item.GetProperty("newValue").GetString()!.Length.ShouldBe(4000);
        item.GetProperty("newValueTruncated").GetBoolean().ShouldBeTrue();
        item.GetProperty("oldValueTruncated").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Facets_list_the_object_and_event_types_in_the_trail()
    {
        await InsertAsync("2026-10-01T10:00:00Z", "TASK_CREATED", "Doc", "1");
        await InsertAsync("2026-10-01T10:01:00Z", "FIELD_CHANGED", "DocB", "2");

        var facets = await _admin.GetFromJsonAsync<JsonElement>("/api/v1/audit/facets");

        facets.GetProperty("objectTypes").EnumerateArray().Select(e => e.GetString()).ShouldContain("DocB");
        facets.GetProperty("objectTypes").EnumerateArray().Select(e => e.GetString()).ShouldContain("Doc");
        facets.GetProperty("eventTypes").EnumerateArray().Select(e => e.GetString()).ShouldContain("TASK_CREATED");
    }

    [Fact]
    public async Task Object_labels_resolve_through_contracts_and_stay_null_for_unknown_objects()
    {
        // The seeded user is a "User" object: its label is the display name; an unknown Task id has no label.
        await InsertAsync("2026-10-01T10:01:00Z", "FIELD_CHANGED", "Task", "424242", null, "title", "a", "b");

        var task = (await SearchAsync("?objectType=Task&objectId=424242")).GetProperty("items")[0];
        var user = (await SearchAsync($"?objectType=User&objectId={_adminId}")).GetProperty("items")[0];

        task.GetProperty("object").GetProperty("label").ValueKind.ShouldBe(JsonValueKind.Null);
        user.GetProperty("object").GetProperty("type").GetString().ShouldBe("User");
        user.GetProperty("object").GetProperty("label").GetString().ShouldNotBeNullOrWhiteSpace();
    }
}
