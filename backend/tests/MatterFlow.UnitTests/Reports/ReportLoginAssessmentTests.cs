using MatterFlow.Reports.Application;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>Every reason the startup probe has to keep reports off, and the one way to get a green state.</summary>
public class ReportLoginAssessmentTests
{
    private static readonly DateTime Now = new(2026, 10, 22, 12, 0, 0, DateTimeKind.Utc);

    private static ReportLoginFacts Good() => new("mf_reports", false, false, 0, true, 0, 0, 0, false, false, 34, 160);

    [Fact]
    public void A_clean_reader_is_ready_and_the_message_names_what_was_verified()
    {
        var s = ReportLoginAssessment.Evaluate(Good(), Now);

        s.Enabled.ShouldBeTrue();
        s.State.ShouldBe(ReportsStates.Ready);
        s.Message.ShouldContain("writes denied");
        s.Message.ShouldContain("audit tables denied");
        s.Message.ShouldContain("34 tables");
        s.Details!.WritesDenied.ShouldBeTrue();
        s.Details.AuditTablesDenied.ShouldBeTrue();
        s.Details.CheckedAtUtc.ShouldBe(Now);
    }

    public static TheoryData<string, Func<ReportLoginFacts, ReportLoginFacts>> Violations() => new()
    {
        { "sysadmin", f => f with { IsSysAdmin = true } },
        { "db_owner", f => f with { IsDbOwner = true } },
        { "broad role", f => f with { BroadRoleCount = 1 } },
        { "writable tables", f => f with { WritableTables = 2 } },
        { "execute", f => f with { CanExecute = true } },
        { "create", f => f with { CanCreate = true } },
        { "denied tables readable", f => f with { DeniedReadable = 1 } },
        { "tables outside the allow list", f => f with { ReadableOutsideAllowList = 3 } },
    };

    [Theory]
    [MemberData(nameof(Violations))]
    public void Any_excess_right_keeps_reports_off(string _, Func<ReportLoginFacts, ReportLoginFacts> change)
    {
        var s = ReportLoginAssessment.Evaluate(change(Good()), Now);

        s.Enabled.ShouldBeFalse();
        s.State.ShouldBe(ReportsStates.TooPrivileged);
        s.Message.ShouldContain("mf_reports");
    }

    [Fact]
    public void Excess_rights_win_over_a_missing_role()
    {
        ReportLoginAssessment.Evaluate(Good() with { IsDbOwner = true, InReaderRole = false }, Now).State.ShouldBe(ReportsStates.TooPrivileged);
    }

    [Fact]
    public void Not_being_in_the_report_role_is_its_own_state()
    {
        var s = ReportLoginAssessment.Evaluate(Good() with { InReaderRole = false }, Now);

        s.Enabled.ShouldBeFalse();
        s.State.ShouldBe(ReportsStates.RoleMissing);
    }

    [Theory]
    [InlineData(120)]
    [InlineData(100)]
    [InlineData(0)]
    public void A_low_compatibility_level_keeps_reports_off(int level)
    {
        var s = ReportLoginAssessment.Evaluate(Good() with { CompatibilityLevel = level }, Now);

        s.Enabled.ShouldBeFalse();
        s.State.ShouldBe(ReportsStates.CompatibilityTooLow);
    }

    [Fact]
    public void The_catalogue_embedded_in_the_module_is_the_database_catalogue()
    {
        var c = ReportAccessCatalogue.Current;

        c.Allowed.ShouldContain("Task");
        c.Denied.ShouldContain("AuditEvent");
        c.Denied.ShouldContain("UserIdentity");
        c.Denied.ShouldContain("ReportRun");
        c.Allowed.Intersect(c.Denied).ShouldBeEmpty();
    }
}
