using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.Notifications.Contracts;
using MatterFlow.Notifications.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Notifications;

/// <summary>
/// WP-NT1 (#729 to #734): the Notification table, the publisher (same transaction), the permission re-check on read, list / read / read-all,
/// the poll with ETag and the preferences, against a real SQL Server.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class NotificationsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string List = "/api/v1/me/notifications";
    private const string Poll = "/api/v1/me/notifications/poll";
    private const string Prefs = "/api/v1/me/notification-preferences";

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private HttpClient _ann = null!;
    private HttpClient _bo = null!;
    private int _annId;
    private int _boId;
    private long _taskId;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        _ann = await _h.UserWithAsync(@"KE\ann", "Task.View", "Matter.View");
        _bo = await _h.UserWithAsync(@"KE\bo", "Task.View", "Matter.View");
        _annId = await _h.UserIdAsync(@"KE\ann");
        _boId = await _h.UserIdAsync(@"KE\bo");
        _taskId = TaskId(await _h.CreateTaskAsync(_w));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<long> SeedAsync(int recipient, string message, string kind = "Task", long? objectId = null, bool read = false, string type = "TaskAssigned", string? key = null, DateTime? created = null)
    {
        return await _factory.WithDbAsync(async db =>
        {
            var row = new Notification
            {
                RecipientUserId = recipient,
                EventType = type,
                ObjectKind = kind,
                ObjectId = objectId ?? (kind == "Task" ? _taskId : _w.MatterId),
                MatterId = _w.MatterId,
                Message = message,
                DedupeKey = key ?? Guid.NewGuid().ToString("N"),
                CreatedUtc = created ?? DateTime.UtcNow.AddMinutes(-1),
                ReadUtc = read ? DateTime.UtcNow : null,
            };
            db.Set<Notification>().Add(row);
            await db.SaveChangesAsync();
            return row.Id;
        });
    }

    private static string[] Messages(JsonElement list) => [.. list.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("message").GetString()!)];

    [Fact]
    public async Task Anonymous_is_401_and_a_user_without_Task_View_is_403_on_every_endpoint()
    {
        var anonymous = _factory.CreateClient();
        anonymous.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        (await anonymous.GetAsync(List)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await anonymous.GetAsync(Poll)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await anonymous.GetAsync(Prefs)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        var nobody = await _h.UserWithAsync(@"KE\nobody", "Matter.View");
        foreach (var url in new[] { List, Poll, Prefs })
            (await nobody.GetAsync(url)).StatusCode.ShouldBe(HttpStatusCode.Forbidden, url);
        (await nobody.PostAsync(List + "/read-all", null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.PostAsync(List + "/1/read", null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.PutAsJsonAsync(Prefs, new { items = Array.Empty<object>() })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task List_returns_only_my_rows_newest_first_with_filter_and_stable_paging()
    {
        var first = await SeedAsync(_annId, "one");
        await SeedAsync(_annId, "two", read: true);
        await SeedAsync(_annId, "three");
        await SeedAsync(_boId, "for bo");

        var all = await OkAsync(await _ann.GetAsync(List));
        Messages(all).ShouldBe(["three", "two", "one"]);
        all.GetProperty("totalCount").GetInt32().ShouldBe(3);
        all.GetProperty("items")[0].GetProperty("isRead").GetBoolean().ShouldBeFalse();
        all.GetProperty("items")[1].GetProperty("isRead").GetBoolean().ShouldBeTrue();
        all.GetProperty("items")[0].GetProperty("createdUtc").GetDateTime().Kind.ShouldBe(DateTimeKind.Utc);

        Messages(await OkAsync(await _ann.GetAsync(List + "?filter=unread"))).ShouldBe(["three", "one"]);

        var page1 = await OkAsync(await _ann.GetAsync(List + "?pageSize=2&page=1"));
        await SeedAsync(_annId, "four"); // arrives between the pages
        var page2 = await OkAsync(await _ann.GetAsync(List + "?pageSize=2&page=2"));
        Messages(page1).ShouldBe(["three", "two"]);
        Messages(page2).ShouldBe(["two", "one"]); // offset paging shifts by the new row; ids stay strictly descending
        page2.GetProperty("items")[1].GetProperty("id").GetInt64().ShouldBe(first);

        await ProblemAsync(await _ann.GetAsync(List + "?filter=bogus"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _ann.GetAsync(List + "?pageSize=101"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _ann.GetAsync(List + "?nope=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Mark_read_is_idempotent_and_another_persons_or_unknown_id_is_404()
    {
        var mine = await SeedAsync(_annId, "mine");
        var bos = await SeedAsync(_boId, "bos");

        (await _ann.PostAsync($"{List}/{mine}/read", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        var readUtc = await _factory.WithDbAsync(db => db.Set<Notification>().Where(n => n.Id == mine).Select(n => n.ReadUtc).SingleAsync());
        readUtc.ShouldNotBeNull();
        (await _ann.PostAsync($"{List}/{mine}/read", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await _factory.WithDbAsync(db => db.Set<Notification>().Where(n => n.Id == mine).Select(n => n.ReadUtc).SingleAsync())).ShouldBe(readUtc); // set once

        await ProblemAsync(await _ann.PostAsync($"{List}/{bos}/read", null), HttpStatusCode.NotFound, "NOT_FOUND");
        await ProblemAsync(await _ann.PostAsync($"{List}/999999/read", null), HttpStatusCode.NotFound, "NOT_FOUND");
        (await _factory.WithDbAsync(db => db.Set<Notification>().Where(n => n.Id == bos).Select(n => n.ReadUtc).SingleAsync())).ShouldBeNull();
    }

    [Fact]
    public async Task Read_all_marks_only_my_visible_unread_rows_and_is_idempotent()
    {
        await SeedAsync(_annId, "a");
        await SeedAsync(_annId, "b");
        await SeedAsync(_annId, "already", read: true);
        var hidden = await SeedAsync(_annId, "task that does not exist", objectId: 987654);
        await SeedAsync(_boId, "bos");

        var first = await OkAsync(await _ann.PostAsync(List + "/read-all", null));
        first.GetProperty("marked").GetInt32().ShouldBe(2);
        (await OkAsync(await _ann.PostAsync(List + "/read-all", null))).GetProperty("marked").GetInt32().ShouldBe(0);

        // The invisible row stays unread (it was never reachable), and Bo's row is untouched.
        (await _factory.WithDbAsync(db => db.Set<Notification>().Where(n => n.Id == hidden).Select(n => n.ReadUtc).SingleAsync())).ShouldBeNull();
        (await _factory.WithDbAsync(db => db.Set<Notification>().CountAsync(n => n.RecipientUserId == _boId && n.ReadUtc == null))).ShouldBe(1);
    }

    [Fact]
    public async Task Permission_is_rechecked_on_every_read_and_rows_reappear_when_access_returns()
    {
        await SeedAsync(_annId, "task row");
        await SeedAsync(_annId, "matter row", kind: "Matter", type: "MatterManagerSet");
        var ghost = await SeedAsync(_annId, "ghost", objectId: 424242);

        Messages(await OkAsync(await _ann.GetAsync(List))).ShouldBe(["matter row", "task row"]);
        (await OkAsync(await _ann.GetAsync(Poll + "?initial=true"))).GetProperty("unreadCount").GetInt32().ShouldBe(2);

        // A user who may view Tasks but not Matters sees no Matter notification, its text is never returned, and it is not counted.
        var taskOnly = await _h.UserWithAsync(@"KE\taskonly", "Task.View");
        var id = await _h.UserIdAsync(@"KE\taskonly");
        await SeedAsync(id, "task row 2");
        await SeedAsync(id, "secret matter name", kind: "Matter", type: "MatterManagerSet");
        var seen = await OkAsync(await taskOnly.GetAsync(List));
        Messages(seen).ShouldBe(["task row 2"]);
        seen.GetProperty("totalCount").GetInt32().ShouldBe(1);
        (await taskOnly.GetStringAsync(Poll)).ShouldNotContain("secret matter name");
        (await OkAsync(await taskOnly.GetAsync(Poll))).GetProperty("unreadCount").GetInt32().ShouldBe(1);

        // Access returns: the Matter row is back (nothing was deleted).
        var roleId = await _factory.CreateRoleAsync("Matter viewers", "Matter.View");
        await _factory.GrantRoleAsync(@"KE\taskonly", roleId);
        Messages(await OkAsync(await taskOnly.GetAsync(List))).ShouldBe(["secret matter name", "task row 2"]);
        ghost.ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task Poll_returns_count_cursor_and_newer_items_and_the_etag_gives_304_until_something_changes()
    {
        var empty = await _ann.GetAsync(Poll + "?initial=true");
        var emptyBody = await OkAsync(empty);
        emptyBody.GetProperty("unreadCount").GetInt32().ShouldBe(0);
        emptyBody.GetProperty("latestId").GetInt64().ShouldBe(0);
        empty.Headers.CacheControl!.Private.ShouldBeTrue();
        empty.Headers.CacheControl.NoCache.ShouldBeTrue();
        empty.Headers.CacheControl.NoStore.ShouldBeFalse();
        (await _ann.GetAsync(List)).Headers.CacheControl!.NoStore.ShouldBeTrue(); // every other API response stays no-store

        var a = await SeedAsync(_annId, "a");
        var b = await SeedAsync(_annId, "b");

        var initial = await _ann.GetAsync(Poll + "?initial=true");
        var initialBody = await OkAsync(initial);
        initialBody.GetProperty("unreadCount").GetInt32().ShouldBe(2);
        initialBody.GetProperty("latestId").GetInt64().ShouldBe(b);
        initialBody.GetProperty("items").GetArrayLength().ShouldBe(0);
        var etag = initial.Headers.ETag!.Tag;

        var since = await OkAsync(await _ann.GetAsync(Poll + $"?sinceId={a}"));
        Messages(since).ShouldBe(["b"]);

        // Unchanged state: 304, no body.
        var notModified = await Conditional(Poll + $"?sinceId={b}", etag);
        notModified.StatusCode.ShouldBe(HttpStatusCode.NotModified);
        (await notModified.Content.ReadAsStringAsync()).ShouldBeEmpty();

        // A new notification, a read mark and a preference change each change the ETag.
        var c = await SeedAsync(_annId, "c");
        var afterNew = await Conditional(Poll + $"?sinceId={b}", etag);
        afterNew.StatusCode.ShouldBe(HttpStatusCode.OK);
        Messages(await ReadAsync(afterNew)).ShouldBe(["c"]);
        var etagNew = afterNew.Headers.ETag!.Tag;
        etagNew.ShouldNotBe(etag);

        (await _ann.PostAsync($"{List}/{a}/read", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        var afterRead = await Conditional(Poll + $"?sinceId={c}", etagNew);
        afterRead.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ReadAsync(afterRead)).GetProperty("unreadCount").GetInt32().ShouldBe(2);
        var etagRead = afterRead.Headers.ETag!.Tag;

        await OkAsync(await _ann.PutAsJsonAsync(Prefs, new { items = new[] { new { eventType = "TaskDue", enabled = false } } }));
        (await Conditional(Poll + $"?sinceId={c}", etagRead)).StatusCode.ShouldBe(HttpStatusCode.OK);

        // Someone else's ETag state is independent.
        (await Conditional(Poll + "?initial=true", etagRead)).StatusCode.ShouldBe(HttpStatusCode.OK);
        await ProblemAsync(await _ann.GetAsync(Poll + "?sinceId=-1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _ann.GetAsync(Poll + "?x=1"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Poll_caps_the_items_at_20_newest_first_and_the_unread_count_at_100()
    {
        var annId = _annId;
        var taskId = _taskId;
        var matterId = _w.MatterId;
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlAsync(
            $"INSERT dbo.Notification (RecipientUserId, EventType, ObjectKind, ObjectId, MatterId, Message, DedupeKey) SELECT TOP (130) {annId}, 'TaskAssigned', 'Task', {taskId}, {matterId}, N'n', CAST(ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS NVARCHAR(20)) FROM sys.all_objects a CROSS JOIN (SELECT TOP 2 1 x FROM sys.all_objects) b"));

        var body = await OkAsync(await _ann.GetAsync(Poll + "?sinceId=0"));
        body.GetProperty("items").GetArrayLength().ShouldBe(20);
        body.GetProperty("unreadCount").GetInt32().ShouldBe(100);
        var ids = body.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetInt64()).ToArray();
        ids.ShouldBe(ids.OrderByDescending(x => x).ToArray());
        ids[0].ShouldBe(body.GetProperty("latestId").GetInt64());
    }

    [Fact]
    public async Task The_overdue_notices_of_one_day_are_one_group_and_one_entry_of_the_unread_count()
    {
        var day = new DateTime(2026, 10, 22, 14, 0, 0, DateTimeKind.Utc);
        var ids = new List<long>();
        for (var i = 0; i < 5; i++)
            ids.Add(await SeedAsync(_annId, $"Overdue by 3 days - TSK-{i} \"T\" on M (Intake)", type: "MatterTaskOverdue", key: $"overdue:{i}:2026-10-19", created: day.AddMinutes(i)));
        // The assignee kind is its own group; an overdue notice of another day is its own; a due-soon notice and an assignment are no group at all.
        var own1 = await SeedAsync(_annId, "Overdue - TSK-8", type: "TaskDue", key: "overdue:2026-10-19", created: day);
        var own2 = await SeedAsync(_annId, "Overdue - TSK-9", type: "TaskDue", key: "overdue:2026-10-20", created: day.AddMinutes(1));
        var otherDay = await SeedAsync(_annId, "Overdue by 4 days - TSK-6", type: "MatterTaskOverdue", key: "overdue:6:2026-10-18", created: day.AddDays(1));
        await SeedAsync(_annId, "Due tomorrow - TSK-7", type: "TaskDue", key: "soon:2026-10-23", created: day);
        await SeedAsync(_annId, "Assigned to you - TSK-1", created: day);

        var list = await OkAsync(await _ann.GetAsync(List + "?pageSize=50"));
        var keys = list.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("id").GetInt64(), i => i.TryGetProperty("groupKey", out var g) && g.ValueKind == JsonValueKind.String ? g.GetString() : null);
        ids.ForEach(id => keys[id].ShouldBe("overdue:2026-10-22:manager"));
        keys[own1].ShouldBe("overdue:2026-10-22:assignee");
        keys[own2].ShouldBe("overdue:2026-10-22:assignee");
        keys[otherDay].ShouldBe("overdue:2026-10-23:manager");
        keys.Values.Count(k => k is null).ShouldBe(2);

        // 10 notices, 5 entries: the manager group, the assignee group, the other day, the due-soon notice and the assignment.
        (await OkAsync(await _ann.GetAsync(Poll + "?initial=true"))).GetProperty("unreadCount").GetInt32().ShouldBe(5);

        // Reading one notice of a group leaves the group unread; reading the whole group takes one entry off. Nothing was deleted.
        (await _ann.PostAsync($"{List}/{ids[0]}/read", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await OkAsync(await _ann.GetAsync(Poll + "?initial=true"))).GetProperty("unreadCount").GetInt32().ShouldBe(5);
        foreach (var id in ids.Skip(1))
            (await _ann.PostAsync($"{List}/{id}/read", null)).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await OkAsync(await _ann.GetAsync(Poll + "?initial=true"))).GetProperty("unreadCount").GetInt32().ShouldBe(4);
        (await OkAsync(await _ann.GetAsync(List + "?pageSize=50"))).GetProperty("totalCount").GetInt32().ShouldBe(10);
    }

    [Fact]
    public async Task Preferences_default_to_on_store_only_off_rows_and_reject_unknown_or_duplicate_types()
    {
        var initial = await OkAsync(await _ann.GetAsync(Prefs));
        var items = initial.GetProperty("items").EnumerateArray().ToArray();
        items.Length.ShouldBe(8);
        items.ShouldAllBe(i => i.GetProperty("enabled").GetBoolean());
        items.Select(i => i.GetProperty("eventType").GetString()).ShouldBe(
            ["TaskAssigned", "TaskDue", "TaskComment", "MatterTaskOverdue", "MatterTaskCreated", "MatterTaskStalled", "MatterManagerSet", "PodTaskUnassigned"]);
        items[0].GetProperty("group").GetString().ShouldBe("Technician");
        items[7].GetProperty("group").GetString().ShouldBe("PodLead");
        (await _factory.CountAsync<NotificationPreference>()).ShouldBe(0);

        var off = await OkAsync(await _ann.PutAsJsonAsync(Prefs, new { items = new[] { new { eventType = "TaskAssigned", enabled = false }, new { eventType = "PodTaskUnassigned", enabled = false } } }));
        off.GetProperty("items").EnumerateArray().Count(i => !i.GetProperty("enabled").GetBoolean()).ShouldBe(2);
        (await _factory.CountAsync<NotificationPreference>()).ShouldBe(2);

        // Only the caller's switches.
        (await OkAsync(await _bo.GetAsync(Prefs))).GetProperty("items").EnumerateArray().ShouldAllBe(i => i.GetProperty("enabled").GetBoolean());

        // Back on removes the row; a type left out keeps its value.
        var back = await OkAsync(await _ann.PutAsJsonAsync(Prefs, new { items = new[] { new { eventType = "TaskAssigned", enabled = true } } }));
        back.GetProperty("items").EnumerateArray().Count(i => !i.GetProperty("enabled").GetBoolean()).ShouldBe(1);
        (await _factory.CountAsync<NotificationPreference>()).ShouldBe(1);

        await ProblemAsync(await _ann.PutAsJsonAsync(Prefs, new { items = new[] { new { eventType = "Nope", enabled = false } } }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _ann.PutAsJsonAsync(Prefs, new { items = new[] { new { eventType = "TaskMention", enabled = false } } }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(
            await _ann.PutAsJsonAsync(Prefs, new { items = new[] { new { eventType = "TaskDue", enabled = false }, new { eventType = "TaskDue", enabled = true } } }),
            HttpStatusCode.BadRequest,
            "VALIDATION_FAILED");
        (await _factory.CountAsync<NotificationPreference>()).ShouldBe(1);
    }

    [Fact]
    public async Task The_publisher_adds_rows_to_the_open_unit_of_work_so_a_rollback_creates_none_and_a_commit_creates_them()
    {
        NotificationRequest Req(int actor, params int[] to) =>
            new(NotificationEventType.TaskAssigned, NotificationObjectKinds.Task, _taskId, _w.MatterId, actor, "Hello", "assign:1", to);

        // Rolled back with the action: nothing remains.
        await InScopeAsync(async (db, publisher) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            (await publisher.PublishAsync([Req(_boId, _annId, _boId)])).ShouldBe(1); // the actor (Bo) is dropped
            await db.SaveChangesAsync();
            await tx.RollbackAsync();
        });
        (await _factory.CountAsync<Notification>()).ShouldBe(0);

        // Committed with the action.
        await InScopeAsync(async (db, publisher) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            (await publisher.PublishAsync([Req(_boId, _annId)])).ShouldBe(1);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });
        var rows = await _factory.WithDbAsync(db => db.Set<Notification>().AsNoTracking().ToListAsync());
        var row = rows.ShouldHaveSingleItem();
        row.RecipientUserId.ShouldBe(_annId);
        row.EventType.ShouldBe("TaskAssigned");
        row.ActorUserId.ShouldBe(_boId);
        row.ReadUtc.ShouldBeNull();

        // The same key for the same recipient twice is refused by the unique index (a double publish cannot create two rows).
        await Should.ThrowAsync<DbUpdateException>(() => InScopeAsync(async (db, publisher) =>
        {
            await publisher.PublishAsync([Req(_boId, _annId)]);
            await db.SaveChangesAsync();
        }));
    }

    [Fact]
    public async Task A_switched_off_event_type_creates_no_row_for_that_person_only()
    {
        await OkAsync(await _ann.PutAsJsonAsync(Prefs, new { items = new[] { new { eventType = "TaskAssigned", enabled = false } } }));

        await InScopeAsync(async (db, publisher) =>
        {
            var request = new NotificationRequest(NotificationEventType.TaskAssigned, NotificationObjectKinds.Task, _taskId, _w.MatterId, null, "Hello", "assign:2", [_annId, _boId]);
            (await publisher.PublishAsync([request])).ShouldBe(1);
            await db.SaveChangesAsync();
        });

        (await _factory.WithDbAsync(db => db.Set<Notification>().Select(n => n.RecipientUserId).ToListAsync())).ShouldBe([_boId]);
    }

    [Fact]
    public async Task The_poll_and_the_list_use_a_fixed_number_of_statements_whatever_the_number_of_rows()
    {
        var commands = new CommandLog();
        await using var logged = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(commands);
        })));
        var http = logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", @"KE\ann");

        async Task<(int Poll, int Page)> CountAsync()
        {
            await OkAsync(await http.GetAsync(Poll + "?sinceId=0")); // warm up (identity cache)
            commands.Clear();
            await OkAsync(await http.GetAsync(Poll + "?sinceId=0"));
            var poll = commands.Snapshot().Count;
            commands.Clear();
            await OkAsync(await http.GetAsync(List));
            return (poll, commands.Snapshot().Count);
        }

        for (var i = 0; i < 5; i++)
            await SeedAsync(_annId, "m" + i);
        var few = await CountAsync();
        for (var i = 0; i < 45; i++)
            await SeedAsync(_annId, "x" + i);
        var many = await CountAsync();

        many.ShouldBe(few);
        few.Poll.ShouldBeLessThanOrEqualTo(5);
        few.Page.ShouldBeLessThanOrEqualTo(4);
    }

    private Task<HttpResponseMessage> Conditional(string url, string etag)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("If-None-Match", etag);
        return _ann.SendAsync(request);
    }

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response) => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    /// <summary>Runs <paramref name="action"/> in one DI scope: the publisher shares the scope's DbContext, as it does inside a command.</summary>
    private async Task InScopeAsync(Func<DbContext, INotificationPublisher, Task> action)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        await action(scope.ServiceProvider.GetRequiredService<DbContext>(), scope.ServiceProvider.GetRequiredService<INotificationPublisher>());
    }
}
