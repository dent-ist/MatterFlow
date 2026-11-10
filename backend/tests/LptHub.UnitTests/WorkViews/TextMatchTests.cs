using MatterFlow.WorkViews.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.WorkViews;

/// <summary>The binary-collation "contains" the queue filters use: lower-cased term, LIKE wildcards matched literally.</summary>
public class TextMatchTests
{
    [Theory]
    [InlineData("falcon", "%falcon%")]
    [InlineData("Falcon Harbor", "%falcon harbor%")]
    [InlineData("TSK-1042", "%tsk-1042%")]
    [InlineData("100%", "%100\\%%")]
    [InlineData("a_b", "%a\\_b%")]
    [InlineData("[x]", "%\\[x]%")]
    [InlineData("back\\slash", "%back\\\\slash%")]
    public void The_pattern_is_lower_case_with_wildcards_escaped(string term, string pattern) =>
        TextMatch.ContainsPattern(term).ShouldBe(pattern);

    [Fact]
    public void The_collation_and_escape_match_the_search_module()
    {
        TextMatch.Collation.ShouldBe("Latin1_General_100_BIN2");
        TextMatch.Escape.ShouldBe("\\");
    }
}
