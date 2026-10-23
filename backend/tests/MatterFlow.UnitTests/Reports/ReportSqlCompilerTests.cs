using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>The engine-owned sub-select for list parameters and its parenthesis handling (spec 5.4; issue #698).</summary>
public class ReportSqlCompilerTests
{
    private const string IntSelect = "SELECT CAST([value] AS int) AS [value] FROM OPENJSON(@p_PODS)";
    private const string TextSelect = "SELECT CAST([value] AS nvarchar(200)) AS [value] FROM OPENJSON(@p_PODS)";

    private static readonly IReadOnlyDictionary<string, ListKind> IntList = new Dictionary<string, ListKind> { ["PODS"] = ListKind.Int };
    private static readonly IReadOnlyDictionary<string, ListKind> TextList = new Dictionary<string, ListKind> { ["PODS"] = ListKind.Text };

    private static string Text(string sql, IReadOnlyDictionary<string, ListKind>? lists = null) => ReportSqlCompiler.Compile(sql, lists ?? IntList).SqlText;

    [Fact]
    public void In_with_parentheses_drops_the_engines_own_outer_parentheses()
    {
        Text("SELECT 1 WHERE x IN (:PODS)").ShouldBe($"SELECT 1 WHERE x IN ({IntSelect})");
        Text("SELECT 1 WHERE x IN(:Pods)").ShouldBe($"SELECT 1 WHERE x IN({IntSelect})");
        Text("SELECT 1 WHERE x NOT IN (  :PODS  )").ShouldBe($"SELECT 1 WHERE x NOT IN (  {IntSelect}  )");
    }

    [Fact]
    public void In_without_parentheses_gets_the_engines_parentheses()
    {
        Text("SELECT 1 WHERE x IN :PODS").ShouldBe($"SELECT 1 WHERE x IN ({IntSelect})");
        Text("SELECT 1 WHERE x IN\n  :PODS\n  AND y = 1").ShouldBe($"SELECT 1 WHERE x IN\n  ({IntSelect})\n  AND y = 1");
    }

    [Fact]
    public void Comments_between_the_parenthesis_and_the_token_do_not_confuse_the_detection()
    {
        Text("SELECT 1 WHERE x IN ( /* the pods */ :PODS -- chosen\n )").ShouldBe($"SELECT 1 WHERE x IN ( /* the pods */ {IntSelect} -- chosen\n )");
        Text("SELECT 1 WHERE x IN /* ( */ :PODS /* ) */ ").ShouldBe($"SELECT 1 WHERE x IN /* ( */ ({IntSelect}) /* ) */ ");
    }

    [Fact]
    public void A_token_that_shares_the_parentheses_keeps_the_engines_own()
    {
        Text("SELECT 1 WHERE x IN (:PODS, 5)").ShouldBe($"SELECT 1 WHERE x IN (({IntSelect}), 5)");
        Text("SELECT 1 WHERE x IN (5, :PODS)").ShouldBe($"SELECT 1 WHERE x IN (5, ({IntSelect}))");
    }

    [Fact]
    public void The_cast_follows_the_declared_element_type_only()
    {
        Text("SELECT 1 WHERE x IN :PODS", TextList).ShouldContain("CAST([value] AS nvarchar(200))");
        Text("SELECT 1 WHERE x IN :PODS", IntList).ShouldContain("CAST([value] AS int)");
        Text("SELECT 1 WHERE x IN :PODS", TextList).ShouldBe($"SELECT 1 WHERE x IN ({TextSelect})");
    }

    [Fact]
    public void A_list_in_from_or_join_becomes_a_derived_table_with_an_alias_unless_the_author_wrote_one()
    {
        Text("SELECT 1 WHERE EXISTS (SELECT 1 FROM :PODS)").ShouldBe($"SELECT 1 WHERE EXISTS (SELECT 1 FROM ({IntSelect}) AS [list_PODS])");
        Text("SELECT 1 FROM :PODS WHERE 1 = 1").ShouldBe($"SELECT 1 FROM ({IntSelect}) AS [list_PODS] WHERE 1 = 1");
        Text("SELECT p.value FROM :PODS p").ShouldBe($"SELECT p.value FROM ({IntSelect}) p");
        Text("SELECT p.value FROM :PODS AS p").ShouldBe($"SELECT p.value FROM ({IntSelect}) AS p");
        Text("SELECT 1 FROM dbo.Task t JOIN :PODS ON 1 = 1").ShouldBe($"SELECT 1 FROM dbo.Task t JOIN ({IntSelect}) AS [list_PODS] ON 1 = 1");
        Text("SELECT 1 FROM dbo.Task t\nINNER JOIN :PODS p ON p.value = t.PodId").ShouldBe($"SELECT 1 FROM dbo.Task t\nINNER JOIN ({IntSelect}) p ON p.value = t.PodId");
    }

    [Fact]
    public void Empty_means_all_can_be_written_with_the_documented_snippet()
    {
        var (compiled, validation) = ReportSqlCompiler.CompileAndValidate(
            "SELECT t.TaskId FROM dbo.Task t WHERE (NOT EXISTS (SELECT 1 FROM :PODS) OR t.AssignedPodId IN :PODS)",
            [new ReportParameterDefinition { Name = "PODS", Type = ReportParameterType.Lookup, LookupKind = LookupKind.Pod, LookupMulti = true }]);

        validation.Errors.ShouldBeEmpty();
        compiled.SqlText.ShouldContain("FROM (SELECT CAST([value] AS int)");
        compiled.SqlText.ShouldContain("AS [list_PODS])");
    }

    [Fact]
    public void Scalar_placeholders_and_the_built_in_pod_list_are_handled_by_the_declaration()
    {
        Text("SELECT 1 WHERE a = :A AND b IN :CURRENT_POD_IDS", new Dictionary<string, ListKind> { ["CURRENT_POD_IDS"] = ListKind.Int })
            .ShouldBe("SELECT 1 WHERE a = @p_A AND b IN (SELECT CAST([value] AS int) AS [value] FROM OPENJSON(@p_CURRENT_POD_IDS))");
        ReportSqlCompiler.ListPlaceholders([]).ShouldContainKey("CURRENT_POD_IDS");
    }

    [Fact]
    public void Lists_come_from_the_definitions()
    {
        var defs = new[]
        {
            new ReportParameterDefinition { Name = "A", Type = ReportParameterType.Multi, ValueType = ChoiceValueType.Text },
            new ReportParameterDefinition { Name = "B", Type = ReportParameterType.Multi, ValueType = ChoiceValueType.Int },
            new ReportParameterDefinition { Name = "C", Type = ReportParameterType.Lookup, LookupKind = LookupKind.Client, LookupMulti = true },
            new ReportParameterDefinition { Name = "D", Type = ReportParameterType.Lookup, LookupKind = LookupKind.Client },
            new ReportParameterDefinition { Name = "E", Type = ReportParameterType.Single },
        };

        var lists = ReportSqlCompiler.ListPlaceholders(defs);

        lists["A"].ShouldBe(ListKind.Text);
        lists["B"].ShouldBe(ListKind.Int);
        lists["C"].ShouldBe(ListKind.Int);
        lists.ShouldNotContainKey("D");
        lists.ShouldNotContainKey("E");
    }

    [Fact]
    public void The_compiled_text_passes_the_validator_for_every_shape()
    {
        string[] shapes =
        [
            "SELECT 1 WHERE x IN (:PODS)",
            "SELECT 1 WHERE x IN :PODS",
            "SELECT 1 WHERE x NOT IN :PODS",
            "SELECT 1 WHERE x IN (:PODS, 5)",
            "SELECT 1 FROM :PODS",
            "SELECT 1 FROM :PODS p WHERE p.value > 0",
            "SELECT 1 FROM dbo.Task t JOIN :PODS p ON p.value = t.AssignedPodId",
            "SELECT 1 WHERE EXISTS (SELECT 1 FROM :PODS)",
        ];
        foreach (var sql in shapes)
        {
            var compiled = ReportSqlCompiler.Compile(sql, IntList);
            var result = SqlValidator.Validate(sql, compiled.Scan, compiled.Rewritten);
            result.Errors.ShouldBeEmpty($"{sql} -> {compiled.SqlText}");
        }
    }

    [Fact]
    public void Error_positions_after_a_long_expansion_still_point_into_the_authors_text()
    {
        const string sql = "SELECT 1 WHERE x IN :PODS\n  AND y IN (SELECT 1 FROM remote.db.dbo.t)";
        var compiled = ReportSqlCompiler.Compile(sql, IntList);

        var error = SqlValidator.Validate(sql, compiled.Scan, compiled.Rewritten).Errors.ShouldHaveSingleItem();

        error.Code.ShouldBe(SqlValidationCodes.LinkedServer);
        error.Position.ShouldBe(sql.IndexOf("remote", StringComparison.Ordinal));
        (error.Line, error.Column).ShouldBe((2, 27));
    }

    [Fact]
    public void Comment_spans_are_reported_by_the_scanner()
    {
        var scan = SqlScanner.Scan("SELECT 1 /* a */ -- b\n, 2 /* c /* d */ */");

        scan.CommentSpans.Count.ShouldBe(3);
        scan.CommentSpans[0].ShouldBe((9, 16));
    }

    [Fact]
    public void Nothing_but_the_found_tokens_changes()
    {
        const string sql = "SELECT ':PODS' AS [x:PODS], x -- :PODS\n FROM t WHERE y IN :PODS";

        Text(sql).ShouldBe($"SELECT ':PODS' AS [x:PODS], x -- :PODS\n FROM t WHERE y IN ({IntSelect})");
    }
}
