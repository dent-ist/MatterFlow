using MatterFlow.Audit;
using MatterFlow.Audit.Contracts;
using MatterFlow.Data;
using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.IntegrationTests.Audit;

/// <summary>Test-only audited entity (no business tables are added to the product schema).</summary>
[Audited(ObjectType = "SampleDocument")]
public sealed class SampleDocument : AuditedEntity<int>, IAuditScoped
{
    public string Title { get; set; } = string.Empty;

    [AuditJsonFields("form")]
    public string? ValuesJson { get; set; }

    /// <summary>Changes are written as explicit semantic events, so the interceptor must skip it.</summary>
    [AuditExplicit]
    public string Status { get; set; } = "NEW";

    public int? MatterId { get; set; }

    int? IAuditScoped.AuditMatterId => MatterId;

    long? IAuditScoped.AuditTaskId => null;
}

/// <summary>The product DbContext plus the throw-away <see cref="SampleDocument"/> table (created by the test, not by a script).</summary>
public sealed class AuditTestDbContext(DbContextOptions<AuditTestDbContext> options) : MatterFlowDbContext(options)
{
    public const string CreateTableSql = """
        CREATE TABLE dbo.SampleDocument (
            SampleDocumentId INT IDENTITY PRIMARY KEY,
            Title VARCHAR(10) NOT NULL,
            ValuesJson NVARCHAR(MAX) NULL,
            Status VARCHAR(20) NOT NULL,
            MatterId INT NULL,
            CreatedAt DATETIME2 NOT NULL,
            CreatedByUserId INT NULL,
            ModifiedAt DATETIME2 NULL,
            ModifiedByUserId INT NULL,
            RowVersion ROWVERSION NOT NULL);
        """;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SampleDocument>().ToTable("SampleDocument");
        base.OnModelCreating(modelBuilder);
    }
}

public sealed class FixedUser(int? userId) : ICurrentUser
{
    public int? UserId { get; } = userId;

    public bool IsAuthenticated => UserId is not null;
}

public sealed class FixedClock(DateTime now) : IClock
{
    public DateTime UtcNow { get; } = now;
}

/// <summary>Builds a DI container wired like the host (data module + interceptors) against a real database.</summary>
public sealed class AuditTestHost : IAsyncDisposable
{
    public static readonly DateTime Now = new(2026, 10, 14, 12, 0, 0, DateTimeKind.Utc);

    private readonly ServiceProvider _provider;

    private AuditTestHost(ServiceProvider provider, string connectionString)
    {
        _provider = provider;
        ConnectionString = connectionString;
    }

    public string ConnectionString { get; }

    public static async Task<AuditTestHost> CreateAsync(string connectionString, int? userId = 42)
    {
        await Fixtures.SqlServerFixture.ExecuteAsync(connectionString, AuditTestDbContext.CreateTableSql);

        var services = new ServiceCollection();
        services.AddSingleton<IClock>(new FixedClock(Now));
        services.AddScoped<ICurrentUser>(_ => new FixedUser(userId));
        services.AddAuditServices();
        services.AddScoped<AuditColumnsInterceptor>();
        services.AddScoped<AuditSaveChangesInterceptor>();
        services.AddDbContext<AuditTestDbContext>((sp, o) => o
            .UseSqlServer(connectionString)
            .AddInterceptors(sp.GetRequiredService<AuditColumnsInterceptor>(), sp.GetRequiredService<AuditSaveChangesInterceptor>()));
        return new AuditTestHost(services.BuildServiceProvider(), connectionString);
    }

    public AsyncServiceScope NewScope() => _provider.CreateAsyncScope();

    public ValueTask DisposeAsync() => _provider.DisposeAsync();
}
