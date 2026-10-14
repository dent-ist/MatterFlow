using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.WorkManagement;

/// <summary>Composition entry point of the WorkManagement module.</summary>
public static class WorkManagementModule
{
    /// <summary>Registers the WorkManagement module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddWorkManagementModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(WorkManagementModule).Assembly);
        return services;
    }
}
