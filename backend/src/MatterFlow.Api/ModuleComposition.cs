using MatterFlow.Assets;
using MatterFlow.Audit;
using MatterFlow.Configuration;
using MatterFlow.Data;
using MatterFlow.Identity;
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
    public static IServiceCollection AddMatterFlowModules(this IServiceCollection services)
    {
        services.AddDataModule();
        services.AddIdentityModule();
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
}
