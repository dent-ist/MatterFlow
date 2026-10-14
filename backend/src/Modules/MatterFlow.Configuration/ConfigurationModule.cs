using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Configuration;

/// <summary>Composition entry point of the Configuration module.</summary>
public static class ConfigurationModule
{
    /// <summary>Registers the Configuration module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddConfigurationModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(ConfigurationModule).Assembly);
        return services;
    }
}
