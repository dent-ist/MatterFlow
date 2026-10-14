using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Audit;

/// <summary>Composition entry point of the Audit module.</summary>
public static class AuditModule
{
    /// <summary>Registers the Audit module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddAuditModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(AuditModule).Assembly);
        return services;
    }
}
