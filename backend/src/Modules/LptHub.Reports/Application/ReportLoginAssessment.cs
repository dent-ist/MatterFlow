namespace LptHub.Reports.Application;

/// <summary>What the startup probe measured for the report login (only SELECT and permission queries; see <c>ReportLoginProbe</c>).</summary>
public sealed record ReportLoginFacts(
    string LoginName,
    bool IsSysAdmin,
    bool IsDbOwner,
    int BroadRoleCount,
    bool InReaderRole,
    int WritableTables,
    int DeniedReadable,
    int ReadableOutsideAllowList,
    bool CanExecute,
    bool CanCreate,
    int ReadableTables,
    int CompatibilityLevel,
    int CallableServerProcedures = 0);

/// <summary>Turns the facts into a status. Pure, so every refusal reason is unit tested.</summary>
public static class ReportLoginAssessment
{
    public const int MinimumCompatibilityLevel = 130;

    /// <summary>
    /// The extended procedures in <c>master</c> that PUBLIC may execute and that the one-time DENY step leaves alone, because they only format strings or
    /// serve replication (no file system, registry, host or command access). Every other <c>xp_</c> procedure the login can execute is a warning
    /// (issue #1292). The same four names are in <c>tools/db/provision-report-login.sql</c> and docs/runbook.md section 11.
    /// </summary>
    public static readonly IReadOnlyList<string> HarmlessExtendedProcedures = ["xp_sprintf", "xp_sscanf", "xp_qv", "xp_replposteor"];

    public static ReportsStatus Evaluate(ReportLoginFacts f, DateTime nowUtc)
    {
        var details = new ReportLoginDetails(
            f.LoginName,
            WritesDenied: f.WritableTables == 0 && !f.CanExecute && !f.CanCreate,
            AuditTablesDenied: f.DeniedReadable == 0,
            f.ReadableTables,
            f.CompatibilityLevel,
            nowUtc,
            ServerProceduresDenied: f.CallableServerProcedures == 0);

        var problems = new List<string>();
        if (f.IsSysAdmin)
            problems.Add("it is a sysadmin");
        if (f.IsDbOwner)
            problems.Add("it is db_owner of the database");
        if (f.BroadRoleCount > 0)
            problems.Add("it is a member of a broad role (db_datareader, db_datawriter, db_ddladmin, lpt_app or similar)");
        if (f.WritableTables > 0)
            problems.Add($"it can write to {f.WritableTables} table(s)");
        if (f.CanExecute)
            problems.Add("it can execute procedures in dbo");
        if (f.CanCreate)
            problems.Add("it can create objects");
        if (f.DeniedReadable > 0)
            problems.Add($"it can read {f.DeniedReadable} table(s) the access catalogue denies (audit, identities, Reports tables)");
        if (f.ReadableOutsideAllowList > 0)
            problems.Add($"it can read {f.ReadableOutsideAllowList} table(s) that the access catalogue does not allow");
        if (problems.Count > 0)
            return new(false, ReportsStates.TooPrivileged, $"The report login '{f.LoginName}' has too many rights: {string.Join("; ", problems)}. Reports stay off (docs/runbook.md section 11).", details);

        if (!f.InReaderRole)
            return new(false, ReportsStates.RoleMissing, $"The report login '{f.LoginName}' is not a member of the database role lpt_report_reader. Demo: run npm run db:report-login (npm start does it); production: see docs/runbook.md section 11.", details);

        if (f.CompatibilityLevel < MinimumCompatibilityLevel)
            return new(false, ReportsStates.CompatibilityTooLow, $"The database compatibility level is {f.CompatibilityLevel}; reports need {MinimumCompatibilityLevel} or higher (OPENJSON).", details);

        var ready = $"Report login '{f.LoginName}': writes denied, audit tables denied, can read {f.ReadableTables} tables.";

        // A missing DENY in master is a warning, not a stop: no report text can reach these procedures (the validator refuses EXEC and xp_ names), so reports keep
        // running while the DBA closes the gap. The other rights checks above stop reports because they open the data itself.
        if (f.CallableServerProcedures > 0)
            ready += $" Warning: the login can still run {f.CallableServerProcedures} extended procedure(s) in master that reach the server's file system, registry or host facts (xp_dirtree, xp_fileexist and others). An administrator must run the one-time DENY step in master (docs/runbook.md section 11).";

        return new(true, ReportsStates.Ready, ready, details);
    }
}
