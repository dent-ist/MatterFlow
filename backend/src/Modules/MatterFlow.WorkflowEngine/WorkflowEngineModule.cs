using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.WorkflowEngine;

/// <summary>Composition entry point of the WorkflowEngine module.</summary>
public static class WorkflowEngineModule
{
    /// <summary>Registers the WorkflowEngine module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddWorkflowEngineModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(WorkflowEngineModule).Assembly);
        return services;
    }
}
