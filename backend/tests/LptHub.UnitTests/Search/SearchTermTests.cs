using MatterFlow.Search.Application.Queries;
using Shouldly;

namespace MatterFlow.UnitTests.Search;

/// <summary>Input handling of search (architecture 14, addendum B): length, LIKE escaping and number normalization, without a database.</summary>
public class SearchTermTests
{
    private static SearchTerm Parse(string input) => SearchTerm.Parse(input).Value;

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("a")]
    [InlineData(" a ")]
    public void Input_shorter_than_two_characters_is_rejected(string? input)
    {
        var result = SearchTerm.Parse(input);
        result.IsFailure.ShouldBeTrue();
        result.Error!.FieldErrors!["q"][0].Code.ShouldBe("QUERY_TOO_SHORT");
    }

    [Fact]
    public void A_single_digit_is_a_valid_number_search_and_overlong_input_is_rejected()
    {
        SearchTerm.Parse("7").IsSuccess.ShouldBeTrue();
        SearchTerm.Parse(new string('x', SearchTerm.MaxLength)).IsSuccess.ShouldBeTrue();
        SearchTerm.Parse(new string('x', SearchTerm.MaxLength + 1)).Error!.FieldErrors!["q"][0].Code.ShouldBe("QUERY_TOO_LONG");
    }

    [Theory]
    [InlineData("abc", "abc%", "%abc%")]
    [InlineData("100%", @"100\%%", @"%100\%%")]
    [InlineData("a_b", @"a\_b%", @"%a\_b%")]
    [InlineData("[x]", @"\[x]%", @"%\[x]%")]
    [InlineData(@"a\b", @"a\\b%", @"%a\\b%")]
    [InlineData("%%", @"\%\%%", @"%\%\%%")]
    public void Wildcards_in_the_input_are_escaped_so_they_match_literally(string input, string prefix, string contains)
    {
        var term = Parse(input);
        term.Prefix.ShouldBe(prefix);
        term.Contains.ShouldBe(contains);
        term.WordStart.ShouldBe("%[ ._/(-]" + prefix);
        term.Text.ShouldBe(input);
    }

    [Fact]
    public void Input_is_trimmed_and_the_lowered_form_is_lower_case()
    {
        var term = Parse("  ACme_X ");
        term.Text.ShouldBe("ACme_X");
        term.Lowered.Text.ShouldBe("acme_x");
        term.Lowered.Prefix.ShouldBe(@"acme\_x%");
    }

    [Theory]
    [InlineData("343", "00343")]
    [InlineData("00343", "00343")]
    [InlineData("0343", "00343")]
    [InlineData("7", "00007")]
    [InlineData("99999", "99999")]
    public void A_number_is_normalized_to_five_digits(string input, string normalized)
    {
        var term = Parse(input);
        term.HasNumber.ShouldBeTrue();
        term.Number.ShouldBe(normalized);
        term.Normalized.ShouldBe(normalized);
    }

    [Theory]
    [InlineData("000")]
    [InlineData("123456")]
    [InlineData("abc")]
    [InlineData("34a")]
    public void Input_that_is_not_a_number_has_no_number(string input)
    {
        var term = Parse(input);
        term.HasNumber.ShouldBeFalse();
        term.Number.ShouldBe(SearchTerm.Never);
    }

    [Theory]
    [InlineData("34", new[] { "34%", "034%", "0034%", "00034%", "#" })]
    [InlineData("343", new[] { "343%", "0343%", "00343%", "#", "#" })]
    [InlineData("00343", new[] { "00343%", "#", "#", "#", "#" })]
    [InlineData("003", new[] { "003%", "#", "#", "#", "#" })]
    [InlineData("12345", new[] { "12345%", "#", "#", "#", "#" })]
    public void Typed_digits_become_number_prefix_patterns_with_a_fixed_number_of_slots(string digits, string[] expected)
    {
        Parse(digits).NumberPrefixes.ShouldBe(expected);
    }

    [Theory]
    [InlineData("343-12", "00343", "00343-00012")]
    [InlineData("00343-00012", "00343", "00343-00012")]
    [InlineData("343-00012", "00343", "00343-00012")]
    [InlineData("0343 - 12", "00343", "00343-00012")]
    [InlineData("2-1", "00002", "00002-00001")]
    public void A_combined_number_resolves_to_the_matter_reference(string input, string client, string reference)
    {
        var term = Parse(input);
        term.IsPair.ShouldBeTrue();
        term.PairClient.ShouldBe(client);
        term.PairRef.ShouldBe(reference);
        term.Normalized.ShouldBe(reference);
        term.PairPrefixes.ShouldContain(reference + "%");
    }

    [Fact]
    public void A_partly_typed_matter_number_matches_by_prefix_after_the_client_number()
    {
        Parse("343-1").PairPrefixes.ShouldBe(["00343-1%", "00343-01%", "00343-001%", "00343-0001%", "00343-00001%"]);
        var open = Parse("343-");
        open.PairRef.ShouldBe(SearchTerm.Never);
        open.PairPrefixes[0].ShouldBe("00343-%");
        open.Normalized.ShouldBe("00343-");
    }

    [Theory]
    [InlineData("1042", "TSK-1042", "TSK-1042%")]
    [InlineData("TSK-1042", "TSK-1042", "TSK-1042%")]
    [InlineData("tsk-1042", "TSK-1042", "TSK-1042%")]
    public void A_task_number_is_found_with_or_without_the_prefix(string input, string number, string prefix)
    {
        var term = Parse(input);
        term.TaskNumber.ShouldBe(number);
        term.TaskPrefix.ShouldBe(prefix);
    }

    [Fact]
    public void A_task_number_prefix_alone_matches_by_prefix_and_text_has_no_numbers()
    {
        var partial = Parse("tsk-");
        partial.TaskNumber.ShouldBe(SearchTerm.Never);
        partial.TaskPrefix.ShouldBe("TSK-%");

        var text = Parse("merger review");
        text.Normalized.ShouldBeNull();
        text.PairClient.ShouldBe(SearchTerm.Never);
        text.TaskNumber.ShouldBe(SearchTerm.Never);
        text.TaskPrefix.ShouldBe(SearchTerm.Never);
        text.NumberPrefixes.ShouldAllBe(p => p == SearchTerm.Never);
    }
}
