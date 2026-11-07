using System.Text.RegularExpressions;
using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Seeding;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Application.Starters;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>
/// The starter reports as data (issue #724): every embedded SQL file is in the manifest and the other way round, and each starter passes the same checks an
/// administrator's report passes (parameters, validator) plus the rules that keep starters safe: SELECT only, parameterised, no sensitive-matter leak.
/// The real run through the read-only login is in <c>ReportStarterTests</c> (integration).
/// </summary>
public class StarterReportManifestTests
{
    private static readonly StarterReportManifest Manifest = StarterReportManifest.LoadEmbedded();

    private static string WithoutComments(string sql) => string.Join('\n', sql.Split('\n').Where(l => !l.TrimStart().StartsWith("--", StringComparison.Ordinal)));

    [Fact]
    public void Every_embedded_sql_file_is_in_the_manifest_and_every_manifest_entry_has_a_file()
    {
        var files = StarterReportManifest.EmbeddedSqlKeys();
        var keys = Manifest.Reports.Select(r => r.Key).Order(StringComparer.Ordinal).ToList();

        files.ShouldNotBeEmpty();
        files.ShouldBe(keys);
    }

    [Fact]
    public void There_are_ten_starters_with_unique_keys_and_names_in_the_declared_categories()
    {
        Manifest.Reports.Count.ShouldBe(10);
        Manifest.Reports.Select(r => r.Key).ShouldBeUnique();
        Manifest.Reports.Select(r => r.Name).ShouldBeUnique();
        Manifest.Categories.Select(c => c.Name).ShouldBeUnique();
        Manifest.Reports.ShouldAllBe(r => Manifest.Categories.Any(c => c.Name == r.Category));
        Manifest.Categories.ShouldAllBe(c => Manifest.Reports.Any(r => r.Category == c.Name));
        Manifest.Reports.ShouldAllBe(r => Regex.IsMatch(r.Key, "^[a-z0-9]+(-[a-z0-9]+)*$"));
        Manifest.Reports.ShouldAllBe(r => r.MarkerName.Length <= 100);
        Manifest.Reports.ShouldAllBe(r => r.Name.Length <= ReportAdminService.MaxNameLength && r.Description.Length > 0 && r.Description.Length <= ReportAdminService.MaxDescriptionLength);
        Manifest.Reports.ShouldAllBe(r => r.HelpText != null && r.HelpText.Length <= ReportAdminService.MaxHelpTextLength);
        Manifest.Reports.ShouldAllBe(r => r.Columns.Count > 0);
    }

    [Fact]
    public void Every_starter_has_valid_parameters_and_passes_the_validator()
    {
        foreach (var starter in Manifest.Reports)
        {
            ReportStarterSeeder.Problem(starter).ShouldBeNull(starter.Key);

            var definitions = ParameterDefinitionJson.Deserialize(ReportAuthoringService.NormalizeParameters(starter.ParametersJson, out var problem));
            problem.ShouldBeNull(starter.Key);
            ParameterDefinitionValidator.Validate(definitions).ShouldBeEmpty(starter.Key);

            var (compiled, validation) = ReportSqlCompiler.CompileAndValidate(starter.Sql, definitions);
            validation.IsValid.ShouldBeTrue(starter.Key + ": " + string.Join("; ", validation.Errors.Select(e => e.Message)));

            // Every placeholder of the SQL has a definition or is a built-in, and every definition is used (an unused one would be a field that does nothing).
            var covered = definitions.SelectMany(d => d.PlaceholderNames).ToHashSet(StringComparer.Ordinal);
            compiled.UsedPlaceholders.Where(p => !BuiltInParameters.IsBuiltIn(p)).ShouldBe(covered, ignoreOrder: true, customMessage: starter.Key);
        }
    }

    [Fact]
    public void Starters_are_one_parameterised_select_without_variables_or_dynamic_sql()
    {
        foreach (var starter in Manifest.Reports)
        {
            var sql = WithoutComments(starter.Sql);
            sql.TrimStart().ShouldStartWith("SELECT", Case.Insensitive, starter.Key);
            sql.ShouldNotContain("@", Case.Sensitive, starter.Key);
            sql.ShouldNotContain(";", Case.Sensitive, starter.Key);
            Regex.IsMatch(sql, @"\b(EXEC|EXECUTE|INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|INTO|OPENROWSET|OPENQUERY|xp_|sp_)\b", RegexOptions.IgnoreCase).ShouldBeFalse(starter.Key);
        }
    }

    [Fact]
    public void Starters_read_only_tables_the_report_login_may_read()
    {
        var allowed = ReportAccessCatalogue.Current.Allowed.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var starter in Manifest.Reports)
        {
            var tables = Regex.Matches(starter.Sql + "\n" + starter.ParametersJson, @"\bdbo\.(\w+)", RegexOptions.IgnoreCase).Select(m => m.Groups[1].Value).Distinct().ToList();
            tables.ShouldNotBeEmpty(starter.Key);
            tables.ShouldAllBe(t => allowed.Contains(t), starter.Key + " reads a table the report login cannot read: " + string.Join(", ", tables.Where(t => !allowed.Contains(t))));
        }
    }

    [Fact]
    public void A_starter_that_reads_matters_says_so_and_leaves_sensitive_matters_out_by_default()
    {
        foreach (var starter in Manifest.Reports)
        {
            var sql = WithoutComments(starter.Sql);
            var readsMatters = Regex.IsMatch(sql, @"\bdbo\.Matter\b", RegexOptions.IgnoreCase);
            readsMatters.ShouldBe(starter.ListsMatterNames, $"{starter.Key}: listsMatterNames in the manifest must say whether the SQL reads dbo.Matter");
            if (!starter.ListsMatterNames)
                continue;

            if (sql.Contains(":CURRENT_USER_CAN_ASSIGN_MANAGERS", StringComparison.Ordinal))
            {
                // The Project Manager starters (#784): the scope is a fixed choice that starts as "mine", "all" needs the permission through the built-in value, and a sensitive
                // matter is listed only for the person who manages it, in either scope.
                var scope = ParameterDefinitionJson.Deserialize(starter.ParametersJson).SingleOrDefault(d => d.Name == "SCOPE");
                scope.ShouldNotBeNull(starter.Key);
                scope!.Type.ShouldBe(ReportParameterType.Single, starter.Key);
                scope.Options.Select(o => o.Value).ShouldBe(["mine", "all"], starter.Key);
                scope.Default!.Value.GetString().ShouldBe("mine", starter.Key);
                sql.ShouldContain("(m.PrimaryManagerId = :CURRENT_USER_ID OR m.SecondaryManagerId = :CURRENT_USER_ID", Case.Sensitive, starter.Key);
                sql.ShouldContain("(:SCOPE = 'all' AND :CURRENT_USER_CAN_ASSIGN_MANAGERS = 1)", Case.Sensitive, starter.Key);
                sql.ShouldContain("(m.IsSensitive = 0 OR m.PrimaryManagerId = :CURRENT_USER_ID OR m.SecondaryManagerId = :CURRENT_USER_ID)", Case.Sensitive, starter.Key);
                sql.ShouldNotContain(":INCLUDE_SENSITIVE", Case.Sensitive, starter.Key);
                starter.HelpText!.ShouldContain("matter names", Case.Insensitive, starter.Key);
                continue;
            }

            var parameter = ParameterDefinitionJson.Deserialize(starter.ParametersJson).SingleOrDefault(d => d.Name == "INCLUDE_SENSITIVE");
            parameter.ShouldNotBeNull(starter.Key);
            parameter!.Type.ShouldBe(ReportParameterType.YesNo, starter.Key);
            parameter.Default.ShouldNotBeNull(starter.Key);
            parameter.Default!.Value.GetBoolean().ShouldBeFalse(starter.Key);
            sql.ShouldContain("(:INCLUDE_SENSITIVE = 1 OR m.IsSensitive = 0)", Case.Sensitive, starter.Key);
            starter.HelpText!.ShouldContain("matter names", Case.Insensitive, starter.Key);
        }

        Manifest.Reports.Where(r => r.ListsMatterNames).Select(r => r.Key).ShouldBe(["tasks-per-matter", "assets-linked-to-open-tasks", "open-and-overdue-tasks-by-matter", "tasks-completed-this-month"], ignoreOrder: true);
    }

    [Fact]
    public void Starters_never_read_task_titles_descriptions_or_email_addresses()
    {
        foreach (var starter in Manifest.Reports)
            Regex.IsMatch(WithoutComments(starter.Sql), @"\b(Title|Description|Email|RequestorName|RequestorEmail|CustomFieldsJson|ExternalReference)\b", RegexOptions.IgnoreCase).ShouldBeFalse(starter.Key);
    }

    [Fact]
    public void Only_the_two_Project_Manager_starters_name_a_role_and_it_is_the_one_starter_role_that_holds_Report_Run()
    {
        // Owner decision 8 (2026-11-07): the Project Manager role holds Report.Run, no other starter role does. A starter is given only to a starter role that holds Run.
        foreach (var starter in Manifest.Reports)
        {
            foreach (var role in starter.Roles)
                StarterRoles.All.Single(r => r.Name == role).Permissions.ShouldContain(Permissions.Report.Run, starter.Key + " names " + role);
        }

        StarterRoles.All.Where(r => r.Permissions.Contains(Permissions.Report.Run)).Select(r => r.Name).ShouldBe(["Project Manager"]);
        Manifest.Reports.Where(r => r.Roles.Count > 0).Select(r => r.Key).ShouldBe(["open-and-overdue-tasks-by-matter", "tasks-completed-this-month"], ignoreOrder: true);
        Manifest.Reports.Where(r => r.Roles.Count > 0).ShouldAllBe(r => r.Roles.SequenceEqual(new[] { "Project Manager" }));
    }

    [Fact]
    public void The_default_parameter_values_alone_make_every_starter_runnable()
    {
        var context = new BuiltInContext(7, "Ann", new DateOnly(2026, 11, 7), new DateTime(2026, 11, 7, 14, 0, 0, DateTimeKind.Utc), [3], 3, -300);
        foreach (var starter in Manifest.Reports)
        {
            var definitions = ParameterDefinitionJson.Deserialize(ReportAuthoringService.NormalizeParameters(starter.ParametersJson, out _));
            var (compiled, _) = ReportSqlCompiler.CompileAndValidate(starter.Sql, definitions);
            var bind = ParameterBinder.Bind(definitions, ReportSamples.Complete(definitions, new Dictionary<string, System.Text.Json.JsonElement>(), context), context, compiled.UsedPlaceholders);

            bind.Errors.ShouldBeEmpty(starter.Key);
        }
    }
}
