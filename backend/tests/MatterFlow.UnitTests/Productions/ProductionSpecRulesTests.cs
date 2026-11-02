using MatterFlow.Productions.Application;
using MatterFlow.Productions.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.Productions;

/// <summary>The duplicate and retire rules of production specs (MD-09).</summary>
public sealed class ProductionSpecRulesTests
{
    [Fact]
    public void A_copy_is_named_copy_of_the_source()
    {
        ProductionSpecRules.CopyName("ESI protocol standard", []).ShouldBe("Copy of ESI protocol standard");
    }

    [Fact]
    public void A_copy_name_that_is_taken_gets_a_number_without_regard_to_case()
    {
        var taken = new[] { "Copy of ESI", "COPY OF ESI (2)" };

        ProductionSpecRules.CopyName("ESI", taken).ShouldBe("Copy of ESI (3)");
    }

    [Fact]
    public void A_long_source_name_is_shortened_not_the_number()
    {
        var source = new string('x', 200);
        var first = ProductionSpecRules.CopyName(source, []);
        var second = ProductionSpecRules.CopyName(source, [first]);

        first.Length.ShouldBe(200);
        second.Length.ShouldBe(200);
        second.ShouldEndWith(" (2)");
        second.ShouldNotBe(first);
    }

    [Theory]
    [InlineData(SpecStatus.Active, 5, null, true)]
    [InlineData(SpecStatus.Active, 5, 9, true)]
    [InlineData(SpecStatus.Retired, 5, null, false)]
    [InlineData(SpecStatus.Retired, 5, 9, false)]
    [InlineData(SpecStatus.Retired, 5, 5, true)]
    public void A_retired_spec_can_stay_on_a_production_but_not_be_chosen(string status, int specId, int? current, bool allowed)
    {
        ProductionSpecRules.MayUse(status, specId, current).ShouldBe(allowed);
    }
}
