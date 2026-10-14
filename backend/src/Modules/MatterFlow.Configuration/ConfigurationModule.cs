using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.Configuration.Contracts;
using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Configuration;

/// <summary>Composition entry point of the Configuration module.</summary>
public static class ConfigurationModule
{
    /// <summary>
    /// Registers the Configuration module's services (priority, status label and asset link role catalogs, the startup seed) and
    /// exposes its controllers via an application part.
    /// </summary>
    public static IServiceCollection AddConfigurationModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(ConfigurationModule).Assembly);

        services.AddScoped<PriorityService>();
        services.AddScoped<IPriorityCatalog>(sp => sp.GetRequiredService<PriorityService>());
        services.AddScoped<StatusLabelService>();
        services.AddScoped<IStatusLabelCatalog>(sp => sp.GetRequiredService<StatusLabelService>());
        services.AddScoped<AssetLinkRoleService>();
        services.AddScoped<IAssetLinkRoleCatalog>(sp => sp.GetRequiredService<AssetLinkRoleService>());
        services.AddScoped<ConfigurationSeeder>();
        return services;
    }
}
