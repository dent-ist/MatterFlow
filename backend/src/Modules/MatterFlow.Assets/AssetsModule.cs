using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Assets;

/// <summary>Composition entry point of the Assets module.</summary>
public static class AssetsModule
{
    /// <summary>Registers the Assets module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddAssetsModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(AssetsModule).Assembly);
        return services;
    }
}
