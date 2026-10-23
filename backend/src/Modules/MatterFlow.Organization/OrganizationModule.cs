using MatterFlow.Organization.Application;
using MatterFlow.Organization.Contracts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MatterFlow.Organization;

/// <summary>Composition entry point of the Organization module.</summary>
public static class OrganizationModule
{
    /// <summary>
    /// Registers the Organization module's services and exposes its controllers via an application part. The default
    /// <see cref="IMatterTaskGuard"/> (no Matter has open Tasks) is registered with <c>TryAdd</c>; the Tasks module replaces it.
    /// </summary>
    public static IServiceCollection AddOrganizationModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(OrganizationModule).Assembly);

        services.AddScoped<CustomFieldValues>();
        services.AddScoped<MatterFlow.SharedKernel.Visibility.IMatterAccessSource, MatterAccessSource>();
        services.AddScoped<ClientService>();
        services.AddScoped<MatterService>();
        services.AddScoped<ProjectService>();
        services.AddScoped<IMatterDirectory, MatterDirectory>();
        services.AddScoped<IProjectDirectory, ProjectDirectory>();
        services.AddScoped<MatterFlow.Notifications.Contracts.IObjectVisibility, MatterObjectVisibility>();
        services.TryAddScoped<IMatterTaskGuard, NoTasksMatterTaskGuard>();
        services.TryAddScoped<IOrganizationTaskCounts, NoTasksOrganizationTaskCounts>();
        services.TryAddScoped<IMatterAssetCounts, NoAssetsMatterAssetCounts>();
        return services;
    }
}
