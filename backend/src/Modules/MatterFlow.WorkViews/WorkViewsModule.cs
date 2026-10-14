using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.WorkViews;

/// <summary>Composition entry point of the WorkViews module.</summary>
public static class WorkViewsModule
{
    /// <summary>Registers the WorkViews module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddWorkViewsModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(WorkViewsModule).Assembly);
        return services;
    }
}
