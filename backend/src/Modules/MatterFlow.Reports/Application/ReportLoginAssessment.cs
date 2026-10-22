namespace MatterFlow.Reports.Application;

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
    int CompatibilityLevel);

/// <summary>Turns the facts into a status. Pure, so every refusal reason is unit tested.</summary>
public static class ReportLoginAssessment
{
    public const int MinimumCompatibilityLevel = 130;

    public static ReportsStatus Evaluate(ReportLoginFacts f, DateTime nowUtc)
    {
        var details = new ReportLoginDetails(
            f.LoginName,
            WritesDenied: f.WritableTables == 0 && !f.CanExecute && !f.CanCreate,
            AuditTablesDenied: f.DeniedReadable == 0,
            f.ReadableTables,
            f.CompatibilityLevel,
            nowUtc);

        var problems = new List<string>();
        if (f.IsSysAdmin)
            problems.Add("it is a sysadmin");
        if (f.IsDbOwner)
            problems.Add("it is db_owner of the database");
        if (f.BroadRoleCount > 0)
            problems.Add("it is a member of a broad role (db_datareader, db_datawriter, db_ddladmin, mf_app or similar)");
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
            return new(false, ReportsStates.RoleMissing, $"The report login '{f.LoginName}' is not a member of the database role mf_report_reader. Demo: run npm run db:report-login (npm start does it); production: see docs/runbook.md section 11.", details);

        if (f.CompatibilityLevel < MinimumCompatibilityLevel)
            return new(false, ReportsStates.CompatibilityTooLow, $"The database compatibility level is {f.CompatibilityLevel}; reports need {MinimumCompatibilityLevel} or higher (OPENJSON).", details);

        return new(true, ReportsStates.Ready, $"Report login '{f.LoginName}': writes denied, audit tables denied, can read {f.ReadableTables} tables.", details);
    }
}
