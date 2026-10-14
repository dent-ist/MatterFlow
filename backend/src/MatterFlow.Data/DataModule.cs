using MatterFlow.Audit;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MatterFlow.Data;

public static class DataModule
{
    public const string ConnectionStringName = "MatterFlow";

    /// <summary>
    /// Registers the DbContext (SQL Server, connection string <c>ConnectionStrings:MatterFlow</c>, resolved lazily so the host
    /// and unit tests start without a database) and the audit-column interceptor. Also registers fallbacks for
    /// <see cref="IClock"/> and <see cref="ICurrentUser"/>; the Identity module's registration (added later) wins.
    /// </summary>
    public static IServiceCollection AddDataModule(this IServiceCollection services)
    {
        services.TryAddSingleton<IClock, SystemClock>();
        services.TryAddScoped<ICurrentUser, SystemCurrentUser>();
        services.AddAuditServices();
        services.AddScoped<AuditColumnsInterceptor>();
        services.AddScoped<AuditSaveChangesInterceptor>();
        // Modules cannot reference Data (dependency rules), so they take the plain DbContext, which resolves to the shared context.
        services.AddScoped<DbContext>(sp => sp.GetRequiredService<MatterFlowDbContext>());
        services.AddDbContext<MatterFlowDbContext>((sp, options) =>
        {
            var connectionString = sp.GetRequiredService<IConfiguration>().GetConnectionString(ConnectionStringName)
                ?? throw new InvalidOperationException($"Connection string 'ConnectionStrings:{ConnectionStringName}' is not configured.");
            options.UseSqlServer(connectionString);
            options.AddInterceptors(
                sp.GetRequiredService<AuditColumnsInterceptor>(),
                sp.GetRequiredService<AuditSaveChangesInterceptor>());
        });
        return services;
    }
}
