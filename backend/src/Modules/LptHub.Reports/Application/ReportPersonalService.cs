using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using Microsoft.Extensions.Options;

namespace LptHub.Reports.Application;

/// <summary>
/// Personal favourites and the Recent line of the reports list (issue #723, spec section 7). Everything is bound to the caller: nobody reaches another
/// person's marks or runs. A favourite can only be set or removed for a report the caller may run (the same 404 as running it); the mark of a report that
/// stops being runnable stays stored (it returns with a reassignment) but is never shown. No audit event: a favourite is a personal preference.
/// </summary>
public sealed class ReportPersonalService(ICurrentUser user, IReportCatalog catalog, IReportPersonalStore store, IOptions<ReportsOptions> options)
{
    /// <summary>How many reports the Recent line may hold at most (spec 7.2 shows five).</summary>
    public const int MaxRecent = 10;

    public const int DefaultRecent = 5;

    public const string FavouriteLimitCode = "FAVOURITE_LIMIT_REACHED";

    public async Task<ViewResult<bool>> SetFavouriteAsync(int reportId, bool favourite, CancellationToken cancellationToken)
    {
        if (user.UserId is not { } userId)
            return ViewResult<bool>.Fail(new RunProblem(401, ErrorCodes.Unauthenticated, "Sign in to use reports."));
        // The same rule as running the report: unknown, inactive, deactivated category and unassigned all look alike.
        if (await catalog.FindRunnableAsync(reportId, userId, cancellationToken) is null)
            return ViewResult<bool>.Fail(new RunProblem(404, ErrorCodes.NotFound, ReportRunService.NotAvailableMessage));

        if (!favourite)
        {
            await store.RemoveFavouriteAsync(reportId, userId, cancellationToken);
            return ViewResult<bool>.Ok(true);
        }

        var max = options.Value.MaxFavouritesPerUser;
        return await store.AddFavouriteAsync(reportId, userId, max, cancellationToken) == FavouriteWrite.Ok
            ? ViewResult<bool>.Ok(true)
            : ViewResult<bool>.Fail(new RunProblem(409, FavouriteLimitCode, $"You can have up to {max} favourite reports."));
    }

    public async Task<ViewResult<IReadOnlyList<RecentReportRow>>> RecentAsync(int? top, CancellationToken cancellationToken)
    {
        if (user.UserId is not { } userId)
            return ViewResult<IReadOnlyList<RecentReportRow>>.Fail(new RunProblem(401, ErrorCodes.Unauthenticated, "Sign in to use reports."));
        var rows = await store.ListRecentAsync(userId, Clamp(top), cancellationToken);
        return ViewResult<IReadOnlyList<RecentReportRow>>.Ok(rows);
    }

    /// <summary>No value gives five; anything else is held between one and ten.</summary>
    public static int Clamp(int? top) => top is null ? DefaultRecent : Math.Clamp(top.Value, 1, MaxRecent);
}
