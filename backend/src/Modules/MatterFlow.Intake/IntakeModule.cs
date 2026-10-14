using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Intake;

/// <summary>Composition entry point of the Intake module.</summary>
public static class IntakeModule
{
    /// <summary>Registers the Intake module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddIntakeModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(IntakeModule).Assembly);
        return services;
    }
}
