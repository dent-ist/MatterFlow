using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkflowEngine.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.WorkflowEngine;

/// <summary>Normalisation and validation of free-form step tags.</summary>
public class StepTagRulesTests
{
    [Theory]
    [InlineData("Relativity", "Relativity", "relativity")]
    [InlineData("  Relativity  ", "Relativity", "relativity")]
    [InlineData("Data   load  check", "Data load check", "data load check")]
    [InlineData("QC", "QC", "qc")]
    [InlineData("Über-Prüfung", "Über-Prüfung", "über-prüfung")]
    public void Normalize_trims_collapses_whitespace_and_lower_cases_the_key(string raw, string name, string key)
    {
        var tag = StepTagRules.Normalize(raw);

        tag.IsSuccess.ShouldBeTrue();
        tag.Value.Name.ShouldBe(name);
        tag.Value.Key.ShouldBe(key);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("a\u0000b")]
    [InlineData("a\tb")]
    [InlineData("a\nb")]
    [InlineData("a​b")]
    public void Empty_tags_and_control_characters_are_invalid(string? raw)
    {
        var tag = StepTagRules.Normalize(raw);

        tag.IsFailure.ShouldBeTrue();
        tag.Error!.Code.ShouldBe(ErrorCodes.TagInvalid);
        tag.Error.FieldErrors!["tags"][0].Code.ShouldBe("TAG_INVALID");
    }

    [Fact]
    public void The_length_limit_is_40_characters_after_normalising()
    {
        StepTagRules.Normalize(new string('a', 40)).IsSuccess.ShouldBeTrue();
        StepTagRules.Normalize("  " + new string('a', 40) + "  ").IsSuccess.ShouldBeTrue();
        StepTagRules.Normalize(new string('a', 41)).Error!.Code.ShouldBe(ErrorCodes.TagTooLong);
        StepTagRules.Normalize(new string('a', 20) + "      " + new string('b', 20)).Error!.Code.ShouldBe(ErrorCodes.TagTooLong); // 41 once collapsed
    }

    [Fact]
    public void NormalizeAll_drops_duplicates_ignoring_case_keeping_the_first_spelling_and_the_order()
    {
        var tags = StepTagRules.NormalizeAll(["Relativity", "processing", "RELATIVITY", " Processing ", "QC"]);

        tags.Value.Select(t => t.Name).ShouldBe(["Relativity", "processing", "QC"]);
    }

    [Fact]
    public void At_most_20_distinct_tags_per_step()
    {
        var twenty = Enumerable.Range(1, 20).Select(i => "t" + i).ToList();
        StepTagRules.NormalizeAll(twenty).IsSuccess.ShouldBeTrue();
        StepTagRules.NormalizeAll([.. twenty, "T1"]).IsSuccess.ShouldBeTrue(); // a duplicate does not count
        StepTagRules.NormalizeAll([.. twenty, "extra"]).Error!.Code.ShouldBe(ErrorCodes.TooManyTags);
    }

    [Fact]
    public void One_invalid_tag_fails_the_whole_list()
    {
        StepTagRules.NormalizeAll(["ok", "  ", "fine"]).Error!.Code.ShouldBe(ErrorCodes.TagInvalid);
        StepTagRules.NormalizeAll([]).Value.ShouldBeEmpty();
    }
}
