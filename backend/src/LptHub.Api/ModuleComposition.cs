using LptHub.Api.Http;
using LptHub.Api.Seeding;
using LptHub.Assets;
using LptHub.Audit;
using LptHub.Audit.Contracts;
using LptHub.Configuration;
using LptHub.Configuration.Application.Lookups;
using LptHub.Data;
using LptHub.Identity;
using LptHub.Identity.Seeding;
using LptHub.Intake;
using LptHub.Notes;
using LptHub.Notifications;
using LptHub.Organization;
using LptHub.Productions;
using LptHub.Reports;
using LptHub.Search;
using LptHub.Vendors;
using LptHub.WorkflowEngine;
using LptHub.WorkManagement;
using LptHub.WorkViews;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace LptHub.Api;

/// <summary>
/// The single list of modules composed into the host. Adding a module is one line here;
/// each module owns its own Add&lt;Module&gt;Module registration.
/// </summary>
public static class ModuleComposition
{
    public static IServiceCollection AddLptHubModules(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        services.AddDataModule();
        services.AddIdentityModule(configuration, environment);
        services.AddAuditModule();
        services.Replace(ServiceDescriptor.Scoped<IAuditDisplayLookup, AuditDisplayLookup>()); // user names and object labels from other modules' Contracts
        services.AddConfigurationModule();
        services.AddOrganizationModule();
        services.AddAssetsModule();
        services.AddWorkflowEngineModule();
        services.AddWorkManagementModule();
        services.AddWorkViewsModule(configuration);
        services.AddSearchModule();
        services.AddIntakeModule();
        services.AddNotificationsModule(configuration);
        services.AddReportsModule(configuration);
        services.AddProductionsModule();
        services.AddNotesModule();
        services.AddVendorsModule();
        services.AddStarterConfigurationSeeding();
        return services;
    }

    /// <summary>Runs every module's idempotent startup seed. Call after schema migrations, before the host listens.</summary>
    public static async Task RunModuleSeedsAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        // One instance at a time: a second API instance starting together waits here instead of colliding on the unique indexes.
        await using var seedLock = await SeedLock.AcquireAsync(services.GetRequiredService<IConfiguration>(), cancellationToken);
        await services.SeedIdentityAsync(cancellationToken);
        await services.SeedConfigurationAsync(cancellationToken);
        await services.SeedStarterConfigurationAsync(cancellationToken);
        await services.SeedStarterReportsAsync(cancellationToken);
        await services.ReindexAssetValuesAsync(cancellationToken);
    }
}
