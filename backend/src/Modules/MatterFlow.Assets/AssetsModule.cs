using MatterFlow.Assets.Application;
using MatterFlow.Assets.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Organization.Contracts;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MatterFlow.Assets;

/// <summary>Composition entry point of the Assets module.</summary>
public static class AssetsModule
{
    /// <summary>Registers the Assets module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddAssetsModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(AssetsModule).Assembly);

        services.AddScoped<AssetAccess>();
        services.AddScoped<AssetTypeService>();
        services.AddScoped<AssetService>();
        services.AddScoped<AssetReportService>();
        services.AddScoped<IAssetDirectory, AssetDirectory>();
        services.RemoveAll<IMatterAssetCounts>();
        services.AddScoped<IMatterAssetCounts, MatterAssetCounts>();
        services.AddScoped<IFormReferenceValidator, AssetReferenceValidator>();
        return services;
    }
}
