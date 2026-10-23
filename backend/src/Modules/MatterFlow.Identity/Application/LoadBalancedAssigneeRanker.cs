using System.Globalization;
using MatterFlow.Identity.Contracts;

namespace MatterFlow.Identity.Application;

/// <summary>
/// The default assignee ranking (owner decision, #757): fewest open Tasks first, then the person who was assigned a Task least recently
/// (never assigned comes before anybody), then display name. Out of office people keep their place in the order but are not
/// <see cref="RankedAssignee.Suggestable"/>. Pod and Task Type are accepted and ignored: this rule treats every Pod and type alike.
/// </summary>
public sealed class LoadBalancedAssigneeRanker : IAssigneeRanker
{
    public IReadOnlyList<RankedAssignee> Rank(AssigneeRankingRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return request.Candidates
            .OrderBy(c => c.OpenTaskCount)
            .ThenBy(c => c.LastAssignedUtc ?? DateTime.MinValue)
            .ThenBy(c => c.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(c => c.UserId)
            .Select(c => new RankedAssignee(c, c.IsAvailable, Reason(c, request.NowUtc)))
            .ToList();
    }

    private static string Reason(AssigneeCandidate c, DateTime nowUtc)
    {
        var open = c.OpenTaskCount == 1 ? "1 open task" : string.Create(CultureInfo.InvariantCulture, $"{c.OpenTaskCount} open tasks");
        var last = c.LastAssignedUtc is { } at ? $"last assigned {Ago(nowUtc - at)}" : "never assigned";
        return c.IsAvailable ? $"{open}, {last}" : $"{open}, {last}, out of office";
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
