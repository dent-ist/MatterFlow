using MatterFlow.SharedKernel.Visibility;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// The part of every viewer-dependent cache key that stands for "what this person may see right now" (epic #788, README section 10): <c>off</c> while the go-live
/// switch is off, <c>all</c> for a see-all viewer, otherwise a short hash of the sensitive matters that exist, the ones the person manages and the sensitive-matter
/// tasks assigned to them. A change of any of those (a manager removed, a task reassigned, a matter marked or un-marked, the permission taken away) changes the key at
/// once, so a cached dashboard never outlives the access it was computed for; two people never share a key unless they see the same things.
/// The port computes it in the statement that also prepares the request (issue #810), so a cached answer costs one indexed round trip.
/// </summary>
public sealed class VisibilityStamp(IMatterVisibility visibility)
{
    public Task<string> KeyAsync(CancellationToken ct) => visibility.AccessStampAsync(ct);
}
