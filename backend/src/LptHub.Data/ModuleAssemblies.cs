using System.Reflection;
using LptHub.Assets;
using LptHub.Audit;
using LptHub.Configuration;
using LptHub.Identity;
using LptHub.Notes;
using LptHub.Notifications;
using LptHub.Organization;
using LptHub.Productions;
using LptHub.Vendors;
using LptHub.WorkflowEngine;
using LptHub.WorkManagement;

namespace LptHub.Data;

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
        typeof(NotificationsModule).Assembly,
        typeof(ProductionsModule).Assembly,
        typeof(NotesModule).Assembly,
        typeof(VendorsModule).Assembly,
    ];
}
