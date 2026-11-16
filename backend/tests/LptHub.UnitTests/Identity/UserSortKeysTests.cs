using LptHub.Identity.Application;
using Shouldly;

namespace LptHub.UnitTests.Identity;

/// <summary>The sort keys of the users list (whitelisted): the person fields of issue #1394 are keys too, the address is case-insensitive and anything else is refused.</summary>
public class UserSortKeysTests
{
    [Theory]
    [InlineData("title", "title")]
    [InlineData("OFFICE", "office")]
    [InlineData("employmentStatus", "employmentStatus")]
    [InlineData("EmploymentStatus", "employmentStatus")]
    [InlineData("firstName", "firstName")]
    [InlineData("LASTSEEN", "lastSeen")]
    public void A_known_key_comes_back_as_written_in_the_catalogue(string input, string expected) =>
        UserSortKeys.Canonical(input).ShouldBe(expected);

    [Theory]
    [InlineData("status")]
    [InlineData("industryJoinDate")]
    [InlineData("")]
    [InlineData(null)]
    public void An_unknown_key_is_refused(string? input) => UserSortKeys.Canonical(input).ShouldBeNull();
}
