using MatterFlow.WorkflowEngine.Application.Steps;
using MatterFlow.WorkflowEngine.Application.Workflows;
using MatterFlow.WorkflowEngine.Contracts;
using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.WorkflowEngine;

/// <summary>Composition entry point of the WorkflowEngine module.</summary>
public static class WorkflowEngineModule
{
    /// <summary>
    /// Registers the WorkflowEngine module's services (step library, workflow definitions and versions, the <see cref="IWorkflowCatalog"/>
    /// read side) and exposes its controllers via an application part.
    /// </summary>
    public static IServiceCollection AddWorkflowEngineModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(WorkflowEngineModule).Assembly);

        services.AddScoped<StepDefinitionService>();
        services.AddScoped<WorkflowAdminService>();
        services.AddScoped<IWorkflowCatalog, WorkflowCatalog>();
        return services;
    }
}
