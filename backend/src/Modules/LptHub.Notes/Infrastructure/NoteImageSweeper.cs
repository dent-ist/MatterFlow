using LptHub.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LptHub.Notes.Infrastructure;

/// <summary>
/// The crash safety net for note images (design 4.7; ADR 030). Images are deleted at once when nothing uses them (a save, Cancel, a note delete); this job, once a night, deletes the few that a crash
/// or a closed browser left behind: images no note refers to whose upload is more than 48 hours old (a long-open draft is the only thing that can get that old). Batches of 100, only the counts are
/// logged, nothing is audited (no person acted). It is not a retention rule: there is no 7-day wait for anything.
/// </summary>
internal sealed class NoteImageSweeper(IServiceScopeFactory scopes, ILogger<NoteImageSweeper> logger) : BackgroundService
{
    /// <summary>Unreferenced uploads older than this are removed.</summary>
    internal static readonly TimeSpan MaxPendingAge = TimeSpan.FromHours(48);

    /// <summary>Images deleted per statement.</summary>
    internal const int Batch = 100;

    /// <summary>The time of night (UTC) the job runs.</summary>
    private static readonly TimeSpan NightlyAt = new(2, 20, 0);

    internal static TimeSpan DelayUntilNextRun(DateTime utcNow)
    {
        var next = utcNow.Date + NightlyAt;
        return next > utcNow ? next - utcNow : next.AddDays(1) - utcNow;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (true)
            {
                await Task.Delay(DelayUntilNextRun(DateTime.UtcNow), stoppingToken);
                try
                {
                    var total = await SweepAsync(stoppingToken);
                    if (total > 0)
                        logger.LogInformation("Note images: {Count} unreferenced uploads older than 48 hours were deleted.", total);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex, "The note image sweep failed; it is tried again tomorrow night.");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // shutting down
        }
    }

    /// <summary>Deletes the unreferenced images uploaded before the cutoff, in batches; returns how many were deleted.</summary>
    internal async Task<int> SweepAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DbContext>();
        var cutoff = scope.ServiceProvider.GetRequiredService<IClock>().UtcNow - MaxPendingAge;
        var total = 0;
        while (true)
        {
            var deleted = await db.Database.ExecuteSqlAsync(
                $"""
                DELETE TOP ({Batch}) FROM dbo.NoteImage
                WHERE UploadedAt < {cutoff}
                  AND NOT EXISTS (SELECT 1 FROM dbo.NoteLink l WHERE l.TargetType = 'IMAGE' AND l.TargetId = NoteImageId)
                """,
                cancellationToken);
            total += deleted;
            if (deleted < Batch)
                return total;
        }
    }
}
