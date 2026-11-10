using MatterFlow.Search.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.Search;

/// <summary>Relevance tiers (exact, start, word start, inside): the C# rule that the SQL tiers mirror.</summary>
public class SearchRankingTests
{
    [Theory]
    [InlineData("Orbit", "orbit", SearchRanking.Exact)]
    [InlineData("ORBIT", "orbit", SearchRanking.Exact)]
    [InlineData("Orbit Holdings", "orbit", SearchRanking.StartsWith)]
    [InlineData("Big Orbit Group", "orbit", SearchRanking.WordStart)]
    [InlineData("Big-Orbit", "orbit", SearchRanking.WordStart)]
    [InlineData("Acme (Orbit)", "orbit", SearchRanking.WordStart)]
    [InlineData("files/orbit/x", "orbit", SearchRanking.WordStart)]
    [InlineData("Reorbital Ltd", "orbit", SearchRanking.Substring)]
    [InlineData("Reorbit Orbit", "orbit", SearchRanking.WordStart)]
    public void Text_matches_at_the_best_tier(string text, string term, int expected)
    {
        SearchRanking.RankText(text, term).ShouldBe(expected);
    }

    [Theory]
    [InlineData("Acme", "zzz")]
    [InlineData("", "a")]
    [InlineData(null, "a")]
    [InlineData("Acme", "")]
    public void No_match_has_no_rank(string? text, string term)
    {
        SearchRanking.RankText(text, term).ShouldBeNull();
    }

    [Fact]
    public void Tiers_sort_exact_then_start_then_word_start_then_inside_with_a_stable_tie_break()
    {
        var names = new[] { "Reorbital Ltd", "Big Orbit Group", "Orbit Holdings", "Orbit", "Another Orbit Co", "Orbit Alpha" };
        var ordered = names
            .Select(n => (Name: n, Rank: SearchRanking.RankText(n, "orbit")!.Value))
            .OrderBy(x => x.Rank).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .Select(x => x.Name)
            .ToList();

        ordered.ShouldBe(["Orbit", "Orbit Alpha", "Orbit Holdings", "Another Orbit Co", "Big Orbit Group", "Reorbital Ltd"]);
    }

    [Fact]
    public void The_best_of_several_columns_wins()
    {
        SearchRanking.Best(null, 3, 1, null).ShouldBe(1);
        SearchRanking.Best(null, null).ShouldBeNull();
        SearchRanking.Best(SearchRanking.RankText("xx orbit", "orbit"), SearchRanking.RankText("Orbit", "orbit")).ShouldBe(SearchRanking.Exact);
    }

    [Fact]
    public void Text_with_wildcard_characters_ranks_as_literal_text()
    {
        SearchRanking.RankText("Rate 100% [Final]_Set", "100%").ShouldBe(SearchRanking.WordStart);
        SearchRanking.RankText("Rate 100 Final", "100%").ShouldBeNull();
    }
}
