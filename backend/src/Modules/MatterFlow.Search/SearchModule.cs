using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Search;

/// <summary>Composition entry point of the Search module.</summary>
public static class SearchModule
{
    /// <summary>Registers the Search module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddSearchModule(this IServiceCollection services)
    {
        services.AddControllers().AddApplicationPart(typeof(SearchModule).Assembly);
        return services;
    }
}
