using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Tasks;
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
        services.AddScoped<DashboardScopeResolver>();
        services.AddScoped<DashboardService>();
        services.AddScoped<DashboardTrendService>();
        services.AddScoped<SwimlaneService>();
        services.AddScoped<WorkloadService>();
        services.AddScoped<CoverageService>();
        services.AddScoped<MyMattersAttentionService>();
        services.AddScoped<MyMattersHealthService>();
        services.AddScoped<MyMattersScopeResolver>();
        services.AddScoped<MyMattersSummaryService>();
        services.RemoveAll<IOrganizationTaskCounts>();
        services.AddScoped<IOrganizationTaskCounts, OrganizationTaskCounts>();
        services.RemoveAll<IConfigurationTaskCounts>();
        services.AddScoped<IConfigurationTaskCounts, ConfigurationTaskCounts>();
        services.RemoveAll<IUserTaskCounts>();
        services.AddScoped<IUserTaskCounts, UserTaskCounts>();
        services.Configure<DashboardOptions>(configuration.GetSection(DashboardOptions.SectionName));
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<DashboardCache>();
        return services;
    }
}
