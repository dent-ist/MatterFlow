namespace MatterFlow.Reports.Application;

/// <summary>A report in the person's Recent line.</summary>
/// <param name="LastRunAtUtc">When the person last ran this report successfully (UTC).</param>
public sealed record RecentReportRow(int ReportId, string Name, string CategoryName, DateTime LastRunAtUtc);

public enum FavouriteWrite
{
    /// <summary>The report is now a favourite (it also was one before: adding twice is the same as once).</summary>
    Ok,

    /// <summary>The person already keeps the most favourites and this report is not one of them.</summary>
    LimitReached,
}

/// <summary>
/// Storage of the personal favourite mark and the Recent line (<c>dbo.ReportFavourite</c> and <c>dbo.ReportRun</c>, application connection). Every call is
/// bound to one person. Whether the person may run the report is decided by the caller (<see cref="IReportCatalog"/>); the reads here repeat the rule so a
/// report that stopped being runnable is never returned.
/// </summary>
public interface IReportPersonalStore
{
    /// <summary>Marks the report (idempotent). At <paramref name="maxFavourites"/> favourites of reports the person may still run, a new mark is refused.</summary>
    Task<FavouriteWrite> AddFavouriteAsync(int reportId, int userId, int maxFavourites, CancellationToken cancellationToken);

    /// <summary>Removes the mark (idempotent; no mark is fine).</summary>
    Task RemoveFavouriteAsync(int reportId, int userId, CancellationToken cancellationToken);

    /// <summary>The person's most recent distinct reports by successful run, newest first, only reports the person may run now.</summary>
    Task<IReadOnlyList<RecentReportRow>> ListRecentAsync(int userId, int top, CancellationToken cancellationToken);
}
