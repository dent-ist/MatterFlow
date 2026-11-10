using LptHub.Productions.Application;
using Microsoft.Extensions.DependencyInjection;

namespace LptHub.Productions;

/// <summary>Composition entry point of the Productions module (productions, their comments and production specs of a matter).</summary>
public static class ProductionsModule
{
    /// <summary>Registers the Productions module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddProductionsModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(ProductionsModule).Assembly);

        services.AddScoped<ProductionAccess>();
        services.AddScoped<ProductionSpecService>();
        services.AddScoped<ProductionService>();
        services.AddScoped<LptHub.Productions.Contracts.IProductionLabels, ProductionLabels>();
        return services;
    }
}
