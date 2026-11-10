using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// Keeps the run log for two years (owner decision): once a day it calls <c>dbo.usp_ReportRunPurge</c>, which deletes runs older than that in batches.
/// The table refuses any other delete (trigger and permissions), so this is the only way rows leave it.
/// </summary>
internal sealed class ReportRunRetentionService(ReportAppConnection app, ILogger<ReportRunRetentionService> logger) : BackgroundService
{
    private static readonly TimeSpan FirstDelay = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);
    private const int Batch = 5000;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(FirstDelay, stoppingToken);
            using var timer = new PeriodicTimer(Interval);
            do
            {
                try
                {
                    var total = await PurgeAsync(stoppingToken);
                    if (total > 0)
                        logger.LogInformation("Report run log: {Count} runs older than two years were deleted.", total);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex, "The report run log purge failed; it is tried again tomorrow.");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // shutting down
        }
    }

    internal async Task<int> PurgeAsync(CancellationToken cancellationToken)
    {
        var total = 0;
        while (true)
        {
            await using var connection = await app.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandType = CommandType.StoredProcedure;
            command.CommandText = "dbo.usp_ReportRunPurge";
            command.Parameters.Add(new SqlParameter("@MaxRows", SqlDbType.Int) { Value = Batch });
            var purged = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken), System.Globalization.CultureInfo.InvariantCulture);
            total += purged;
            if (purged < Batch)
                return total;
        }
    }
}
