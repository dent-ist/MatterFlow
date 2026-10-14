using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.Data;

public static class DataModule
{
    /// <summary>Registers data-access services. The DbContext registration is added with the first persistence work.</summary>
    public static IServiceCollection AddDataModule(this IServiceCollection services) => services;
}
