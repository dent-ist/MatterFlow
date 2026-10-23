namespace MatterFlow.Reports.Application;

/// <summary>Limits and tunables of the Reports module (configuration section <c>Reports</c>). Defaults are the owner's decisions (spec 6.5).</summary>
public sealed class ReportsOptions
{
    public const string SectionName = "Reports";

    /// <summary>Run time limit when the report sets none.</summary>
    public int DefaultTimeoutSeconds { get; set; } = 60;

    /// <summary>Highest time limit a report may ask for.</summary>
    public int MaxTimeoutSeconds { get; set; } = 300;

    /// <summary>Row cap when the report sets none; the 50,001st row sets the truncated flag.</summary>
    public int DefaultMaxRows { get; set; } = 50_000;

    /// <summary>Highest row cap a report may ask for.</summary>
    public int MaxRowsCeiling { get; set; } = 200_000;

    /// <summary>Reports running at the same time in the whole application (429 <c>REPORT_BUSY</c> above it).</summary>
    public int GlobalConcurrency { get; set; } = 4;

    /// <summary>Runs and previews one person may start per hour (429 <c>REPORT_RATE_LIMITED</c> above it).</summary>
    public int RunsPerUserPerHour { get; set; } = 30;

    public int PreviewRows { get; set; } = 20;

    public int PreviewTimeoutSeconds { get; set; } = 15;

    public int ChoiceQueryTimeoutSeconds { get; set; } = 10;

    public int ChoiceQueryMaxRows { get; set; } = 1000;

    /// <summary>Milliseconds a report waits for a lock before it fails (<c>SET LOCK_TIMEOUT</c>).</summary>
    public int LockTimeoutMilliseconds { get; set; } = 5000;

    /// <summary>A cached result is dropped this long after its last use.</summary>
    public int ResultIdleMinutes { get; set; } = 15;

    /// <summary>A cached result is dropped this long after it was created, however often it is used.</summary>
    public int ResultMaxMinutes { get; set; } = 60;

    /// <summary>Memory budget of all cached results together; the oldest are dropped first.</summary>
    public int ResultMemoryBudgetMegabytes { get; set; } = 512;

    public int EffectiveTimeout(int? reportSetting) => Math.Clamp(reportSetting ?? DefaultTimeoutSeconds, 1, MaxTimeoutSeconds);

    public int EffectiveMaxRows(int? reportSetting) => Math.Clamp(reportSetting ?? DefaultMaxRows, 1, MaxRowsCeiling);
}
