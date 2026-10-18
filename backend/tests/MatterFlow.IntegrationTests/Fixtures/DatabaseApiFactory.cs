using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>
/// The real API against a real SQL Server database (migrations and the Identity seed run at startup) using the Dev auth provider.
/// Test users are chosen with the <c>X-Dev-User</c> header. A test-only controller supplies permission-protected endpoints until the
/// feature controllers exist.
/// </summary>
public sealed class DatabaseApiFactory(string connectionString, string? environment = null, bool seedStarterConfiguration = false, int dashboardCacheSeconds = 0, int? readTimeoutSeconds = null)
    : WebApplicationFactory<Program>
{
    public const string AdminAccount = @"ke\kekim";

    /// <summary>A clock the host uses instead of the system clock, for tests whose result depends on the time of day or the zone.</summary>
    public MatterFlow.SharedKernel.Time.IClock? Clock { get; init; }

    /// <summary>Extra options for the shared database context (for example a command-counting interceptor in a query-count test).</summary>
    public Action<DbContextOptionsBuilder>? ConfigureDb { get; init; }

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
        // The per-user API budgets (SEC2-03) are sized for people; tests drive many calls as one user, so they are lifted here and
        // lowered again by the tests that exercise the limiter.
        foreach (var budget in new[] { "ApiPerMinute", "CommentWritesPerMinute", "TaskWritesPerMinute", "SearchPerMinute", "AdvancedSearchPerMinute", "AuditPerMinute", "DashboardPerMinute" })
            builder.UseSetting("RateLimits:" + budget, "1000000");
        // The 15-second dashboard cache would show tests a stale dashboard right after they changed data; tests that exercise the cache switch it on.
        builder.UseSetting("Dashboard:CacheSeconds", dashboardCacheSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture));
        if (readTimeoutSeconds is { } timeout)
            builder.UseSetting("Queries:ReadCommandTimeoutSeconds", timeout.ToString(System.Globalization.CultureInfo.InvariantCulture));
        builder.UseSetting("Dev:Users:0:Username", @"KE\director");
        builder.UseSetting("Dev:Users:0:DisplayName", "Dana Director");
        builder.UseSetting("Dev:Users:0:Roles:0", "Director");
        builder.UseSetting("Dev:Users:1:Username", @"KE\scientist");
        builder.UseSetting("Dev:Users:1:Roles:0", "Data Scientist");
        // appsettings.Development.json lists extra Dev:Users (user1..user10); configuration merges arrays by index, so the entries
        // above would inherit their display names and emails and the rest would still be seeded. Blank everything the tests do not own.
        builder.UseSetting("Dev:Users:0:Email", "");
        builder.UseSetting("Dev:Users:1:DisplayName", "");
        builder.UseSetting("Dev:Users:1:Email", "");
        for (var i = 2; i < 10; i++)
            builder.UseSetting($"Dev:Users:{i}:Username", "");
        builder.ConfigureServices(services =>
        {
            services.AddControllers().AddApplicationPart(typeof(DatabaseApiFactory).Assembly);
            if (ConfigureDb is { } configureDb)
                services.ConfigureDbContext<MatterFlow.Data.MatterFlowDbContext>(configureDb);
            if (Clock is { } clock)
            {
                services.RemoveAll<MatterFlow.SharedKernel.Time.IClock>();
                services.AddSingleton(clock);
            }
        });
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
