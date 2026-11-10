using System.Text.Json;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Domain.Parameters;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>The parameter definitions as the run page gets them: the shape per type, defaults resolved for the person, and nothing that could carry SQL (issue #719).</summary>
public class ReportRunnableDefinitionTests
{
    private static readonly BuiltInContext Context = new(7, "Ann", new DateOnly(2026, 11, 7), new DateTime(2026, 11, 7, 12, 0, 0, DateTimeKind.Utc), [3, 5], 3, -300);

    private static ReportParameterDefinition Single(string json) => ParameterDefinitionJson.Deserialize(json)[0];

    private static RunnableParameter Map(string json, BuiltInContext? context = null) => ReportBrowseService.ToParameter(Single(json), context ?? Context);

    [Fact]
    public void A_fixed_choice_list_carries_its_options_and_a_query_list_only_says_where_to_ask()
    {
        var fixedList = Map("""[{"name":"KIND","type":"single","label":"Kind","valueType":"text","optionsKind":"fixed","options":[{"value":"a","label":"Alpha"},{"value":"b","label":"Beta"}]}]""");
        var query = Map("""[{"name":"KIND","type":"multi","label":"Kind","valueType":"int","optionsKind":"query","optionsSql":"SELECT 1 AS Value, 'secret_option_marker' AS Label"}]""");

        fixedList.ChoicesSource.ShouldBe("fixed");
        fixedList.ValueType.ShouldBe("text");
        fixedList.Multiple.ShouldBeFalse();
        fixedList.Options.Select(o => (o.Value, o.Label)).ShouldBe([("a", "Alpha"), ("b", "Beta")]);
        query.ChoicesSource.ShouldBe("query");
        query.ValueType.ShouldBe("int");
        query.Multiple.ShouldBeTrue();
        query.Options.ShouldBeEmpty();
        JsonSerializer.Serialize(query).ShouldNotContain("secret_option_marker");
    }

    [Fact]
    public void A_lookup_names_its_kind_and_whether_it_takes_several()
    {
        var single = Map("""[{"name":"M","type":"lookup","label":"Matter","lookupKind":"matter"}]""");
        var multi = Map("""[{"name":"T","type":"lookup","label":"Task type","lookupKind":"taskType","lookupMulti":true,"maxSelected":20}]""");

        single.Type.ShouldBe("lookup");
        single.LookupKind.ShouldBe("matter");
        single.Multiple.ShouldBeFalse();
        single.MaxSelected.ShouldBeNull();
        multi.LookupKind.ShouldBe("taskType");
        multi.Multiple.ShouldBeTrue();
        multi.MaxSelected.ShouldBe(20);
    }

    [Fact]
    public void Number_and_text_limits_show_only_on_their_own_type()
    {
        var number = Map("""[{"name":"N","type":"number","label":"Count","min":1,"max":99.5,"integerOnly":true,"isRequired":true}]""");
        var text = Map("""[{"name":"S","type":"text","label":"Contains","maxLength":50}]""");
        var plainText = Map("""[{"name":"S","type":"text","label":"Contains"}]""");

        (number.Min, number.Max, number.IntegerOnly, number.Required, number.MaxLength).ShouldBe((1m, 99.5m, true, true, null));
        (text.MaxLength, text.Min, text.IntegerOnly).ShouldBe((50, null, false));
        plainText.MaxLength.ShouldBe(ReportParameterDefinition.DefaultMaxTextLength);
    }

    [Fact]
    public void Defaults_are_resolved_for_the_person_and_the_day()
    {
        Map("""[{"name":"D","type":"date","label":"Day","default":"today-7"}]""").Default.ToString().ShouldBe("2026-10-31");
        Map("""[{"name":"R","type":"dateRange","label":"Period","default":"thisMonth"}]""").Default!.Value.GetProperty("from").GetString().ShouldBe("2026-11-01");
        Map("""[{"name":"P","type":"lookup","label":"Pods","lookupKind":"pod","lookupMulti":true,"default":"myPods"}]""").Default!.Value.EnumerateArray().Select(e => e.GetInt32()).ShouldBe([3, 5]);
        Map("""[{"name":"U","type":"lookup","label":"Person","lookupKind":"user","default":"me"}]""").Default!.Value.GetInt32().ShouldBe(7);
        Map("""[{"name":"Y","type":"yesNo","label":"Open only","default":true}]""").Default!.Value.GetBoolean().ShouldBeTrue();
        Map("""[{"name":"S","type":"text","label":"Contains"}]""").Default.ShouldBeNull();
    }

    [Fact]
    public void Without_a_context_no_default_is_resolved()
    {
        ReportBrowseService.ToParameter(Single("""[{"name":"D","type":"date","label":"Day","default":"today"}]"""), null).Default.ShouldBeNull();
    }

    [Fact]
    public void The_help_text_is_kept_and_a_blank_one_is_dropped()
    {
        Map("""[{"name":"S","type":"text","label":"Contains","helpText":"Part of the name."}]""").HelpText.ShouldBe("Part of the name.");
        Map("""[{"name":"S","type":"text","label":"Contains","helpText":"  "}]""").HelpText.ShouldBeNull();
    }

    [Fact]
    public void No_member_of_the_parameter_or_the_definition_can_carry_sql()
    {
        foreach (var type in new[] { typeof(RunnableParameter), typeof(RunnableOption), typeof(RunnableReportDefinition) })
            type.GetProperties().Select(p => p.Name).ShouldNotContain(n => n.Contains("Sql", StringComparison.OrdinalIgnoreCase) || n.Contains("Hash", StringComparison.OrdinalIgnoreCase));
    }
}
