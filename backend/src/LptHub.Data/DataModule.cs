using LptHub.Audit;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace LptHub.Data;

public static class DataModule
{
    public const string ConnectionStringName = "LptHub";

    /// <summary>
    /// Registers the DbContext (SQL Server, connection string <c>ConnectionStrings:LptHub</c>, resolved lazily so the host
    /// and unit tests start without a database) and the audit-column interceptor. Also registers fallbacks for
    /// <see cref="IClock"/> and <see cref="ICurrentUser"/>; the Identity module's registration (added later) wins.
    /// </summary>
    public static IServiceCollection AddDataModule(this IServiceCollection services)
    {
        services.TryAddSingleton<IClock, SystemClock>();
        services.TryAddScoped<ICurrentUser, SystemCurrentUser>();
        services.AddAuditServices();
        services.AddSingleton<LptHub.Identity.People.PersonUserSyncInterceptor>();
        services.AddScoped<AuditColumnsInterceptor>();
        services.AddScoped<AuditSaveChangesInterceptor>();
        services.AddSingleton<StablePlanInterceptor>();
        // Modules cannot reference Data (dependency rules), so they take the plain DbContext, which resolves to the shared context.
        services.AddScoped<DbContext>(sp => sp.GetRequiredService<LptHubDbContext>());
        services.AddDbContext<LptHubDbContext>((sp, options) =>
        {
            var connectionString = sp.GetRequiredService<IConfiguration>().GetConnectionString(ConnectionStringName)
                ?? throw new InvalidOperationException($"Connection string 'ConnectionStrings:{ConnectionStringName}' is not configured.");
            options.UseSqlServer(connectionString);
            options.AddInterceptors(
                sp.GetRequiredService<LptHub.Identity.People.PersonUserSyncInterceptor>(), // before the audit interceptors: the person it adds is stamped and audited
                sp.GetRequiredService<AuditColumnsInterceptor>(),
                sp.GetRequiredService<AuditSaveChangesInterceptor>(),
                sp.GetRequiredService<StablePlanInterceptor>());
        });
        return services;
    }
}
