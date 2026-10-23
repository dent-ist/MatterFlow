using MatterFlow.Identity.Contracts;
using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Time;
using Microsoft.Extensions.Configuration;

namespace MatterFlow.Reports.Application;

/// <summary>Collects the facts the server supplies as built-in values for the caller: who they are, "today" in the firm time zone, their pods and the zone offset.</summary>
public sealed class BuiltInContextFactory(ICurrentUser user, IPodDirectory pods, IConfiguration configuration, TimeProvider time)
{
    public async Task<BuiltInContext> CreateAsync(int userId, CancellationToken cancellationToken)
    {
        var memberships = await pods.GetUserPodsAsync(userId, includeInactive: false, cancellationToken);
        var primary = await pods.GetPrimaryPodAsync(userId, cancellationToken);
        var now = time.GetUtcNow().UtcDateTime;
        var zone = UserTimeZone.Resolve(null, configuration["Firm:TimeZoneId"]).Zone;
        return new BuiltInContext(
            userId,
            user.DisplayName ?? "",
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(now, zone)),
            now,
            memberships.Select(p => p.Pod.PodId).Order().ToList(),
            primary?.PodId,
            (int)zone.GetUtcOffset(now).TotalMinutes);
    }
}
