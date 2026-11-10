using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.ValueObjects;
using Shouldly;

namespace MatterFlow.UnitTests.SharedKernel;

public class BusinessNumberTests
{
    [Theory]
    [InlineData("343", "00343")]
    [InlineData(" 343 ", "00343")]
    [InlineData("1", "00001")]
    [InlineData("00343", "00343")]
    [InlineData("99999", "99999")]
    [InlineData("0001", "00001")]
    [InlineData("\t12\n", "00012")]
    public void Parse_normalizes_to_zero_padded_five_characters(string input, string expected)
    {
        var result = BusinessNumber.Parse(input);

        result.IsSuccess.ShouldBeTrue();
        result.Value.Value.ShouldBe(expected);
        result.Value.ToString().ShouldBe(expected);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("00")]
    [InlineData("00000")]
    [InlineData("123456")]
    [InlineData("000001")]
    [InlineData("abc")]
    [InlineData("12a")]
    [InlineData("1 2")]
    [InlineData("-1")]
    [InlineData("1.5")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("٣٤٣")] // Arabic-Indic digits are not ASCII
    public void Parse_rejects_invalid_input_with_INVALID_NUMBER_FORMAT(string? input)
    {
        var result = BusinessNumber.Parse(input);

        result.IsFailure.ShouldBeTrue();
        result.Error!.Code.ShouldBe(ErrorCodes.InvalidNumberFormat);
        result.Error.Type.ShouldBe(ErrorType.Validation);
        BusinessNumber.TryParse(input, out _).ShouldBeFalse();
    }

    [Fact]
    public void Equality_is_on_the_normalized_value()
    {
        var a = BusinessNumber.Parse("343").Value;
        var b = BusinessNumber.Parse(" 00343 ").Value;
        var c = BusinessNumber.Parse("344").Value;

        a.ShouldBe(b);
        a.GetHashCode().ShouldBe(b.GetHashCode());
        a.ShouldNotBe(c);
    }

    [Fact]
    public void FromStored_requires_the_normalized_form()
    {
        BusinessNumber.FromStored("00343").Value.ShouldBe("00343");
        Should.Throw<ArgumentException>(() => BusinessNumber.FromStored("343"));
    }
}
