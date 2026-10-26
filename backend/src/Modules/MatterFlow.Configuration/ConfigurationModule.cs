using MatterFlow.Configuration.Application;
using MatterFlow.Configuration.Application.Forms;
using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.Configuration.Application.TaskTypes;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.SharedKernel.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

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
        services.AddScoped<OnHoldReasonService>();
        services.AddScoped<IOnHoldReasonCatalog>(sp => sp.GetRequiredService<OnHoldReasonService>());
        services.AddScoped<StatusLabelService>();
        services.AddScoped<IStatusLabelCatalog>(sp => sp.GetRequiredService<StatusLabelService>());
        services.AddScoped<AssetLinkRoleService>();
        services.AddScoped<IAssetLinkRoleCatalog>(sp => sp.GetRequiredService<AssetLinkRoleService>());
        services.AddScoped<IConfigurationNameDirectory, ConfigurationNameDirectory>();
        services.TryAddScoped<IConfigurationTaskCounts, NoTasksConfigurationTaskCounts>();
        services.AddScoped<TaskTypeService>();
        services.AddScoped<ITaskTypeCatalog>(sp => sp.GetRequiredService<TaskTypeService>());
        services.AddScoped<ConfigurationSeeder>();
        // Forms (architecture 7). Compiled schemas of immutable versions are cached for the life of the process.
        services.AddSingleton<FormSchemaCache>();
        services.AddScoped<FormSchemaLoader>();
        services.AddScoped<FormDefinitionResolver>();
        services.AddScoped<IFormDefinitionResolver>(sp => sp.GetRequiredService<FormDefinitionResolver>());
        services.AddScoped<IFormSubmissionValidator, FormSubmissionValidator>();
        services.AddScoped<IFormReferenceValidator, UserReferenceValidator>();
        services.AddScoped<IFormValueStore, FormValueStore>();
        services.AddScoped<FormAdminService>();
        return services;
    }
}
