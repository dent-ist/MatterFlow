using System.Globalization;
using LptHub.Identity.Contracts;

namespace LptHub.Identity.Application;

/// <summary>
/// The default assignee ranking (DB-14, supersedes the order of #757): least load first (the capacity load: open Tasks that are New or In progress, On Hold not counted), then the
/// fewest Tasks of the Task Type completed in the last 3 months (skipped when the Task has no type), then the person assigned a Task longest ago (never assigned comes before
/// anybody), then display name, then user id. All ordering uses the TRUE values, whatever the viewer may see (sensitive-matter rule, owner decision Q5); the reason sentence shows only
/// what the viewer may see. Availability does not change the order: the lookup leaves out of office people out of a picker, and a person who is out of office and still reaches the
/// ranker keeps their place but is not <see cref="RankedAssignee.Suggestable"/>. Off hours people are ranked like anybody else.
/// </summary>
public sealed class LoadBalancedAssigneeRanker : IAssigneeRanker
{
    /// <summary>The experience window in months.</summary>
    public const int ExperienceMonths = 3;

    public IReadOnlyList<RankedAssignee> Rank(AssigneeRankingRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var withType = request.TaskTypeId is not null;
        return request.Candidates
            .OrderBy(c => c.Load)
            .ThenBy(c => withType ? c.CompletedOfType : 0)
            .ThenBy(c => c.LastAssignedUtc ?? DateTime.MinValue)
            .ThenBy(c => c.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(c => c.UserId)
            .Select(c => new RankedAssignee(c, c.IsAvailable, Reason(c, withType, request.NowUtc)))
            .ToList();
    }

    private static string Reason(AssigneeCandidate c, bool withType, DateTime nowUtc)
    {
        // "1 open task, 2 completed of this type in 3 months, last assigned 3 days ago". Every number is what the viewer may see; "open" is the load (On Hold not counted) the order uses.
        var open = c.ShownLoad == 1 ? "1 open task" : string.Create(CultureInfo.InvariantCulture, $"{c.ShownLoad} open tasks");
        var done = withType ? string.Create(CultureInfo.InvariantCulture, $", {c.ShownCompletedOfType} completed of this type in {ExperienceMonths} months") : string.Empty;
        var last = c.ShownLastAssignedUtc is { } at ? $"last assigned {Ago(nowUtc - at)}" : "never assigned";
        return c.IsAvailable ? $"{open}{done}, {last}" : $"{open}{done}, {last}, out of office";
    }

    private static string Ago(TimeSpan span)
    {
        if (span < TimeSpan.FromHours(1))
            return "just now";
        if (span < TimeSpan.FromDays(1))
            return string.Create(CultureInfo.InvariantCulture, $"{(int)span.TotalHours} h ago");
        var days = (int)span.TotalDays;
        return days == 1 ? "1 day ago" : string.Create(CultureInfo.InvariantCulture, $"{days} days ago");
    }
}
