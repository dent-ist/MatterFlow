using LptHub.SharedKernel.Availability;

namespace LptHub.Identity.Contracts;

/// <summary>Compact availability shown next to a user (lists, pickers, cards).</summary>
/// <param name="State"><c>AVAILABLE</c>, <c>OUT_OF_OFFICE</c> or <c>OFF_HOURS</c> (a soft state, never "unavailable").</param>
/// <param name="OutUntil">While out of office: when it ends (UTC); null when open-ended or not out of office.</param>
/// <param name="Note">The out-of-office note; null otherwise.</param>
public sealed record UserAvailabilitySummary(string State, DateTime? OutUntil, string? Note)
{
    public static UserAvailabilitySummary From(AvailabilityEvaluation evaluation) =>
        new(evaluation.State, evaluation.OutUntilUtc, null); // the note is personal (decision AT item 2): never in lists, lookups, pickers or boards
}

/// <summary>
/// An out-of-office window of one person: whole calendar days in the person's own zone. Entries that touch (one starts the day after the other ends) are one window.
/// <c>From</c> null means "since the beginning", <c>Until</c> null means open-ended. The note and the type of the entry are deliberately not part of it.
/// </summary>
public sealed record AwayWindow(DateOnly? From, DateOnly? Until);

/// <summary>Evaluates availability of many users at once for other modules (swimlane cards, team workload).</summary>
public interface IUserAvailabilityReader
{
    /// <summary>
    /// Availability of each given user at <paramref name="nowUtc"/>, keyed by id. A user who never saved a profile is available during the
    /// default hours in the firm zone. A fixed number of queries regardless of the number of users (profiles, hours, entries, holidays).
    /// </summary>
    Task<IReadOnlyDictionary<int, AvailabilityEvaluation>> EvaluateAsync(IReadOnlyCollection<int> userIds, DateTime nowUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// The first out-of-office window of each given user that overlaps the calendar days <paramref name="from"/> to <paramref name="to"/> (both included); users who are not away in that
    /// range are absent. One query regardless of the number of users. Used by the workload view ("who is away in the next four weeks").
    /// </summary>
    Task<IReadOnlyDictionary<int, AwayWindow>> AwayWindowsAsync(IReadOnlyCollection<int> userIds, DateOnly from, DateOnly to, CancellationToken cancellationToken = default);

    /// <summary>
    /// The availability profile of each given user for the calendar days <paramref name="from"/> to <paramref name="to"/>: zone, work hours, the Out of office entries that overlap the range
    /// and the holiday dates of the person's calendar plus every "applies to everyone" calendar. A fixed number of queries regardless of the number of users (Dashboard Calendar).
    /// Evaluate a day with <see cref="UserAvailabilityEvaluator.EvaluateDay"/>.
    /// </summary>
    Task<IReadOnlyDictionary<int, UserAvailabilityProfile>> LoadProfilesAsync(IReadOnlyCollection<int> userIds, DateOnly from, DateOnly to, CancellationToken cancellationToken = default);
}
