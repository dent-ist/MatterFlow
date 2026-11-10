using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>Security review SEC-18: startup seeds are serialized, independent of Migrations:Enabled, and the starter roles are seeded once.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class StartupSeedTests(SqlServerFixture sql)
{
    [Fact]
    public async Task Two_instances_starting_together_both_start_and_leave_one_catalog()
    {
        var cs = await sql.CreateDatabaseAsync();
        await using var first = new DatabaseApiFactory(cs);
        await using var second = new DatabaseApiFactory(cs);

        var starts = await Task.WhenAll(
            Task.Run(() => first.CreateClient().GetAsync("/health/live")),
            Task.Run(() => second.CreateClient().GetAsync("/health/live")));

        starts.ShouldAllBe(r => r.IsSuccessStatusCode);
        (await first.CountAsync<Permission>()).ShouldBe(Permissions.All.Count);
        (await first.CountAsync<Role>()).ShouldBe(6);
    }

    [Fact]
    public async Task Seeds_also_run_when_a_separate_step_migrated_the_database()
    {
        var cs = await sql.CreateDatabaseAsync();
        await using var migrated = new DatabaseApiFactory(cs);
        using (migrated.CreateClient())
        {
        }

        // The catalog table is out of step with the code (here: a code marked inactive); the next start syncs it although Migrations are off.
        await migrated.WithDbAsync(async db => await db.Set<Permission>().Where(p => p.Code == Permissions.Audit.View).ExecuteUpdateAsync(s => s.SetProperty(p => p.IsActive, false)));
        await using var noMigrations = migrated.WithWebHostBuilder(b => b.UseSetting("Migrations:Enabled", "false"));
        using (noMigrations.CreateClient())
        {
        }

        (await migrated.WithDbAsync(db => db.Set<Permission>().AnyAsync(p => p.Code == Permissions.Audit.View && p.IsActive))).ShouldBeTrue();
    }

    [Fact]
    public async Task Deleting_every_custom_role_does_not_bring_the_starter_roles_back()
    {
        var cs = await sql.CreateDatabaseAsync();
        await using var factory = new DatabaseApiFactory(cs);
        using (factory.CreateClient())
        {
        }

        (await factory.CountAsync<Role>()).ShouldBe(6);
        await factory.WithDbAsync(async db =>
        {
            await db.Set<RolePermission>().ExecuteDeleteAsync();
            await db.Set<UserRole>().Where(ur => !ur.Role.IsSystemAdmin).ExecuteDeleteAsync();
            await db.Set<Role>().Where(r => !r.IsSystemAdmin).ExecuteDeleteAsync();
        });
        (await factory.CountAsync<Role>()).ShouldBe(1);

        await using var restarted = new DatabaseApiFactory(cs);
        using (restarted.CreateClient())
        {
        }

        (await restarted.CountAsync<Role>()).ShouldBe(1);
    }

    [Fact]
    public async Task A_database_without_the_marker_but_with_roles_is_marked_not_reseeded()
    {
        var cs = await sql.CreateDatabaseAsync();
        await using var factory = new DatabaseApiFactory(cs);
        using (factory.CreateClient())
        {
        }

        await factory.WithDbAsync(async db => await db.Database.ExecuteSqlRawAsync("DELETE dbo.SeedMarker"));
        await factory.WithDbAsync(async db => await db.Set<Role>().Where(r => r.Name == "Data Scientist").ExecuteUpdateAsync(s => s.SetProperty(r => r.Name, "Renamed By Admin")));

        await using var restarted = new DatabaseApiFactory(cs);
        using (restarted.CreateClient())
        {
        }

        (await restarted.CountAsync<Role>()).ShouldBe(6);
        (await restarted.WithDbAsync(db => db.Set<Role>().AnyAsync(r => r.Name == "Data Scientist"))).ShouldBeFalse();
    }
}
