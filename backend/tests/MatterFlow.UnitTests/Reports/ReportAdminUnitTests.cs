using System.Text.Json;
using MatterFlow.Reports.Api;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Application.Results;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.Reports.Infrastructure;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>Line diff, definition validation, schema search, choice list reading and the small admin helpers (epic #671, issues #708, #710, #711).</summary>
public class LineDiffTests
{
    [Fact]
    public void Identical_texts_are_all_same_and_line_endings_do_not_matter()
    {
        var diff = LineDiff.Compute("a\r\nb\nc", "a\nb\r\nc");

        diff.Select(d => d.Kind).ShouldAllBe(k => k == DiffKind.Same);
        diff.Count.ShouldBe(3);
    }

    [Fact]
    public void Added_and_removed_lines_carry_their_line_numbers()
    {
        var diff = LineDiff.Compute("SELECT a\nFROM t\nWHERE x = 1", "SELECT a, b\nFROM t\nWHERE x = 1\nORDER BY a");

        diff.Select(d => (d.Kind, d.Text, d.OldLine, d.NewLine)).ShouldBe(
        [
            (DiffKind.Removed, "SELECT a", 1, null),
            (DiffKind.Added, "SELECT a, b", null, 1),
            (DiffKind.Same, "FROM t", 2, 2),
            (DiffKind.Same, "WHERE x = 1", 3, 3),
            (DiffKind.Added, "ORDER BY a", null, 4),
        ]);
    }

    [Fact]
    public void Empty_sides_work_and_a_huge_change_falls_back_to_remove_then_add()
    {
        LineDiff.Compute("", "a\nb").Select(d => d.Kind).ShouldBe([DiffKind.Added, DiffKind.Added]);
        LineDiff.Compute("a", "").Select(d => d.Kind).ShouldBe([DiffKind.Removed]);
        LineDiff.Compute("", "").ShouldBeEmpty();

        var old = string.Join('\n', Enumerable.Range(0, 2500).Select(i => "old " + i));
        var @new = string.Join('\n', Enumerable.Range(0, 2500).Select(i => "new " + i));
        var diff = LineDiff.Compute(old, @new);
        diff.Count(d => d.Kind == DiffKind.Removed).ShouldBe(2500);
        diff.Count(d => d.Kind == DiffKind.Added).ShouldBe(2500);
    }

    [Fact]
    public void A_moved_block_is_reported_as_remove_and_add_not_lost()
    {
        var diff = LineDiff.Compute("a\nb\nc\nd", "a\nc\nd\nb");

        diff.Where(d => d.Kind != DiffKind.Removed).Select(d => d.Text).ShouldBe(["a", "c", "d", "b"]);
        diff.Where(d => d.Kind != DiffKind.Added).Select(d => d.Text).ShouldBe(["a", "b", "c", "d"]);
    }
}

public class ParameterDefinitionValidatorTests
{
    private static ReportParameterDefinition Def(string name, ReportParameterType type = ReportParameterType.Text, Action<ReportParameterDefinition>? _ = null) =>
        new() { Name = name, Type = type, Label = name };

    private static IReadOnlyList<DefinitionIssue> Check(params ReportParameterDefinition[] defs) =>
        ParameterDefinitionValidator.Validate(ParameterDefinitionValidator.Normalize(defs));

    [Fact]
    public void Names_are_upper_cased_and_checked_for_shape_reserved_words_and_duplicates()
    {
        Check(Def("pods")).ShouldBeEmpty();
        Check(Def("1BAD")).Single().Code.ShouldBe(DefinitionIssueCodes.BadName);
        Check(Def("has space")).Single().Code.ShouldBe(DefinitionIssueCodes.BadName);
        Check(Def("today")).Single().Code.ShouldBe(DefinitionIssueCodes.ReservedName);
        Check(Def("Current_Pod_Ids")).Single().Code.ShouldBe(DefinitionIssueCodes.ReservedName);
        Check(Def("A"), Def("a")).Single().Code.ShouldBe(DefinitionIssueCodes.DuplicateName);
        Check(Def(new string('A', 65))).Single().Code.ShouldBe(DefinitionIssueCodes.BadName);
    }

    [Fact]
    public void A_date_range_claims_both_of_its_placeholder_names()
    {
        Check(Def("PERIOD", ReportParameterType.DateRange), Def("PERIOD_FROM")).Single().Code.ShouldBe(DefinitionIssueCodes.DuplicateName);
        Check(Def("NOW", ReportParameterType.DateRange)).ShouldBeEmpty();
        Check(Def("NOW_UTC", ReportParameterType.DateRange)).ShouldBeEmpty(); // NOW_UTC_FROM / NOW_UTC_TO are not reserved
    }

    [Fact]
    public void Labels_and_lookups_and_choices_need_their_settings()
    {
        Check(new ReportParameterDefinition { Name = "A", Type = ReportParameterType.Text, Label = "" }).Single().Code.ShouldBe(DefinitionIssueCodes.LabelRequired);
        Check(Def("A", ReportParameterType.Lookup)).Single().Code.ShouldBe(DefinitionIssueCodes.LookupKindRequired);
        Check(Def("A", ReportParameterType.Single)).Single().Code.ShouldBe(DefinitionIssueCodes.OptionsKindRequired);
        Check(new ReportParameterDefinition { Name = "A", Type = ReportParameterType.Single, Label = "A", OptionsKind = OptionsKind.Fixed }).Single().Code.ShouldBe(DefinitionIssueCodes.OptionsEmpty);
        Check(new ReportParameterDefinition { Name = "A", Type = ReportParameterType.Lookup, Label = "A", LookupKind = LookupKind.Client }).ShouldBeEmpty();
    }

    [Fact]
    public void A_fixed_list_has_unique_values_of_the_right_type_and_at_most_200_entries()
    {
        ReportParameterDefinition Fixed(ChoiceValueType type, params (string, string)[] options) =>
            new() { Name = "A", Type = ReportParameterType.Single, Label = "A", OptionsKind = OptionsKind.Fixed, ValueType = type, Options = options.Select(o => new ParameterOption(o.Item1, o.Item2)).ToList() };

        Check(Fixed(ChoiceValueType.Text, ("a", "A"), ("b", "B"))).ShouldBeEmpty();
        Check(Fixed(ChoiceValueType.Text, ("a", "A"), ("a", "Again"))).Single().Code.ShouldBe(DefinitionIssueCodes.OptionDuplicate);
        Check(Fixed(ChoiceValueType.Int, ("1", "One"), ("x", "Ex"))).Single().Code.ShouldBe(DefinitionIssueCodes.OptionValueInvalid);
        Check(Fixed(ChoiceValueType.Text, ("a", ""))).Single().Code.ShouldBe(DefinitionIssueCodes.OptionValueInvalid);
        Check(Fixed(ChoiceValueType.Text, Enumerable.Range(0, 201).Select(i => ($"v{i}", $"L{i}")).ToArray())).Select(i => i.Code).ShouldContain(DefinitionIssueCodes.OptionsTooMany);
        Check(Fixed(ChoiceValueType.Text, Enumerable.Range(0, 200).Select(i => ($"v{i}", $"L{i}")).ToArray())).ShouldBeEmpty();
    }

    [Fact]
    public void A_choice_query_goes_through_the_report_validator_and_may_use_built_ins_only()
    {
        ReportParameterDefinition Query(string? sql) => new() { Name = "A", Type = ReportParameterType.Single, Label = "A", OptionsKind = OptionsKind.Query, OptionsSql = sql };

        Check(Query("SELECT Id AS Value, Name AS Label FROM dbo.Pod")).ShouldBeEmpty();
        Check(Query("SELECT PodId AS Value, Name AS Label FROM dbo.Pod WHERE PodId IN (:CURRENT_POD_IDS)")).ShouldBeEmpty();
        Check(Query(null)).Single().Code.ShouldBe(DefinitionIssueCodes.OptionsSqlRequired);
        Check(Query("DELETE dbo.Pod")).Select(i => i.Code).ShouldBe([DefinitionIssueCodes.OptionsSqlInvalid]);
        Check(Query("SELECT 1; SELECT 2")).ShouldNotBeEmpty();
        Check(Query("EXEC sp_who")).ShouldNotBeEmpty();
        Check(Query("SELECT :OTHER AS Value, 'x' AS Label")).Single().Code.ShouldBe(DefinitionIssueCodes.OptionsSqlParameters);
        Check(Query("SELECT * FROM OPENROWSET('x','y','z')")).ShouldNotBeEmpty();
    }

    [Fact]
    public void Normalizing_drops_what_a_type_does_not_use()
    {
        var d = ParameterDefinitionValidator.Normalize(
        [
            new ReportParameterDefinition
            {
                Name = " text ", Type = ReportParameterType.Text, Label = " L ", OptionsKind = OptionsKind.Query, OptionsSql = "SELECT 1", LookupKind = LookupKind.Pod,
                Options = [new ParameterOption("a", "A")], Min = 1, MaxSelected = 5,
            },
        ]).Single();

        d.Name.ShouldBe("TEXT");
        d.Label.ShouldBe("L");
        d.OptionsKind.ShouldBeNull();
        d.OptionsSql.ShouldBeNull();
        d.LookupKind.ShouldBeNull();
        d.Options.ShouldBeEmpty();
        d.Min.ShouldBeNull();
        d.MaxSelected.ShouldBeNull();
    }

    [Fact]
    public void Number_and_text_and_selection_limits_are_range_checked()
    {
        Check(new ReportParameterDefinition { Name = "N", Type = ReportParameterType.Number, Label = "N", Min = 5, Max = 1 }).Single().Code.ShouldBe(DefinitionIssueCodes.RangeInvalid);
        Check(new ReportParameterDefinition { Name = "T", Type = ReportParameterType.Text, Label = "T", MaxLength = 401 }).Single().Code.ShouldBe(DefinitionIssueCodes.RangeInvalid);
        Check(new ReportParameterDefinition { Name = "L", Type = ReportParameterType.Lookup, Label = "L", LookupKind = LookupKind.User, LookupMulti = true, MaxSelected = 1001 }).Single().Code.ShouldBe(DefinitionIssueCodes.RangeInvalid);
        Check(Enumerable.Range(0, 101).Select(i => Def("P" + i)).ToArray()).Select(i => i.Code).ShouldContain(DefinitionIssueCodes.TooMany);
    }

    [Fact]
    public void The_choice_query_text_survives_a_json_round_trip_and_a_resolved_list_is_not_stored_by_the_author_path()
    {
        var defs = ParameterDefinitionValidator.Normalize([new ReportParameterDefinition { Name = "A", Type = ReportParameterType.Single, Label = "A", OptionsKind = OptionsKind.Query, OptionsSql = "SELECT 'a' AS Value, 'A' AS Label" }]);

        var json = ParameterDefinitionJson.Serialize(defs);

        json.ShouldContain("\"optionsSql\"");
        ParameterDefinitionJson.Deserialize(json).Single().OptionsSql.ShouldBe("SELECT 'a' AS Value, 'A' AS Label");
    }
}

public class ReportSchemaServiceTests
{
    private sealed class Reader(IReadOnlyList<SchemaTable>? tables) : IReportSchemaReader
    {
        public Task<IReadOnlyList<SchemaTable>?> ReadAsync(CancellationToken cancellationToken) => Task.FromResult(tables);
    }

    private sealed class Availability(bool enabled) : IReportsAvailability
    {
        public ReportsStatus Current => new(enabled, enabled ? ReportsStates.Ready : ReportsStates.NotConfigured, "x");

        public string? ReportConnectionString => null;

        public Task<ReportsStatus> CheckAsync(CancellationToken cancellationToken) => Task.FromResult(Current);
    }

    private static SchemaTable Table(string name, params string[] columns) => new("dbo", name, false, columns.Select((c, i) => new SchemaColumn(c, "int", false, i == 0)).ToList());

    private static ReportSchemaService Service(bool enabled = true, params SchemaTable[] tables) => new(new Reader(tables), new Availability(enabled));

    [Fact]
    public async Task Search_matches_table_and_column_names_case_insensitively_and_sorts_by_name()
    {
        var service = Service(true, Table("Task", "TaskId", "Title"), Table("Pod", "PodId", "Name"), Table("Client", "ClientId", "Name"));

        (await service.SearchAsync("name", 1, 50, default))!.Tables.Select(t => t.Name).ShouldBe(["Client", "Pod"]);
        (await service.SearchAsync("TASK", 1, 50, default))!.Tables.Select(t => t.Name).ShouldBe(["Task"]);
        (await service.SearchAsync(null, 1, 50, default))!.Tables.Select(t => t.Name).ShouldBe(["Client", "Pod", "Task"]);
        (await service.SearchAsync("dbo.po", 1, 50, default))!.Total.ShouldBe(1);
    }

    [Fact]
    public async Task Paging_clamps_the_page_and_the_page_size()
    {
        var service = Service(true, Enumerable.Range(0, 7).Select(i => Table("T" + i, "Id")).ToArray());

        var page = (await service.SearchAsync(null, 2, 3, default))!;
        page.Tables.Select(t => t.Name).ShouldBe(["T3", "T4", "T5"]);
        page.Total.ShouldBe(7);
        (await service.SearchAsync(null, 99, 3, default))!.Page.ShouldBe(3);
        (await service.SearchAsync(null, -4, 3, default))!.Page.ShouldBe(1);
        (await service.SearchAsync(null, 1, 100_000, default))!.PageSize.ShouldBe(ReportSchemaService.MaxPageSize);
        (await service.SearchAsync(null, 1, 0, default))!.PageSize.ShouldBe(ReportSchemaService.DefaultPageSize);
    }

    [Fact]
    public async Task Nothing_is_returned_while_reports_are_off_and_find_works_by_short_or_full_name()
    {
        (await Service(false, Table("Task", "TaskId")).SearchAsync(null, 1, 50, default)).ShouldBeNull();
        (await Service(false, Table("Task", "TaskId")).FindAsync("Task", default)).ShouldBeNull();
        var service = Service(true, Table("Task", "TaskId"));
        (await service.FindAsync("task", default))!.FullName.ShouldBe("dbo.Task");
        (await service.FindAsync("DBO.TASK", default)).ShouldNotBeNull();
        (await service.FindAsync("Nope", default)).ShouldBeNull();
    }

    [Theory]
    [InlineData("nvarchar", 400, 0, 0, "nvarchar(200)")]
    [InlineData("nvarchar", -1, 0, 0, "nvarchar(max)")]
    [InlineData("varchar", 20, 0, 0, "varchar(20)")]
    [InlineData("varbinary", -1, 0, 0, "varbinary(max)")]
    [InlineData("decimal", 9, 18, 2, "decimal(18,2)")]
    [InlineData("datetime2", 8, 27, 3, "datetime2(3)")]
    [InlineData("datetime2", 8, 27, 7, "datetime2")]
    [InlineData("int", 4, 10, 0, "int")]
    [InlineData("bit", 1, 1, 0, "bit")]
    public void Types_are_written_the_way_an_author_would(string type, short length, byte precision, byte scale, string expected) =>
        ReportSchemaReader.Format(type, length, precision, scale).ShouldBe(expected);
}

public class ChoiceListReadingTests
{
    private static ResultTable Table(string[] names, params object?[][] rows)
    {
        var builder = new ResultTableBuilder(1000, 1_000_000);
        builder.Begin(names.Select(n => new ResultColumn(n, ReportColumnType.Text)).ToList());
        foreach (var row in rows)
            builder.TryAdd(row);
        return builder.Build();
    }

    [Fact]
    public void Value_and_Label_columns_are_read_case_insensitively_and_duplicates_and_nulls_are_skipped()
    {
        var list = ReportChoiceService.Read(Table(["value", "LABEL"], ["a", "Alpha"], ["a", "Again"], [null, "Nothing"], ["b", null]), ChoiceValueType.Text, false, 5);

        list.IsOk.ShouldBeTrue();
        list.Options.Select(o => (o.Value, o.Label)).ShouldBe([("a", "Alpha"), ("b", "b")]);
    }

    [Fact]
    public void Other_column_names_are_refused()
    {
        var list = ReportChoiceService.Read(Table(["Id", "Name"], ["a", "A"]), ChoiceValueType.Text, false, 5);

        list.ErrorCode.ShouldBe(ChoiceCodes.Columns);
    }

    [Fact]
    public void Whole_number_lists_must_hold_whole_numbers_and_numbers_are_formatted_without_culture()
    {
        ReportChoiceService.Read(Table(["Value", "Label"], ["1", "One"], ["x", "Ex"]), ChoiceValueType.Int, false, 5).ErrorCode.ShouldBe(ChoiceCodes.QueryFailed);

        var builder = new ResultTableBuilder(10, 1_000_000);
        builder.Begin([new ResultColumn("Value", ReportColumnType.Integer), new ResultColumn("Label", ReportColumnType.Text)]);
        builder.TryAdd([12345L, "Big"]);
        ReportChoiceService.Read(builder.Build(), ChoiceValueType.Int, false, 5).Options.Single().Value.ShouldBe("12345");
    }

    [Fact]
    public void A_value_longer_than_200_characters_is_refused()
    {
        ReportChoiceService.Read(Table(["Value", "Label"], [new string('x', 201), "Long"]), ChoiceValueType.Text, false, 5).ErrorCode.ShouldBe(ChoiceCodes.QueryFailed);
    }
}

public class ReportAdminHelperTests
{
    [Theory]
    [InlineData("\"AAAAAAAAB9E=\"", true)]
    [InlineData("AAAAAAAAB9E=", true)]
    [InlineData("W/\"AAAAAAAAB9E=\"", true)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("not base64!", false)]
    public void If_Match_reads_a_quoted_or_bare_row_version(string? header, bool ok)
    {
        IfMatch.TryRead(header, out var value).ShouldBe(ok);
        (value.Length > 0).ShouldBe(ok);
    }

    [Theory]
    [InlineData("a%b_c[d]\\e", "a\\%b\\_c\\[d]\\\\e")]
    [InlineData("plain", "plain")]
    public void Search_text_cannot_act_as_a_LIKE_pattern(string input, string expected) => ReportAdminStore.EscapeLike(input).ShouldBe(expected);

    [Fact]
    public void Choice_query_changes_are_found_by_parameter_with_the_old_and_new_hash()
    {
        const string before = "[{\"name\":\"A\",\"type\":\"single\",\"label\":\"A\",\"optionsKind\":\"query\",\"optionsSql\":\"SELECT 1\"},{\"name\":\"B\",\"type\":\"single\",\"label\":\"B\",\"optionsKind\":\"query\",\"optionsSql\":\"SELECT 2\"}]";
        const string after = "[{\"name\":\"A\",\"type\":\"single\",\"label\":\"A\",\"optionsKind\":\"query\",\"optionsSql\":\"SELECT 1\"},{\"name\":\"B\",\"type\":\"single\",\"label\":\"B\",\"optionsKind\":\"query\",\"optionsSql\":\"SELECT 3\"},{\"name\":\"C\",\"type\":\"single\",\"label\":\"C\",\"optionsKind\":\"query\",\"optionsSql\":\"SELECT 4\"}]";

        var changes = ReportDefinitionStore.ChoiceSqlChanges(before, after);

        changes.Select(c => c.Parameter).ShouldBe(["B", "C"]);
        changes[0].OldHash.ShouldNotBeNull();
        changes[1].OldHash.ShouldBeNull();
        ReportDefinitionStore.ChoiceSqlChanges(before, before).ShouldBeEmpty();
        ReportDefinitionStore.ChoiceSqlChanges(null, "not json").ShouldBeEmpty();
    }

    [Fact]
    public void New_audit_builders_name_the_object_and_never_hold_sql()
    {
        var details = ReportAuditEntry.DetailsChanged(5, "Overdue", ["name", "order"]);
        details.EventType.ShouldBe(ReportAuditEvents.Updated);
        details.NewValue.ShouldBe("name, order");

        var category = ReportAuditEntry.CategorySaved(3, "Finance", "Fin", false, "renamed from 'Fin'");
        category.ObjectType.ShouldBe(ReportAuditEvents.CategoryObjectType);
        category.ReportId.ShouldBe(3);
        category.Summary.ShouldContain("renamed");
        ReportAuditEntry.CategorySaved(3, "Finance", null, true, "").Summary.ShouldBe("Report category 'Finance' created");
        ReportAuditEntry.Created(5, "x").ObjectType.ShouldBe("Report");
    }

    [Fact]
    public void Normalize_makes_the_same_definitions_equal_whatever_the_spelling()
    {
        const string a = "[{\"name\":\"pods\",\"type\":\"multi\",\"label\":\"Pods\",\"optionsKind\":\"fixed\",\"options\":[{\"value\":\"x\",\"label\":\"X\"}]}]";
        const string b = "[{\"label\":\"Pods\",\"type\":\"multi\",\"name\":\"PODS\",\"optionsKind\":\"fixed\",\"options\":[{\"label\":\"X\",\"value\":\"x\"}],\"min\":3}]";

        ReportAuthoringService.Canonical(a).ShouldBe(ReportAuthoringService.Canonical(b));
    }

    [Fact]
    public void Parameter_definitions_with_a_bad_enum_are_a_400_not_a_crash()
    {
        ReportAuthoringService.NormalizeParameters("[{\"name\":\"A\",\"type\":\"nonsense\",\"label\":\"A\"}]", out var problem);
        problem!.Status.ShouldBe(400);
        ReportAuthoringService.NormalizeParameters("[{\"name\":\"A\",\"type\":\"text\",\"label\":\"\"}]", out var invalid);
        invalid!.Status.ShouldBe(422);
        invalid.Errors!.ShouldContainKey("parameters.A.label");
        _ = JsonDocument.Parse("[]");
    }
}
