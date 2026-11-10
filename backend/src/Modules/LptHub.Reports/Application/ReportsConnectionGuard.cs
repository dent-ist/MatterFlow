using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Application;

/// <summary>
/// Decides whether a reports connection string may be used at all (spec 7.10): it must exist, parse, and must not be the application's own login.
/// There is deliberately no fallback to the application connection: without a separate read-only login Reports stays off.
/// </summary>
public static class ReportsConnectionGuard
{
    public sealed record Result(bool Ok, string State, string Message, string? ConnectionString);

    /// <param name="reports">The value of <c>ConnectionStrings:ReportsReadOnly</c>.</param>
    /// <param name="appConnectionStrings">Every connection string the application itself uses (MatterFlow, Default, Migrations).</param>
    public static Result Evaluate(string? reports, IEnumerable<string?> appConnectionStrings)
    {
        if (string.IsNullOrWhiteSpace(reports))
            return new(false, ReportsStates.NotConfigured, "No report login is configured (ConnectionStrings:ReportsReadOnly). Reports stay off until the owner creates the read-only login (docs/runbook.md).", null);

        SqlConnectionStringBuilder builder;
        try
        {
            builder = new SqlConnectionStringBuilder(reports);
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or KeyNotFoundException)
        {
            return new(false, ReportsStates.NotConfigured, "The report connection string (ConnectionStrings:ReportsReadOnly) is not valid.", null);
        }

        if (string.IsNullOrWhiteSpace(builder.DataSource))
            return new(false, ReportsStates.NotConfigured, "The report connection string (ConnectionStrings:ReportsReadOnly) names no server.", null);

        foreach (var app in appConnectionStrings.Where(a => !string.IsNullOrWhiteSpace(a)))
        {
            if (SameLogin(builder, app!))
                return new(false, ReportsStates.SharedWithApplication, "The report connection uses the same login as the application. Reports need their own read-only login and stay off (docs/runbook.md).", null);
        }

        return new(true, ReportsStates.Ready, "", Harden(builder));
    }

    /// <summary>The engine's own settings win over what the connection string asks for: a small pool, a short connect timeout, read-intent, a recognisable application name.</summary>
    internal static string Harden(SqlConnectionStringBuilder source)
    {
        var builder = new SqlConnectionStringBuilder(source.ConnectionString)
        {
            ApplicationName = "MatterFlow.Reports",
            ApplicationIntent = ApplicationIntent.ReadOnly,
            ConnectTimeout = Math.Min(source.ConnectTimeout, 10),
            MaxPoolSize = Math.Min(source.MaxPoolSize, 8),
            Pooling = true,
            // Default 'Auto' keeps a failed login in the pool for up to a minute, so a fixed login (and the admin's "Check again") would still fail.
            PoolBlockingPeriod = PoolBlockingPeriod.NeverBlock,
            MultipleActiveResultSets = false,
        };
        return builder.ConnectionString;
    }

    private static bool SameLogin(SqlConnectionStringBuilder reports, string appConnectionString)
    {
        SqlConnectionStringBuilder app;
        try
        {
            app = new SqlConnectionStringBuilder(appConnectionString);
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or KeyNotFoundException)
        {
            return false;
        }

        if (string.Equals(reports.ConnectionString, app.ConnectionString, StringComparison.OrdinalIgnoreCase))
            return true;

        // Same server and database with the same identity (SQL user name, or both on the Windows identity of the process).
        if (!string.Equals(NormalizeServer(reports.DataSource), NormalizeServer(app.DataSource), StringComparison.OrdinalIgnoreCase)
            || !string.Equals(reports.InitialCatalog, app.InitialCatalog, StringComparison.OrdinalIgnoreCase))
            return false;

        if (reports.IntegratedSecurity && app.IntegratedSecurity)
            return true;
        return !reports.IntegratedSecurity && !app.IntegratedSecurity && string.Equals(reports.UserID, app.UserID, StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeServer(string dataSource)
    {
        var s = dataSource.Trim();
        if (s.StartsWith("tcp:", StringComparison.OrdinalIgnoreCase))
            s = s[4..];
        s = s.Replace(",1433", "", StringComparison.Ordinal);
        return s is "." or "(local)" or "localhost" or "127.0.0.1" ? "localhost" : s;
    }
}
