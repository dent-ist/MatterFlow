using MatterFlow.WorkViews.Application.Queries;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MatterFlow.WorkViews;

/// <summary>Composition entry point of the WorkViews module.</summary>
public static class WorkViewsModule
{
    /// <summary>Registers the WorkViews module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddWorkViewsModule(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddControllers().AddApplicationPart(typeof(WorkViewsModule).Assembly);
        services.AddScoped<TaskQueueService>();
        services.AddScoped<DashboardService>();
        services.Configure<DashboardOptions>(configuration.GetSection(DashboardOptions.SectionName));
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<DashboardCache>();
        return services;
    }
}
