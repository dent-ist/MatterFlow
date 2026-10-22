using MatterFlow.Reports.Application;
using MatterFlow.Reports.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MatterFlow.Reports;

/// <summary>Composition entry point of the Reports module (epic #671; docs/ux/reports-review/README.md).</summary>
public static class ReportsModule
{
    /// <summary>Registers the Reports module's services and exposes its controllers via an application part.</summary>
    public static IServiceCollection AddReportsModule(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddControllers().AddApplicationPart(typeof(ReportsModule).Assembly);
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<IReportsAvailability, ReportsAvailability>();
        services.AddHostedService<ReportsStartupProbeService>();
        return services;
    }
}
