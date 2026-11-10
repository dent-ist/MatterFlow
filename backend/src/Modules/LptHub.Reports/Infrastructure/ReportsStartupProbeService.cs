using MatterFlow.Reports.Application;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// Probes the report login when the host starts and keeps trying for a few minutes while it is not ready, so a demo whose login is
/// provisioned a moment after the API started (the role comes from the schema script) turns green by itself. A missing configuration
/// is final: nothing to retry. The admin page has a "Check again" button for everything else.
/// </summary>
internal sealed class ReportsStartupProbeService(IReportsAvailability availability, ILogger<ReportsStartupProbeService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);
    private const int MaxAttempts = 20;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        for (var attempt = 1; attempt <= MaxAttempts && !stoppingToken.IsCancellationRequested; attempt++)
        {
            try
            {
                var status = await availability.CheckAsync(stoppingToken);
                if (status.Enabled || status.State is ReportsStates.NotConfigured or ReportsStates.SharedWithApplication or ReportsStates.TooPrivileged)
                    return;
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "The Reports startup probe failed unexpectedly.");
                try { await Task.Delay(Interval, stoppingToken); } catch (OperationCanceledException) { return; }
            }
        }
    }
}
