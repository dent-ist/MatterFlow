namespace MatterFlow.Reports.Application;

/// <summary>Why Reports can or cannot run (spec sections 6.3 layer 4, 7.10 and 8.2). The wording is for administrators.</summary>
public static class ReportsStates
{
    public const string Ready = "Ready";
    public const string NotConfigured = "NotConfigured";
}

/// <summary>The health of the Reports feature as the admin page and every run endpoint see it.</summary>
public sealed record ReportsStatus(bool Enabled, string State, string Message);

/// <summary>Single source of truth for "may reports run right now"; nothing runs a report while <see cref="ReportsStatus.Enabled"/> is false.</summary>
public interface IReportsAvailability
{
    ReportsStatus Current { get; }
}

/// <summary>Skeleton implementation: reports stay off until the read-only login is configured and probed (issue #684 replaces this).</summary>
internal sealed class ReportsAvailability : IReportsAvailability
{
    public ReportsStatus Current { get; } = new(false, ReportsStates.NotConfigured, "Reports are not set up yet: the read-only report login has not been configured.");
}
