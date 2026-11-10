using LptHub.Reports.Application;
using LptHub.Reports.Application.Results;
using LptHub.Reports.Application.Starters;
using LptHub.Reports.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace LptHub.Reports;

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

        services.Configure<ReportsOptions>(configuration.GetSection(ReportsOptions.SectionName));
        services.AddSingleton<ReportRunGate>();
        services.AddSingleton<ReportAppConnection>();
        services.AddSingleton<ReportResultStore>();
        services.AddSingleton<IReportResultSink>(sp => sp.GetRequiredService<ReportResultStore>());
        services.AddHostedService<ReportResultSweeper>();
        services.AddScoped<IReportCatalog, ReportCatalog>();
        services.AddScoped<IReportRunLog, ReportRunLog>();
        services.AddScoped<IReportExecutor, ReportExecutor>();
        services.AddScoped<BuiltInContextFactory>();
        services.AddScoped<IReportDefinitionStore, ReportDefinitionStore>();
        services.AddScoped<IReportRunLogReader, ReportRunLogReader>();
        services.AddHostedService<ReportRunRetentionService>();
        services.AddScoped<ReportRunService>();
        services.AddScoped<ReportBrowseService>();
        services.AddScoped<ReportExportService>();
        services.AddScoped<IReportViewStore, ReportViewStore>();
        services.AddScoped<ReportViewService>();
        services.AddScoped<IReportPersonalStore, ReportPersonalStore>();
        services.AddScoped<ReportPersonalService>();
        services.AddScoped<ReportAuthoringService>();
        services.AddMemoryCache();
        services.AddSingleton<ReportChoiceGate>();
        services.AddScoped<ReportChoiceService>();
        services.AddScoped<IReportLookupStore, ReportLookupStore>();
        services.AddScoped<ReportLookupService>();
        services.AddScoped<IReportAdminStore, ReportAdminStore>();
        services.AddScoped<IReportStarterMarkers, ReportStarterMarkers>();
        services.AddScoped<ReportStarterSeeder>();
        services.AddScoped<ReportAdminService>();
        services.AddSingleton<IReportSchemaReader, ReportSchemaReader>();
        services.AddScoped<ReportSchemaService>();
        return services;
    }
}
