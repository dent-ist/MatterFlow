using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Visibility;

/// <summary>
/// The visibility port against real SQL Server (epic #788, SM-02): the six personas of README 12.1/12.2 over a small universe, with the go-live
/// switch off (nothing changes) and on, and immediate effect of manager, assignment and permission changes.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MatterVisibilityPortTests(SqlServerFixture sql)
{
    private Task<SensitiveUniverse> BuildAsync(bool enabled) => SensitiveUniverse.BuildAsync(sql, enabled);

    private sealed record Seen(bool Enabled, int? UserId, bool SeeAll, int[] Matters, long[] Tasks, long[] TasksOfVisibleMatters, long[] TasksVisible, bool? CanSeeMatter, bool? CanSeeTask);

    private static async Task<Seen> ProbeAsync(HttpClient client, string query = "")
    {
        var json = await OkAsync(await client.GetAsync("/api/v1/test/visibility" + query));
        return new Seen(
            json.GetProperty("enabled").GetBoolean(),
            json.GetProperty("userId").ValueKind == JsonValueKind.Null ? null : json.GetProperty("userId").GetInt32(),
            json.GetProperty("seeAll").GetBoolean(),
            [.. json.GetProperty("matters").EnumerateArray().Select(e => e.GetInt32())],
            [.. json.GetProperty("tasks").EnumerateArray().Select(e => e.GetInt64())],
            [.. json.GetProperty("tasksOfVisibleMatters").EnumerateArray().Select(e => e.GetInt64())],
            [.. json.GetProperty("tasksVisible").EnumerateArray().Select(e => e.GetInt64())],
            json.GetProperty("canSeeMatter").ValueKind == JsonValueKind.Null ? null : json.GetProperty("canSeeMatter").GetBoolean(),
            json.GetProperty("canSeeTask").ValueKind == JsonValueKind.Null ? null : json.GetProperty("canSeeTask").GetBoolean());
    }

    private static int[] Sorted(params int[] ids) => [.. ids.Order()];

    private static long[] Sorted(params long[] ids) => [.. ids.Order()];

    [Fact]
    public async Task With_the_switch_off_every_persona_sees_everything()
    {
        var u = await BuildAsync(enabled: false);
        try
        {
            foreach (var client in new[] { u.PmPrimaryClient, u.AssigneeClient, u.UnrelatedClient, u.ViewerClient })
            {
                var seen = await ProbeAsync(client);
                seen.Enabled.ShouldBeFalse();
                seen.Matters.ShouldBe(Sorted(u.N1, u.S1, u.S2, u.S3));
                seen.Tasks.ShouldBe(Sorted(u.TN1, u.TS1, u.TS2, u.TS3));
                seen.TasksOfVisibleMatters.ShouldBe(seen.Tasks);
                seen.TasksVisible.ShouldBe(seen.Tasks);
            }
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task With_the_switch_on_each_persona_sees_exactly_what_the_rule_gives_them()
    {
        var u = await BuildAsync(enabled: true);
        try
        {
            // P1 / P2: the normal matter and the sensitive matter they manage, whole (all its tasks).
            foreach (var manager in new[] { u.PmPrimaryClient, u.PmSecondaryClient })
            {
                var seen = await ProbeAsync(manager);
                seen.Enabled.ShouldBeTrue();
                seen.SeeAll.ShouldBeFalse();
                seen.Matters.ShouldBe(Sorted(u.N1, u.S1));
                seen.Tasks.ShouldBe(Sorted(u.TN1, u.TS1));
            }

            // P3 assignee: no sensitive matter at all, but the task assigned to them (and nothing else of that matter).
            var assignee = await ProbeAsync(u.AssigneeClient);
            assignee.Matters.ShouldBe(Sorted(u.N1));
            assignee.Tasks.ShouldBe(Sorted(u.TN1, u.TS3));
            assignee.TasksOfVisibleMatters.ShouldBe(Sorted(u.TN1));
            assignee.TasksVisible.ShouldBe(Sorted(u.TN1, u.TS3));

            // P4: sees all, including the sensitive matter without a manager.
            var viewer = await ProbeAsync(u.ViewerClient);
            viewer.SeeAll.ShouldBeTrue();
            viewer.Matters.ShouldBe(Sorted(u.N1, u.S1, u.S2, u.S3));
            viewer.Tasks.ShouldBe(Sorted(u.TN1, u.TS1, u.TS2, u.TS3));

            // P5: only the normal matter.
            var unrelated = await ProbeAsync(u.UnrelatedClient);
            unrelated.Matters.ShouldBe(Sorted(u.N1));
            unrelated.Tasks.ShouldBe(Sorted(u.TN1));

            // P6b: no relevant permission, the policy answers 403 before the port is reached.
            (await u.NoPermClient.GetAsync("/api/v1/test/visibility")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

            // Single-record gates: a hidden record answers like a missing one.
            (await ProbeAsync(u.UnrelatedClient, $"?matterId={u.S1}&taskId={u.TS1}")).ShouldSatisfyAllConditions(
                s => s.CanSeeMatter.ShouldBe(false),
                s => s.CanSeeTask.ShouldBe(false));
            (await ProbeAsync(u.UnrelatedClient, "?matterId=999999&taskId=999999")).ShouldSatisfyAllConditions(
                s => s.CanSeeMatter.ShouldBe(false),
                s => s.CanSeeTask.ShouldBe(false));
            (await ProbeAsync(u.AssigneeClient, $"?matterId={u.S3}&taskId={u.TS3}")).ShouldSatisfyAllConditions(
                s => s.CanSeeMatter.ShouldBe(false), // the assignee never sees the matter itself
                s => s.CanSeeTask.ShouldBe(true));
            (await ProbeAsync(u.PmPrimaryClient, $"?matterId={u.S1}&taskId={u.TS1}")).ShouldSatisfyAllConditions(
                s => s.CanSeeMatter.ShouldBe(true),
                s => s.CanSeeTask.ShouldBe(true));
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Access_ends_and_starts_on_the_next_request_when_a_manager_an_assignment_or_a_permission_changes()
    {
        var u = await BuildAsync(enabled: true);
        try
        {
            (await ProbeAsync(u.PmSecondaryClient)).Matters.ShouldContain(u.S1);

            // Manager removed: gone at once.
            await u.H.ExecuteAsync($"UPDATE dbo.Matter SET SecondaryManagerId = NULL WHERE MatterId = {u.S1}");
            var seen = await ProbeAsync(u.PmSecondaryClient);
            seen.Matters.ShouldBe(Sorted(u.N1));
            seen.Tasks.ShouldBe(Sorted(u.TN1));

            // Task reassigned: the former assignee loses it, the new one gets it.
            await u.H.ExecuteAsync($"UPDATE dbo.Task SET AssignedUserId = {u.Unrelated} WHERE TaskId = {u.TS3}");
            (await ProbeAsync(u.AssigneeClient)).Tasks.ShouldBe(Sorted(u.TN1));
            (await ProbeAsync(u.UnrelatedClient)).Tasks.ShouldBe(Sorted(u.TN1, u.TS3));

            // Permission granted and taken away through the role API: effective on the next request (the cached snapshot is invalidated).
            var roles = await OkAsync(await u.H.Admin.GetAsync("/api/v1/roles"));
            var roleId = roles.EnumerateArray().Single(r => r.GetProperty("name").GetString() == @"Role KE\unrelated").GetProperty("roleId").GetInt32();
            var detail = await OkAsync(await u.H.Admin.GetAsync($"/api/v1/roles/{roleId}"));
            var codes = detail.GetProperty("permissionCodes").EnumerateArray().Select(e => e.GetString()!).ToList();

            async Task SetPermissionsAsync(IEnumerable<string> next)
            {
                var body = new Dictionary<string, object?>
                {
                    ["name"] = detail.GetProperty("name").GetString(),
                    ["description"] = null,
                    ["permissionCodes"] = next.ToArray(),
                    ["rowVersion"] = (await OkAsync(await u.H.Admin.GetAsync($"/api/v1/roles/{roleId}"))).GetProperty("rowVersion").GetString(),
                };
                (await u.H.Admin.PutAsJsonAsync($"/api/v1/roles/{roleId}", body)).StatusCode.ShouldBe(HttpStatusCode.OK);
            }

            await SetPermissionsAsync([.. codes, "Matter.ViewSensitive"]);
            var withGrant = await ProbeAsync(u.UnrelatedClient);
            withGrant.SeeAll.ShouldBeTrue();
            withGrant.Matters.ShouldBe(Sorted(u.N1, u.S1, u.S2, u.S3));

            await SetPermissionsAsync(codes);
            var withoutGrant = await ProbeAsync(u.UnrelatedClient);
            withoutGrant.SeeAll.ShouldBeFalse();
            withoutGrant.Matters.ShouldBe(Sorted(u.N1));
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task A_background_job_resolves_a_recipient_from_the_current_grants_and_never_runs_as_see_all()
    {
        var u = await BuildAsync(enabled: true);
        try
        {
            var viewer = await ProbeAsync(u.PmPrimaryClient, $"?forUser={u.Viewer}");
            viewer.UserId.ShouldBe(u.Viewer);
            viewer.SeeAll.ShouldBeTrue();
            viewer.Matters.ShouldBe(Sorted(u.N1, u.S1, u.S2, u.S3));

            var assignee = await ProbeAsync(u.PmPrimaryClient, $"?forUser={u.Assignee}");
            assignee.SeeAll.ShouldBeFalse();
            assignee.Tasks.ShouldBe(Sorted(u.TN1, u.TS3));

            // An inactive user and an unknown id are never see-all.
            await u.H.ExecuteAsync($"UPDATE dbo.AppUser SET IsActive = 0 WHERE UserId = {u.Viewer}");
            (await ProbeAsync(u.PmPrimaryClient, $"?forUser={u.Viewer}")).SeeAll.ShouldBeFalse();
            (await ProbeAsync(u.PmPrimaryClient, "?forUser=999999")).Matters.ShouldBe(Sorted(u.N1));

            // The administrator is see-all through the System Admin role, with no grant row.
            (await ProbeAsync(u.H.Admin)).SeeAll.ShouldBeTrue();
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
