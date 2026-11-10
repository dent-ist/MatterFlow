using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.Notifications.Infrastructure.Scheduling;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Notifications;

/// <summary>
/// Notifications under the sensitive-matter rule (epic #788, SM-12, inventory R47 to R52): a notification is only created for a recipient who can see its subject,
/// the list, poll, unread count and mark-read follow the recipient's CURRENT access (rows disappear when it ends and come back when it returns), and the scheduler
/// jobs keep notifying the assignees and managers who may see the task.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveNotificationsTests(SqlServerFixture sql)
{
    private const string List = "/api/v1/me/notifications";
    private const string Poll = "/api/v1/me/notifications/poll?initial=true";

    private static async Task<JsonElement> GetAsync(HttpClient client, string url) => await OkAsync(await client.GetAsync(url));

    private static async Task<int> UnreadAsync(HttpClient c) => (await GetAsync(c, Poll)).GetProperty("unreadCount").GetInt32();

    private static async Task<long[]> IdsAsync(HttpClient c) => [.. (await GetAsync(c, List + "?pageSize=100")).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("objectId").GetInt64()).Order()];

    private static async Task AssignAsync(SensitiveUniverse u, long task, int? userId, int? podId = null)
    {
        var fresh = await u.H.GetTaskAsync(task);
        await OkAsync(await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{task}/assignment", new { rowVersion = RowVersion(fresh), userId, podId }));
    }

    [Fact]
    public async Task With_the_switch_off_a_pod_lead_is_told_about_a_task_of_a_sensitive_matter_as_before()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: false);
        try
        {
            await PodWithLeadAsync(u);
            await CreateInPodAsync(u, u.S1);
            (await UnreadAsync(u.UnrelatedClient)).ShouldBe(1);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    private static async Task<int> PodWithLeadAsync(SensitiveUniverse u)
    {
        var roleId = await u.H.Factory.WithDbAsync(db => db.Set<MatterFlow.Identity.Domain.Role>().Where(r => r.Name == "Pod Lead").Select(r => r.Id).SingleAsync());
        await u.H.Factory.GrantRoleAsync(@"KE\unrelated", roleId);
        return await u.H.CreatePodAsync("Review pod", u.Unrelated);
    }

    private static async Task<long> CreateInPodAsync(SensitiveUniverse u, int matter)
    {
        var pod = (await u.H.ScalarAsync("SELECT TOP 1 PodId FROM dbo.Pod ORDER BY PodId DESC"));
        var task = await u.H.CreateTaskAsync(u.World, false, new() { ["matterId"] = matter, ["assignedPodId"] = pod });
        return TaskId(task);
    }

    [Fact]
    public async Task A_recipient_who_cannot_see_the_subject_gets_no_notification_and_one_who_can_does()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            await PodWithLeadAsync(u);

            // The lead of the pod cannot see S1: the task created into the pod tells them nothing; a task of the normal matter does.
            await CreateInPodAsync(u, u.S1);
            (await UnreadAsync(u.UnrelatedClient)).ShouldBe(0);
            var normal = await CreateInPodAsync(u, u.N1);
            (await UnreadAsync(u.UnrelatedClient)).ShouldBe(1);
            (await IdsAsync(u.UnrelatedClient)).ShouldBe([normal]);

            // The assignee of a task on a sensitive matter is told (they see their task); the managers of the matter are told that someone created it.
            await AssignAsync(u, u.TS2, u.Unrelated);
            (await IdsAsync(u.UnrelatedClient)).ShouldBe(new[] { normal, u.TS2 }.Order().ToArray());
            var created = TaskId(await u.H.CreateTaskAsync(u.World, false, new() { ["matterId"] = u.S1 }));
            (await IdsAsync(u.PmPrimaryClient)).ShouldContain(created);
            (await IdsAsync(u.PmSecondaryClient)).ShouldContain(created);
            (await IdsAsync(u.AssigneeClient)).ShouldBe([u.TS3]); // only the one about their own task, made when the universe was built
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Notifications_disappear_when_access_ends_and_reappear_when_it_returns()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // P5 is assigned the hidden S2 task: one unread notification.
            await AssignAsync(u, u.TS2, u.Unrelated);
            (await UnreadAsync(u.UnrelatedClient)).ShouldBe(1);
            var listed = (await GetAsync(u.UnrelatedClient, List)).GetProperty("items")[0];
            var id = listed.GetProperty("id").GetInt64();
            listed.GetProperty("message").GetString()!.ShouldStartWith("Assigned to you - ");

            // The task is reassigned: the next poll, list, unread count, mark-read and read-all show nothing of it.
            await AssignAsync(u, u.TS2, u.Assignee);
            (await UnreadAsync(u.UnrelatedClient)).ShouldBe(0);
            (await IdsAsync(u.UnrelatedClient)).ShouldBeEmpty();
            (await GetAsync(u.UnrelatedClient, "/api/v1/me/notifications/poll?sinceId=0")).GetProperty("items").GetArrayLength().ShouldBe(0);
            (await u.UnrelatedClient.PostAsync($"{List}/{id}/read", null)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await OkAsync(await u.UnrelatedClient.PostAsync($"{List}/read-all", null))).GetProperty("marked").GetInt32().ShouldBe(0);

            // Nothing was deleted: when the task comes back the first notification is there again, still unread (read-all did not touch it), next to the new assignment's.
            await AssignAsync(u, u.TS2, u.Unrelated);
            (await UnreadAsync(u.UnrelatedClient)).ShouldBe(2);
            (await GetAsync(u.UnrelatedClient, List)).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetInt64()).ShouldContain(id);
            (await IdsAsync(u.UnrelatedClient)).ShouldContain(u.TS2);

            // A manager loses the matter: the "created" notification goes, and returns with the manager place.
            var created = TaskId(await u.H.CreateTaskAsync(u.World, false, new() { ["matterId"] = u.S1 }));
            (await UnreadAsync(u.PmPrimaryClient)).ShouldBe(1);
            var matter = await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S1}");
            await OkAsync(await u.H.Admin.PutAsJsonAsync($"/api/v1/matters/{u.S1}/managers", new { primaryManagerId = (int?)null, secondaryManagerId = u.PmSecondary, rowVersion = matter.GetProperty("rowVersion").GetString() }));
            (await UnreadAsync(u.PmPrimaryClient)).ShouldBe(0);
            (await IdsAsync(u.PmPrimaryClient)).ShouldNotContain(created);
            (await UnreadAsync(u.PmSecondaryClient)).ShouldBe(1);
            matter = await GetAsync(u.H.Admin, $"/api/v1/matters/{u.S1}");
            await OkAsync(await u.H.Admin.PutAsJsonAsync($"/api/v1/matters/{u.S1}/managers", new { primaryManagerId = u.PmPrimary, secondaryManagerId = u.PmSecondary, rowVersion = matter.GetProperty("rowVersion").GetString() }));
            (await IdsAsync(u.PmPrimaryClient)).ShouldContain(created);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task The_scheduler_jobs_notify_the_assignee_and_the_managers_who_may_see_the_task()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // Overdue tasks on S1 (managers P1 and P2) and S3 (assignee P3), and one on S2 that nobody manages: the due job tells the assignee (event 2) and the
            // managers (event 4), and nobody else.
            async Task<long> OverdueAsync(int matter, int? assignee)
            {
                var extra = new Dictionary<string, object?> { ["matterId"] = matter, ["dueDate"] = "2026-01-05" };
                if (assignee is { } a)
                    extra["assignedUserId"] = a;
                return TaskId(await u.H.CreateTaskAsync(u.World, false, extra));
            }

            var o1 = await OverdueAsync(u.S1, null);
            var o3 = await OverdueAsync(u.S3, u.Assignee);
            var o2 = await OverdueAsync(u.S2, null);
            await using (var scope = u.H.Factory.Services.CreateAsyncScope())
            {
                var run = await scope.ServiceProvider.GetRequiredService<NotificationScheduler>().RunOnceAsync(default, true);
                run.Failed.ShouldBeEmpty();
            }

            (await IdsAsync(u.PmPrimaryClient)).ShouldContain(o1);
            (await IdsAsync(u.PmSecondaryClient)).ShouldContain(o1);
            (await IdsAsync(u.AssigneeClient)).ShouldContain(o3);
            var rows = await u.H.Factory.WithDbAsync(db => db.Set<MatterFlow.Notifications.Domain.Notification>().Where(n => n.EventType == "TaskDue" || n.EventType == "MatterTaskOverdue").ToListAsync());
            rows.Count.ShouldBeGreaterThan(0);
            rows.ShouldAllBe(n => n.ObjectId == o1 || n.ObjectId == o3);
            (await IdsAsync(u.UnrelatedClient)).ShouldBeEmpty();
            (await IdsAsync(u.ViewerClient)).ShouldBeEmpty();
            (await IdsAsync(u.PmPrimaryClient)).ShouldNotContain(o2);

            // The assignee is reassigned: the overdue notification they got is gone for them at once.
            await AssignAsync(u, o3, u.Unrelated);
            (await IdsAsync(u.AssigneeClient)).ShouldNotContain(o3);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
