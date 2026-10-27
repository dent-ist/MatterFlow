using MatterFlow.Configuration.Domain.Settings;
using MatterFlow.SharedKernel.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Configuration.Settings;

public class BrandingNameTests
{
    [Theory]
    [InlineData("MatterFlow", "MatterFlow")]
    [InlineData("  Smith & Co  ", "Smith & Co")]
    [InlineData("Smith     Co", "Smith Co")]
    [InlineData("Kanzlei Müller é", "Kanzlei Müller é")]
    [InlineData("A", "A")]
    public void A_good_name_is_trimmed_and_whitespace_collapsed(string input, string expected) =>
        BrandingName.Normalize(input).Value.ShouldBe(expected);

    [Fact]
    public void Forty_characters_pass_and_forty_one_do_not()
    {
        BrandingName.Normalize(new string('a', 40)).IsSuccess.ShouldBeTrue();
        var tooLong = BrandingName.Normalize(new string('a', 41));
        tooLong.Error!.Code.ShouldBe(ErrorCodes.BrandingNameTooLong);
        tooLong.Error.Type.ShouldBe(ErrorType.Validation);
        tooLong.Error.FieldErrors!.ShouldContainKey("appName");
    }

    [Fact]
    public void The_length_is_counted_after_the_whitespace_is_collapsed() =>
        BrandingName.Normalize("  " + new string('a', 40) + "   ").IsSuccess.ShouldBeTrue();

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("  ")]
    public void An_empty_name_is_required(string? input) =>
        BrandingName.Normalize(input).Error!.Code.ShouldBe(ErrorCodes.BrandingNameRequired);

    [Theory]
    [InlineData("<b>x</b>")]
    [InlineData("a > b")]
    [InlineData("Tab\there")]
    [InlineData("New\nline")]
    [InlineData("nul\0l")]
    [InlineData("rtl ‮ override")]
    [InlineData("mark‎")]
    [InlineData("isolate ⁦ x")]
    [InlineData("zero​width")]
    [InlineData("bom﻿")]
    [InlineData("lone \uD800 surrogate")]
    [InlineData("private  use")]
    public void Markup_control_and_direction_characters_are_refused(string input) =>
        BrandingName.Normalize(input).Error!.Code.ShouldBe(ErrorCodes.BrandingNameInvalidChars);

    [Fact]
    public void An_emoji_pair_is_allowed() => BrandingName.Normalize("Firm \U0001F600").IsSuccess.ShouldBeTrue();
}
