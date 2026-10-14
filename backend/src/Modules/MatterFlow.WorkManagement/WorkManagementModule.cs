using MatterFlow.Assets.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.WorkManagement.Application;
using MatterFlow.WorkManagement.Contracts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MatterFlow.WorkManagement;

/// <summary>Composition entry point of the WorkManagement module.</summary>
public static class WorkManagementModule
{
    /// <summary>
    /// Registers the WorkManagement module's services and exposes its controllers via an application part. Registers the real
    /// <see cref="IMatterTaskGuard"/> (after the Organization module's <c>TryAdd</c> default, so it wins) and the Priority usage check.
    /// </summary>
    public static IServiceCollection AddWorkManagementModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(WorkManagementModule).Assembly);

        services.AddScoped<TaskTransactions>();
        services.AddScoped<TaskPresenter>();
        services.AddScoped<TaskService>();
        services.AddScoped<TaskLifecycleService>();
        services.AddScoped<TaskWorkflowService>();
        services.AddScoped<TaskCommentService>();
        services.AddScoped<TaskAssetService>();
        services.AddScoped<TaskActivityService>();
        services.AddScoped<ITaskDirectory, TaskDirectory>();
        services.AddScoped<IAssetTaskLinkReader, TaskAssetLinkReader>();
        services.AddScoped<IAssetLinkRoleUsage, TaskAssetLinkRoleUsage>();

        // Replace (not TryAdd): the Organization default says no Matter ever has open Tasks.
        services.RemoveAll<IMatterTaskGuard>();
        services.AddScoped<IMatterTaskGuard, MatterTaskGuard>();
        services.AddScoped<IPriorityUsage, TaskPriorityUsage>();
        return services;
    }
}
