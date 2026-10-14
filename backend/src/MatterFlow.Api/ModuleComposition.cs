using MatterFlow.Assets;
using MatterFlow.Audit;
using MatterFlow.Configuration;
using MatterFlow.Data;
using MatterFlow.Identity;
using MatterFlow.Identity.Seeding;
using MatterFlow.Intake;
using MatterFlow.Organization;
using MatterFlow.Search;
using MatterFlow.WorkflowEngine;
using MatterFlow.WorkManagement;
using MatterFlow.WorkViews;

namespace MatterFlow.Api;

/// <summary>
/// The single list of modules composed into the host. Adding a module is one line here;
/// each module owns its own Add&lt;Module&gt;Module registration.
/// </summary>
public static class ModuleComposition
{
    public static IServiceCollection AddMatterFlowModules(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        services.AddDataModule();
        services.AddIdentityModule(configuration, environment);
        services.AddAuditModule();
        services.AddConfigurationModule();
        services.AddOrganizationModule();
        services.AddAssetsModule();
        services.AddWorkflowEngineModule();
        services.AddWorkManagementModule();
        services.AddWorkViewsModule();
        services.AddSearchModule();
        services.AddIntakeModule();
        return services;
    }

    /// <summary>Runs every module's idempotent startup seed. Call after schema migrations, before the host listens.</summary>
    public static async Task RunModuleSeedsAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await services.SeedIdentityAsync(cancellationToken);
    }
}
