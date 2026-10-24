using MatterFlow.SharedKernel.Availability;

namespace MatterFlow.Identity.Contracts;

/// <summary>Compact availability shown next to a user (lists, pickers, cards).</summary>
/// <param name="State"><c>AVAILABLE</c>, <c>OUT_OF_OFFICE</c> or <c>OFF_HOURS</c> (a soft state, never "unavailable").</param>
/// <param name="OutUntil">While out of office: when it ends (UTC); null when open-ended or not out of office.</param>
/// <param name="Note">The out-of-office note; null otherwise.</param>
public sealed record UserAvailabilitySummary(string State, DateTime? OutUntil, string? Note)
{
    public static UserAvailabilitySummary From(AvailabilityEvaluation evaluation) =>
        new(evaluation.State, evaluation.OutUntilUtc, evaluation.Note);
}

/// <summary>
/// An out-of-office period of one person, as saved: whole calendar days in the person's own zone. <c>From</c> null means "since the beginning", <c>Until</c> null means open-ended.
/// The free-text note of the profile is deliberately not part of it.
/// </summary>
public sealed record AwayWindow(DateOnly? From, DateOnly? Until);

/// <summary>Evaluates availability of many users at once for other modules (swimlane cards, team workload).</summary>
public interface IUserAvailabilityReader
{
    /// <summary>
    /// Availability of each given user at <paramref name="nowUtc"/>, keyed by id. A user who never saved a profile is available during the
    /// default hours in the firm zone. Two queries regardless of the number of users.
    /// </summary>
    Task<IReadOnlyDictionary<int, AvailabilityEvaluation>> EvaluateAsync(IReadOnlyCollection<int> userIds, DateTime nowUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// The saved out-of-office period of each given user that overlaps the calendar days <paramref name="from"/> to <paramref name="to"/> (both included); users who are not away in that
    /// range are absent. One query regardless of the number of users. Used by the workload view ("who is away in the next four weeks").
    /// </summary>
    Task<IReadOnlyDictionary<int, AwayWindow>> AwayWindowsAsync(IReadOnlyCollection<int> userIds, DateOnly from, DateOnly to, CancellationToken cancellationToken = default);
}
