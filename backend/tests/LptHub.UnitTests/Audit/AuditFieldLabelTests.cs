using LptHub.Audit.Application;
using Shouldly;

namespace LptHub.UnitTests.Audit;

/// <summary>#1311: audit field labels keep acronyms in capitals, the rest stays sentence case.</summary>
public class AuditFieldLabelTests
{
    [Theory]
    [InlineData("DmsPath", "DMS Path")]
    [InlineData("DfsPath", "DFS Path")]
    [InlineData("AiAllowed", "AI Allowed")]
    [InlineData("ClientNumber", "Client number")]
    [InlineData("form:billing_code", "Billing code")]
    [InlineData("Name", "Name")]
    [InlineData(null, "Field")]
    public void Field_labels(string? key, string expected) => AuditSummaryComposer.FieldLabel(key).ShouldBe(expected);

    [Fact]
    public void A_path_change_reads_with_capitals_in_the_summary()
    {
        var text = AuditSummaryComposer.Compose("FIELD_CHANGED", "DmsPath", @"\\fs01\a", @"\\fs01\b", null, false);

        text.ShouldStartWith("DMS Path changed from ");
    }
}
