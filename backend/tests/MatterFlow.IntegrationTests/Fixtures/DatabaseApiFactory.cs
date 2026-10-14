using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>
/// The real API against a real SQL Server database (migrations and the Identity seed run at startup) using the Dev auth provider.
/// Test users are chosen with the <c>X-Dev-User</c> header. A test-only controller supplies permission-protected endpoints until the
/// feature controllers exist.
/// </summary>
public sealed class DatabaseApiFactory(string connectionString, string? environment = null, bool seedStarterConfiguration = false) : WebApplicationFactory<Program>
{
    public const string AdminAccount = @"ke\kekim";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        if (environment is not null)
            builder.UseEnvironment(environment);

        builder.UseSetting("ConnectionStrings:MatterFlow", connectionString);
        builder.UseSetting("ConnectionStrings:Default", connectionString);
        builder.UseSetting("Migrations:Enabled", "true");
        builder.UseSetting("Auth:Provider", "Dev");
        // The factory runs in Development, where the SME starter configuration would otherwise be seeded into every test database.
        builder.UseSetting("Seed:StarterConfiguration:Enabled", seedStarterConfiguration ? "true" : "false");
        builder.UseSetting("Bootstrap:SystemAdmins:0", AdminAccount);
        builder.UseSetting("Dev:Users:0:Username", @"KE\director");
        builder.UseSetting("Dev:Users:0:DisplayName", "Dana Director");
        builder.UseSetting("Dev:Users:0:Roles:0", "Director");
        builder.UseSetting("Dev:Users:1:Username", @"KE\scientist");
        builder.UseSetting("Dev:Users:1:Roles:0", "Data Scientist");
        builder.ConfigureServices(services => services
            .AddControllers()
            .AddApplicationPart(typeof(DatabaseApiFactory).Assembly));
    }

    /// <summary>
    /// Disposes the host and then drops the test database in the background, so a long run does not fill the container's disk with hundreds of
    /// databases (dropping takes seconds on a slow disk, which a test should not wait for).
    /// </summary>
    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        _ = DropDatabaseAsync(connectionString);
    }

    private static async Task DropDatabaseAsync(string connectionString)
    {
        try
        {
            var builder = new SqlConnectionStringBuilder(connectionString);
            var database = builder.InitialCatalog;
            builder.InitialCatalog = "master";
            builder.Pooling = false;
            await using var connection = new SqlConnection(builder.ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{database}];";
            await command.ExecuteNonQueryAsync();
        }
        catch (Exception)
        {
            // Best effort: the container is thrown away at the end of the run anyway.
        }
    }

    public async Task<T> WithDbAsync<T>(Func<DbContext, Task<T>> action)
    {
        await using var scope = Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<DbContext>());
    }

    public Task WithDbAsync(Func<DbContext, Task> action) => WithDbAsync(async db =>
    {
        await action(db);
        return 0;
    });

    public void InvalidateAll() => Services.GetRequiredService<IUserAccessInvalidator>().InvalidateAll();

    public Task<int> CountAsync<T>() where T : class => WithDbAsync(db => db.Set<T>().CountAsync());

    /// <summary>Creates a role holding exactly the given permission codes.</summary>
    public async Task<int> CreateRoleAsync(string name, params string[] permissionCodes)
    {
        var id = await WithDbAsync(async db =>
        {
            var permissions = await db.Set<Permission>().Where(p => permissionCodes.Contains(p.Code)).ToListAsync();
            var role = new Role { Name = name, IsActive = true };
            foreach (var p in permissions)
                role.Permissions.Add(new RolePermission { PermissionId = p.Id });
            db.Set<Role>().Add(role);
            await db.SaveChangesAsync();
            return role.Id;
        });
        InvalidateAll();
        return id;
    }

    public async Task GrantRoleAsync(string username, int roleId)
    {
        await WithDbAsync(async db =>
        {
            var userId = await db.Set<UserIdentity>().Where(i => i.Username == username).Select(i => i.UserId).SingleAsync();
            db.Set<UserRole>().Add(new UserRole { UserId = userId, RoleId = roleId, GrantedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });
        InvalidateAll();
    }
}
