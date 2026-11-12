using LptHub.Identity.People;
using Shouldly;

namespace LptHub.UnitTests.Identity;

public class PersonNamesTests
{
    [Theory]
    [InlineData("Jamal Okafor", "Jamal", "Okafor")]
    [InlineData("Mary Ann Smith", "Mary Ann", "Smith")]
    [InlineData("  Laura   Whitfield ", "Laura", "Whitfield")]
    [InlineData("Cher", "Cher", "")]
    [InlineData("", "", "")]
    [InlineData(null, "", "")]
    public void Display_name_is_split_at_the_last_space(string? displayName, string first, string last) =>
        PersonNameSplitter.Split(displayName).ShouldBe((first, last));

    [Fact]
    public void Same_email_wins_over_a_different_name() =>
        PersonSimilarity.Match("Zed", "Other", "Laura@Firm.example", "Laura", "Whitfield", " laura@firm.example ").ShouldBe(PersonSimilarity.SameEmail);

    [Theory]
    [InlineData("Laura", "Whitfield", PersonSimilarity.SameName)]
    [InlineData("laura", "WHITFIELD", PersonSimilarity.SameName)]
    [InlineData("Whitfield", "Laura", PersonSimilarity.SameName)]
    [InlineData("Laura", "Whitfeld", PersonSimilarity.SimilarName)]
    [InlineData("Lara", "Whitfield", PersonSimilarity.SimilarName)]
    [InlineData("Laura", "Smith", null)]
    [InlineData("Jean", "Whitfield", null)]
    public void Names_are_compared_without_case_and_with_a_typo_allowance(string first, string last, string? expected) =>
        PersonSimilarity.Match(first, last, null, "Laura", "Whitfield", null).ShouldBe(expected);

    [Fact]
    public void Accents_do_not_matter() =>
        PersonSimilarity.Match("José", "García", null, "Jose", "Garcia", null).ShouldBe(PersonSimilarity.SameName);

    [Fact]
    public void Nothing_typed_matches_nothing()
    {
        PersonSimilarity.Match(null, null, null, "Laura", "Whitfield", null).ShouldBeNull();
        PersonSimilarity.Match("", "", "", "", "", null).ShouldBeNull();
    }

    [Fact]
    public void A_short_typed_name_needs_an_exact_match() =>
        PersonSimilarity.Match("Al", null, null, "Bo", "Li", null).ShouldBeNull();
}
