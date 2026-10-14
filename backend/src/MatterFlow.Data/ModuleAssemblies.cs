using System.Reflection;
using MatterFlow.Assets;
using MatterFlow.Audit;
using MatterFlow.Configuration;
using MatterFlow.Identity;
using MatterFlow.Organization;
using MatterFlow.WorkflowEngine;
using MatterFlow.WorkManagement;

namespace MatterFlow.Data;

/// <summary>The module assemblies scanned for entity type configurations. A module that owns entities is listed here once.</summary>
public static class ModuleAssemblies
{
    public static IReadOnlyList<Assembly> All { get; } =
    [
        typeof(IdentityModule).Assembly,
        typeof(AuditModule).Assembly,
        typeof(ConfigurationModule).Assembly,
        typeof(OrganizationModule).Assembly,
        typeof(AssetsModule).Assembly,
        typeof(WorkflowEngineModule).Assembly,
        typeof(WorkManagementModule).Assembly,
    ];
}
