using System.Text.Json;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Domain.Parameters;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>Sample values for a preview, per type (spec 6.6; issue #709).</summary>
public class ReportSamplesTests
{
    private static readonly BuiltInContext Ctx = new(7, "Ann", new DateOnly(2026, 10, 22), new DateTime(2026, 10, 22, 14, 0, 0, DateTimeKind.Utc), [3], 3, -240);

    private static ReportParameterDefinition Def(string name, ReportParameterType type, Func<ReportParameterDefinition, ReportParameterDefinition>? c = null)
    {
        var d = new ReportParameterDefinition { Name = name, Type = type, IsRequired = true };
        return c is null ? d : c(d);
    }

    private static BindResult Bind(ReportParameterDefinition d, Dictionary<string, JsonElement>? supplied = null)
    {
        var values = ReportSamples.Complete([d], supplied ?? [], Ctx);
        return ParameterBinder.Bind([d], values, Ctx, null);
    }

    [Theory]
    [InlineData(ReportParameterType.Number)]
    [InlineData(ReportParameterType.Date)]
    [InlineData(ReportParameterType.Text)]
    [InlineData(ReportParameterType.YesNo)]
    [InlineData(ReportParameterType.DateRange)]
    [InlineData(ReportParameterType.Lookup)]
    public void Every_required_type_gets_a_sample_that_binds(ReportParameterType type)
    {
        var r = Bind(Def("X", type, d => d with { LookupKind = LookupKind.Matter }));

        r.Errors.ShouldBeEmpty();
        r.Parameters.ShouldNotBeEmpty();
        r.Parameters.ShouldAllBe(p => !p.IsNull || type == ReportParameterType.DateRange);
    }

    [Fact]
    public void Choices_sample_the_first_option_and_lists_a_list_of_it()
    {
        var options = new ParameterOption[] { new("first", "First"), new("second", "Second") };

        Bind(Def("S", ReportParameterType.Single, d => d with { Options = options })).Parameters.Single().Value.ShouldBe("first");
        Bind(Def("M", ReportParameterType.Multi, d => d with { Options = options })).Parameters.Single().Value.ShouldBe("[\"first\"]");
        Bind(Def("L", ReportParameterType.Lookup, d => d with { LookupKind = LookupKind.Pod, LookupMulti = true })).Parameters.Single().Value.ShouldBe("[1]");
    }

    [Fact]
    public void A_number_sample_respects_the_minimum_and_text_the_length()
    {
        Bind(Def("N", ReportParameterType.Number, d => d with { Min = 5, Max = 9 })).Parameters.Single().Value.ShouldBe(5m);
        Bind(Def("N", ReportParameterType.Number, d => d with { Max = -3 })).Parameters.Single().Value.ShouldBe(-3m);
        Bind(Def("T", ReportParameterType.Text, d => d with { MaxLength = 3 })).Parameters.Single().Value.ShouldBe("sam");
    }

    [Fact]
    public void Dates_use_today_and_the_range_this_month_so_far()
    {
        ((DateTime)Bind(Def("D", ReportParameterType.Date)).Parameters.Single().Value!).ShouldBe(new DateTime(2026, 10, 22));
        var range = Bind(Def("P", ReportParameterType.DateRange)).Parameters;
        ((DateTime)range[0].Value!).ShouldBe(new DateTime(2026, 10, 1));
        ((DateTime)range[1].Value!).ShouldBe(new DateTime(2026, 10, 22));
    }

    [Fact]
    public void Typed_values_and_defaults_win_over_samples_and_optional_parameters_stay_empty()
    {
        var withDefault = Def("D", ReportParameterType.Number, d => d with { Default = JsonDocument.Parse("42").RootElement.Clone() });
        var optional = Def("O", ReportParameterType.Text, d => d with { IsRequired = false });
        var typed = new Dictionary<string, JsonElement> { ["N"] = JsonDocument.Parse("7").RootElement.Clone() };

        Bind(withDefault).Parameters.Single().Value.ShouldBe(42m);
        Bind(optional).Parameters.Single().IsNull.ShouldBeTrue();
        Bind(Def("N", ReportParameterType.Number), typed).Parameters.Single().Value.ShouldBe(7m);
    }

    [Fact]
    public void Canonical_parameter_json_ignores_property_order_and_spacing()
    {
        var a = "[{\"name\":\"X\",\"type\":\"text\",\"label\":\"X\"}]";
        var b = "[ { \"label\": \"X\", \"type\": \"text\", \"name\": \"X\" } ]";

        ReportAuthoringService.Canonical(a).ShouldBe(ReportAuthoringService.Canonical(b));
        ReportAuthoringService.Canonical(a).ShouldNotBe(ReportAuthoringService.Canonical("[{\"name\":\"X\",\"type\":\"number\",\"label\":\"X\"}]"));
        ReportAuthoringService.Canonical("not json").ShouldBe("not json");
    }
}
