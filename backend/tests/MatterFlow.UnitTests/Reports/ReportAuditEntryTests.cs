using System.Text.Json;
using System.Text.RegularExpressions;
using MatterFlow.Reports.Application;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>The audit events of Reports: codes, wording, limits, and that the SQL text is never in them (spec 13; issue #707).</summary>
public class ReportAuditEntryTests
{
    private const string Sql = "SELECT secret_column FROM dbo.SecretTable WHERE x = 1";
    private static readonly byte[] Hash = SqlHashOf(Sql);

    private static byte[] SqlHashOf(string sql) => MatterFlow.Reports.Domain.SqlValidator.Hash(sql);

    private static IEnumerable<ReportAuditEntry> Samples()
    {
        yield return ReportAuditEntry.Created(5, "Overdue tasks");
        yield return ReportAuditEntry.Updated(5, "Overdue tasks", 2, Hash, 3, SqlHashOf("SELECT 2"));
        yield return ReportAuditEntry.ParametersChanged(5, "Overdue tasks", 3, ["A", "B"], ["A", "C"]);
        yield return ReportAuditEntry.ChoiceSqlChanged(5, "Overdue tasks", "PODS", Hash, SqlHashOf("SELECT 2"));
        yield return ReportAuditEntry.Activated(5, "Overdue tasks", 3);
        yield return ReportAuditEntry.Deactivated(5, "Overdue tasks", "version 4 was not previewed");
        yield return ReportAuditEntry.VersionRestored(5, "Overdue tasks", 2, 6);
        yield return ReportAuditEntry.CategoryChanged(5, "Overdue tasks", "Finance", "Task follow-up");
        yield return ReportAuditEntry.RolesAssigned(5, "Overdue tasks", ["Pod Lead"], ["Director"]);
        yield return ReportAuditEntry.RunCompleted(5, "Overdue tasks", 3, "Succeeded", 132, false, 412, null, "[\"MAX=2\"]");
        yield return ReportAuditEntry.Exported(5, "Overdue tasks", 3, 131, "name contains 'a'");
    }

    [Fact]
    public void Every_event_code_has_a_builder_and_is_upper_snake_case_within_the_column()
    {
        var produced = Samples().Select(e => e.EventType).ToList();

        produced.Order().ShouldBe(ReportAuditEvents.All.Order());
        produced.ShouldAllBe(c => Regex.IsMatch(c, "^[A-Z]+(_[A-Z]+)*$") && c.Length <= 64);
        ReportAuditEvents.ObjectType.ShouldBe("Report");
    }

    [Fact]
    public void Summaries_and_values_fit_the_audit_columns_and_say_which_report()
    {
        foreach (var e in Samples())
        {
            e.Summary.Length.ShouldBeInRange(1, 500);
            e.Summary.ShouldContain("Overdue tasks");
            (e.OldValue?.Length ?? 0).ShouldBeLessThanOrEqualTo(4000);
            (e.NewValue?.Length ?? 0).ShouldBeLessThanOrEqualTo(4000);
            (e.FieldKey?.Length ?? 0).ShouldBeLessThanOrEqualTo(100);
            e.ReportId.ShouldBe(5);
        }
    }

    [Fact]
    public void No_event_ever_carries_the_sql_text_only_version_numbers_and_short_hashes()
    {
        var updated = ReportAuditEntry.Updated(5, "R", 2, Hash, 3, SqlHashOf(Sql));

        updated.OldValue.ShouldBe($"v2 {ReportAuditEntry.ShortHash(Hash)}");
        updated.NewValue.ShouldBe($"v3 {ReportAuditEntry.ShortHash(SqlHashOf(Sql))}");
        ReportAuditEntry.ShortHash(Hash).Length.ShouldBe(16);
        foreach (var e in Samples())
        {
            var all = string.Join(" ", e.Summary, e.OldValue, e.NewValue, e.FieldKey);
            all.ShouldNotContain("secret_column");
            all.ShouldNotContain("SELECT", Case.Sensitive);
        }
    }

    [Fact]
    public void A_run_event_carries_status_rows_timing_and_the_parameters_as_bound()
    {
        var e = ReportAuditEntry.RunCompleted(5, "Overdue tasks", 3, "Truncated", 50000, true, 2300, null, "[\"PODS=[1,2]\",\"FROM=2026-10-01\"]");

        e.Summary.ShouldBe("Ran report 'Overdue tasks' (version 3): Truncated, 50000 rows (cut off)");
        var json = JsonDocument.Parse(e.NewValue!).RootElement;
        json.GetProperty("status").GetString().ShouldBe("Truncated");
        json.GetProperty("rows").GetInt32().ShouldBe(50000);
        json.GetProperty("truncated").GetBoolean().ShouldBeTrue();
        json.GetProperty("ms").GetInt32().ShouldBe(2300);
        json.GetProperty("version").GetInt32().ShouldBe(3);
        json.GetProperty("parameters").EnumerateArray().Select(p => p.GetString()).ShouldBe(["PODS=[1,2]", "FROM=2026-10-01"]);
    }

    [Fact]
    public void A_failed_run_names_the_error_code_and_unreadable_parameters_are_left_out()
    {
        var e = ReportAuditEntry.RunCompleted(5, "R", 1, "Failed", null, false, null, "SQL_8134", "not json");

        var json = JsonDocument.Parse(e.NewValue!).RootElement;
        json.GetProperty("error").GetString().ShouldBe("SQL_8134");
        json.GetProperty("parameters").ValueKind.ShouldBe(JsonValueKind.Null);
        e.Summary.ShouldBe("Ran report 'R' (version 1): Failed");
    }

    [Fact]
    public void Very_long_names_and_lists_are_cut_to_the_column_sizes()
    {
        var longName = new string('n', 600);
        var names = Enumerable.Range(0, 2000).Select(i => "PARAM" + i).ToList();

        var created = ReportAuditEntry.Created(1, longName);
        var changed = ReportAuditEntry.ParametersChanged(1, "R", 2, names, names);
        var roles = ReportAuditEntry.RolesAssigned(1, "R", Enumerable.Repeat(new string('r', 100), 100).ToList(), []);

        created.Summary.Length.ShouldBe(500);
        created.Summary.ShouldEndWith("...");
        changed.NewValue!.Length.ShouldBeLessThanOrEqualTo(4000);
        roles.NewValue!.Length.ShouldBeLessThanOrEqualTo(4000);
    }

    [Fact]
    public void Roles_are_logged_by_name_with_added_and_removed_counts()
    {
        var e = ReportAuditEntry.RolesAssigned(5, "R", ["Pod Lead", "Director"], ["Intern"]);

        e.Summary.ShouldBe("Report 'R': roles +2 -1");
        e.NewValue.ShouldBe("Pod Lead, Director");
        e.OldValue.ShouldBe("Intern");
    }

    [Fact]
    public void The_run_log_json_for_the_column_never_exceeds_4000_characters()
    {
        var many = Enumerable.Range(0, 30).Select(i => new MatterFlow.Reports.Domain.Parameters.BoundParameter("P" + i, System.Data.SqlDbType.NVarChar, 400, 0, 0, "x", MatterFlow.Reports.Domain.Parameters.ListKind.None, "P" + i + "=" + new string('x', 200))).ToList();

        var json = ReportRunService.LogJson(many);

        json.Length.ShouldBeLessThanOrEqualTo(4000);
        JsonDocument.Parse(json).RootElement.ValueKind.ShouldBe(JsonValueKind.Array);
    }
}
