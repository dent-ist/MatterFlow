using System.Net.Http.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Security;

/// <summary>
/// Mutation-style tests of the persona walk (epic #788, SM-16, README 12.2 step 5 and 12.3): the walk must FAIL when the rule is bypassed (a read path that ignores it), and
/// access that ends or begins must show on the very next request for every endpoint, not only for the ones a feature suite happens to check.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveMutationTests(SqlServerFixture sql)
{
    [Fact]
    public async Task The_walk_is_not_vacuous_it_reports_leaks_and_unequal_404s_when_the_rule_is_bypassed()
    {
        // The go-live switch off is the strongest bypass: every read path ignores the rule at once. The walk, still judging by the ON matrix, must say so loudly.
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: false);
        try
        {
            var walk = PersonaWalk.Create(u, await PersonaWalk.PrepareAsync(u));
            await walk.RunAsync(walk.Personas());
            walk.Violations.Count(v => v.Contains("leaked ZZSENS-", StringComparison.Ordinal)).ShouldBeGreaterThan(20);
            walk.Violations.Count(v => v.Contains("expected 404", StringComparison.Ordinal)).ShouldBeGreaterThan(10);
            walk.Violations.ShouldContain(v => v.StartsWith("P5 unrelated", StringComparison.Ordinal));
            walk.Violations.ShouldContain(v => v.StartsWith("P3 task assignee", StringComparison.Ordinal));
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    [Fact]
    public async Task Removing_a_manager_and_moving_a_task_change_every_endpoint_on_the_very_next_request()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var walk = PersonaWalk.Create(u, await PersonaWalk.PrepareAsync(u));
            u.H.Factory.InvalidateAll();

            // Warm every cache (dashboard, My Matters, notifications) with the first walk, then change access and walk again without any wait.
            await walk.RunAsync(walk.Personas());
            walk.Violations.ShouldBeEmpty(string.Join(Environment.NewLine, walk.Violations.Take(20)));

            var matter = await OkAsync(await u.H.Admin.GetAsync($"/api/v1/matters/{u.S1}"));
            await OkAsync(await u.H.Admin.PutAsJsonAsync($"/api/v1/matters/{u.S1}/managers", new { primaryManagerId = (int?)null, secondaryManagerId = u.PmSecondary, rowVersion = matter.GetProperty("rowVersion").GetString() }));
            var task = await u.H.GetTaskAsync(u.TS3);
            await OkAsync(await u.H.Admin.PostAsJsonAsync($"/api/v1/tasks/{u.TS3}/assignment", new { rowVersion = RowVersion(task), userId = u.Unrelated, podId = (int?)null }));

            var stale = PersonaWalk.Create(u, walk.Ids);
            await stale.RunAsync(stale.Personas()); // the old matrix: P1 still sees S1, P3 still has TS3
            stale.Violations.ShouldContain(v => v.StartsWith("P1 primary manager", StringComparison.Ordinal) && v.Contains("for visible", StringComparison.Ordinal));
            stale.Violations.ShouldContain(v => v.StartsWith("P3 task assignee", StringComparison.Ordinal));

            var fresh = PersonaWalk.Create(u, walk.Ids);
            await fresh.RunAsync(fresh.Personas(primaryStillManages: false, ts3MovedToUnrelated: true));
            fresh.Violations.ShouldBeEmpty(string.Join(Environment.NewLine, fresh.Violations.Take(20)));
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }
}
