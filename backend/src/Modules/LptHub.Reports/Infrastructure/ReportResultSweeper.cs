using MatterFlow.Reports.Application.Results;
using Microsoft.Extensions.Hosting;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>Frees the memory of expired results once a minute (results are also dropped when somebody asks for them after they expired).</summary>
internal sealed class ReportResultSweeper(ReportResultStore store) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
                store.Sweep();
        }
        catch (OperationCanceledException)
        {
            // shutting down
        }
    }
}
