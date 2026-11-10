using LptHub.Organization.Application;
using LptHub.SharedKernel.Results;
using Shouldly;

namespace LptHub.UnitTests.Organization;

/// <summary>The input rules of the matter fields (epic #1298, UI spec section 3.3): paths, team names and e-mail addresses.</summary>
public class MatterFieldRulesTests
{
    [Theory]
    [InlineData(@"\\fs01\matters\1234\Acme v. Beta\")]
    [InlineData(@"\\fs01\share")]
    [InlineData(@"\\fs-01.corp_net\dms share\a b\c")]
    [InlineData(@"  \\fs01\share\folder  ")]
    [InlineData("https://dms.example.com/matters/1234/0056")]
    [InlineData("HTTP://host:8080/x?y=1#z")]
    [InlineData("http://10.0.0.5/path")]
    public void Accepted_paths_are_returned_trimmed(string input)
    {
        var result = MatterFieldRules.CleanPath(input, "dmsPath");

        result.IsSuccess.ShouldBeTrue();
        result.Value.ShouldBe(input.Trim());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_blank_path_clears_the_field(string? input)
    {
        var result = MatterFieldRules.CleanPath(input, "dfsPath");

        result.IsSuccess.ShouldBeTrue();
        result.Value.ShouldBeNull();
    }

    [Theory]
    [InlineData(@"C:\Matters\1234")]
    [InlineData(@"z:\share")]
    [InlineData("D:/x")]
    public void Drive_letter_paths_are_refused_with_the_drive_message(string input)
    {
        var error = MatterFieldRules.CleanPath(input, "dmsPath").Error!;

        error.Code.ShouldBe(ErrorCodes.InvalidPath);
        error.Message.ShouldBe(MatterFieldRules.DriveLetterMessage);
        error.FieldErrors!["dmsPath"][0].Code.ShouldBe(MatterFieldRules.PathDriveLetter);
    }

    [Theory]
    [InlineData("https://user:pw@host/x")]
    [InlineData("http://user@host/x")]
    public void Credentials_in_a_web_address_are_refused(string input)
    {
        var error = MatterFieldRules.CleanPath(input, "dfsPath").Error!;

        error.Code.ShouldBe(ErrorCodes.InvalidPath);
        error.Message.ShouldBe(MatterFieldRules.CredentialsMessage);
    }

    [Theory]
    [InlineData(@"\\fs01")]
    [InlineData(@"\\fs01\")]
    [InlineData("//fs01/share")]
    [InlineData(@"\fs01\share")]
    [InlineData("ftp://host/x")]
    [InlineData("file:///x")]
    [InlineData("www.example.com")]
    [InlineData("https://")]
    [InlineData("javascript:alert(1)")]
    [InlineData(@"\\?\C:\x")]
    [InlineData(@"\\fs 01\share")]
    [InlineData("\\\\fs01\\share\nx")]
    [InlineData(@"\\fs01\sha:re")]
    [InlineData(@"\\fs01\share\a*b")]
    [InlineData(@"\\fs01\share\\folder")]
    [InlineData(@"\\fs01\share\folder\\")]
    [InlineData("https://exa mple.com/x")]
    public void Anything_else_is_refused_with_the_format_message(string input)
    {
        var error = MatterFieldRules.CleanPath(input, "dmsPath").Error!;

        error.Code.ShouldBe(ErrorCodes.InvalidPath);
        error.Message.ShouldBe(MatterFieldRules.FormatMessage);
        error.FieldErrors!["dmsPath"][0].Code.ShouldBe(MatterFieldRules.PathFormat);
    }

    [Fact]
    public void A_path_over_1000_characters_is_refused_and_exactly_1000_is_accepted()
    {
        MatterFieldRules.CleanPath("https://h/" + new string('a', 990), "dmsPath").IsSuccess.ShouldBeTrue();

        var error = MatterFieldRules.CleanPath("https://h/" + new string('a', 991), "dmsPath").Error!;
        error.Code.ShouldBe(ErrorCodes.InvalidPath);
        error.FieldErrors!["dmsPath"][0].Code.ShouldBe(MatterFieldRules.PathTooLong);
    }

    [Theory]
    [InlineData("ann@firm.com")]
    [InlineData("Ann.Lee+matter@sub.vendor.example")]
    [InlineData("  ben@vendor.io  ")]
    public void Valid_emails_are_trimmed_and_kept_as_typed(string input)
    {
        var result = MatterFieldRules.CleanEmail(input);

        result.IsSuccess.ShouldBeTrue();
        result.Value.ShouldBe(input.Trim());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("ann")]
    [InlineData("ann@firm")]
    [InlineData("@firm.com")]
    [InlineData("ann@@firm.com")]
    [InlineData("ann lee@firm.com")]
    [InlineData("Ann <ann@firm.com>")]
    [InlineData("a@b.com, c@d.com")]
    [InlineData("ann..lee@firm.com")]
    [InlineData(".ann@firm.com")]
    public void Invalid_emails_are_refused(string input)
    {
        var error = MatterFieldRules.CleanEmail(input).Error!;

        error.Code.ShouldBe(ErrorCodes.InvalidEmail);
        error.FieldErrors!.ShouldContainKey("email");
    }

    [Fact]
    public void An_email_over_254_characters_is_refused()
    {
        var email = new string('a', 250) + "@b.com";

        MatterFieldRules.CleanEmail(email).Error!.Code.ShouldBe(ErrorCodes.InvalidEmail);
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("  ", false)]
    [InlineData("Ann Lee", true)]
    [InlineData("  Ann Lee  ", true)]
    [InlineData("Ann\nLee", false)]
    public void Names_are_required_trimmed_and_free_of_control_characters(string input, bool valid)
    {
        var result = MatterFieldRules.CleanName(input);

        result.IsSuccess.ShouldBe(valid);
        if (valid)
            result.Value.ShouldBe(input.Trim());
    }

    [Fact]
    public void A_name_over_200_characters_is_refused()
    {
        MatterFieldRules.CleanName(new string('n', 201)).IsFailure.ShouldBeTrue();
        MatterFieldRules.CleanName(new string('n', 200)).IsSuccess.ShouldBeTrue();
    }
}
