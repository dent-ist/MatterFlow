using MatterFlow.Configuration.Application.Forms;
using MatterFlow.Configuration.Contracts.Forms;
using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Configuration;

/// <summary>Composition entry point of the Configuration module.</summary>
public static class ConfigurationModule
{
    /// <summary>Registers the Configuration module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddConfigurationModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(ConfigurationModule).Assembly);

        // Forms (architecture 7). Compiled schemas of immutable versions are cached for the life of the process.
        services.AddSingleton<FormSchemaCache>();
        services.AddScoped<FormSchemaLoader>();
        services.AddScoped<FormDefinitionResolver>();
        services.AddScoped<IFormDefinitionResolver>(sp => sp.GetRequiredService<FormDefinitionResolver>());
        services.AddScoped<IFormSubmissionValidator, FormSubmissionValidator>();
        services.AddScoped<IFormValueStore, FormValueStore>();
        services.AddScoped<FormAdminService>();
        return services;
    }
}
