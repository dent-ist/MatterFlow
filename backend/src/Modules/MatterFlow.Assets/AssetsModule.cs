using MatterFlow.Assets.Application;
using MatterFlow.Assets.Contracts;
using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Assets;

/// <summary>Composition entry point of the Assets module.</summary>
public static class AssetsModule
{
    /// <summary>Registers the Assets module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddAssetsModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(AssetsModule).Assembly);

        services.AddScoped<AssetTypeService>();
        services.AddScoped<AssetService>();
        services.AddScoped<IAssetDirectory, AssetDirectory>();
        return services;
    }
}
