using MatterFlow.Audit.Application;
using MatterFlow.Audit.Contracts;
using MatterFlow.Audit.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MatterFlow.Audit;

/// <summary>Composition entry point of the Audit module.</summary>
public static class AuditModule
{
    /// <summary>Registers the Audit module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddAuditModule(this IServiceCollection services)
    {
        services.AddAuditServices();
        services.TryAddScoped<IAuditReader, AuditReader>();
        services.TryAddScoped<IAuditDisplayLookup, NullAuditDisplayLookup>();
        services.TryAddScoped<AuditVisibility>();
        services.TryAddScoped<AuditSearchService>();
        services.AddControllers().AddApplicationPart(typeof(AuditModule).Assembly);
        return services;
    }

    /// <summary>Writer, buffer and correlation services (no MVC). Idempotent; also called by the Data module, which needs them for the interceptor.</summary>
    public static IServiceCollection AddAuditServices(this IServiceCollection services)
    {
        services.TryAddScoped<AuditEntryBuffer>();
        services.TryAddScoped<IAuditWriter>(sp => sp.GetRequiredService<AuditEntryBuffer>());
        services.TryAddScoped<IAuditCorrelation, AuditCorrelation>();
        return services;
    }
}
