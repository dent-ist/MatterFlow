using LptHub.IntegrationTests.Fixtures;
using LptHub.SharedKernel.Visibility;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace LptHub.IntegrationTests.Visibility;

/// <summary>
/// The SQL twin of the Task Type access rule (epic #1397, issue #1400, README 4.3): <c>dbo.fnTaskVisible(@UserId, @SeeAll, @IsAdmin)</c> gives exactly the tasks the C# port gives
/// (<c>IMatterVisibility.VisibleTasks</c>, with the viewer's hidden types read from the database), for every combination of person, see-all and System Admin, with both rules on.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeVisibilityFunctionTests(SqlServerFixture sql)
{
    [Fact]
    public async Task The_sql_function_and_the_csharp_port_agree_for_every_person_and_flag_combination()
    {
        var u = await TaskTypeUniverse.BuildAsync(sql, typeRule: true, sensitiveRule: true);
        try
        {
            // A sensitive matter with a manager and one task of each type, so both terms matter.
            var sensitiveMatter = await u.H.CreateMatterAsync("343", "40");
            await u.H.ExecuteAsync($"UPDATE dbo.Matter SET IsSensitive = 1, PrimaryManagerId = {u.PlainId} WHERE MatterId = {sensitiveMatter}");
            await u.H.CreateTaskAsync(u.OpenWorld, false, new() { ["matterId"] = sensitiveMatter, ["assignedUserId"] = u.TechId });
            await u.H.CreateTaskAsync(u.SecretWorld, false, new() { ["matterId"] = sensitiveMatter, ["assignedUserId"] = u.ViewerId });
            await u.H.CreateTaskAsync(u.SecretWorld, false, new() { ["matterId"] = sensitiveMatter, ["assignedUserId"] = u.PlainId });
            u.H.Factory.InvalidateAll();

            var cs = await u.H.Factory.WithDbAsync(db => Task.FromResult(db.Database.GetConnectionString()!));
            await using var scope = u.H.Factory.Services.CreateAsyncScope();
            var port = scope.ServiceProvider.GetRequiredService<IMatterVisibility>();
            var checkedCombinations = 0;
            int?[] people = [null, 999_999, u.ViewerId, u.OutsiderId, u.PlainId, u.TechId];
            foreach (var person in people)
            {
                foreach (var seeAll in new[] { false, true })
                {
                    foreach (var admin in new[] { false, true })
                    {
                        var viewer = new Viewer(person, seeAll || admin, admin);
                        var expected = await port.VisibleTasks(viewer).Select(t => t.TaskId).OrderBy(i => i).ToListAsync();
                        var actual = await ReadAsync(cs, person, viewer.SeeAll, admin);
                        actual.ShouldBe(expected, $"user {person?.ToString() ?? "none"}, seeAll {viewer.SeeAll}, admin {admin}");
                        checkedCombinations++;
                    }
                }
            }

            checkedCombinations.ShouldBe(24);

            // The function and the port really hide something for a person without the role, and a role deactivated in the database hides it from the role holder as well.
            (await ReadAsync(cs, u.PlainId, false, false)).Count.ShouldBeLessThan((await ReadAsync(cs, u.PlainId, true, true)).Count);
            await u.H.ExecuteAsync($"UPDATE dbo.Role SET IsActive = 0 WHERE RoleId = {u.ReviewerRole}");
            var withoutRole = await ReadAsync(cs, u.ViewerId, false, false);
            var viaPort = await port.VisibleTasks(new Viewer(u.ViewerId, false)).Select(t => t.TaskId).OrderBy(i => i).ToListAsync();
            withoutRole.ShouldBe(viaPort);
            withoutRole.ShouldNotContain(u.T3);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    private static async Task<List<long>> ReadAsync(string cs, int? user, bool seeAll, bool admin)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT TaskId FROM dbo.fnTaskVisible(@u, @s, @a) ORDER BY TaskId";
        cmd.Parameters.AddWithValue("@u", (object?)user ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@s", seeAll ? 1 : 0);
        cmd.Parameters.AddWithValue("@a", admin ? 1 : 0);
        var rows = new List<long>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
            rows.Add(r.GetInt64(0));
        return rows;
    }
}
