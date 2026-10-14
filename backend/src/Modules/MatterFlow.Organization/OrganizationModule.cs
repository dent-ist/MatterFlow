using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Organization;

/// <summary>Composition entry point of the Organization module.</summary>
public static class OrganizationModule
{
    /// <summary>Registers the Organization module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddOrganizationModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(OrganizationModule).Assembly);
        return services;
    }
}
