namespace MatterFlow.Reports.Application;

/// <summary>Why Reports can or cannot run (spec sections 6.3 layer 4, 7.10 and 8.2). Stable codes; the wording is for administrators.</summary>
public static class ReportsStates
{
    public const string Ready = "Ready";

    /// <summary>No (valid) report connection string.</summary>
    public const string NotConfigured = "NotConfigured";

    /// <summary>The report connection is the application's own login.</summary>
    public const string SharedWithApplication = "SharedWithApplication";

    /// <summary>The probe has not finished yet (startup).</summary>
    public const string Checking = "Checking";

    /// <summary>The report login could not connect (wrong password, login or database user missing, server down).</summary>
    public const string LoginFailed = "LoginFailed";

    /// <summary>The login can connect but is not a member of <c>mf_report_reader</c>.</summary>
    public const string RoleMissing = "RoleMissing";

    /// <summary>The login can write, execute, change the schema or read a denied table.</summary>
    public const string TooPrivileged = "TooPrivileged";

    /// <summary>The database compatibility level is below 130, which <c>OPENJSON</c> needs.</summary>
    public const string CompatibilityTooLow = "CompatibilityTooLow";
}

/// <summary>What the probe found out about the report login (shown on the admin page; never contains the password).</summary>
public sealed record ReportLoginDetails(
    string LoginName,
    bool WritesDenied,
    bool AuditTablesDenied,
    int ReadableTables,
    int CompatibilityLevel,
    DateTime CheckedAtUtc);

/// <summary>The health of the Reports feature as the admin page and every run endpoint see it.</summary>
public sealed record ReportsStatus(bool Enabled, string State, string Message, ReportLoginDetails? Details = null);

/// <summary>Single source of truth for "may reports run right now"; nothing runs a report while <see cref="ReportsStatus.Enabled"/> is false.</summary>
public interface IReportsAvailability
{
    ReportsStatus Current { get; }

    /// <summary>The report connection string, hardened, or null while the guard says no. Only the Reports infrastructure may use it.</summary>
    string? ReportConnectionString { get; }

    /// <summary>Re-reads the configuration and probes the login again (startup, and the admin "check again" button).</summary>
    Task<ReportsStatus> CheckAsync(CancellationToken cancellationToken);
}
