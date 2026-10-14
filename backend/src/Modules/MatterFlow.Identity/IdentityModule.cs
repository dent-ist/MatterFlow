using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Identity;

/// <summary>Composition entry point of the Identity module.</summary>
public static class IdentityModule
{
    /// <summary>Registers the Identity module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddIdentityModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(IdentityModule).Assembly);
        return services;
    }
}
