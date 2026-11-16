using LptHub.Integrations.Application;
using LptHub.Integrations.Contracts;
using LptHub.Integrations.Domain;
using Shouldly;

namespace LptHub.UnitTests.Integrations;

public class IntegrationRulesTests
{
    [Theory]
    [InlineData(false, true, "https://x", "api://a/.default", null, IntegrationStatuses.Disabled)]
    [InlineData(false, false, null, null, null, IntegrationStatuses.Disabled)]
    [InlineData(true, false, "https://x", "api://a/.default", null, IntegrationStatuses.NotSetUp)]
    [InlineData(true, true, null, "api://a/.default", null, IntegrationStatuses.NotSetUp)]
    [InlineData(true, true, "https://x", null, null, IntegrationStatuses.NotSetUp)]
    [InlineData(true, true, "https://x", "api://a/.default", null, IntegrationStatuses.NotTested)]
    [InlineData(true, true, "https://x", "api://a/.default", TestOutcomes.Ok, IntegrationStatuses.Connected)]
    [InlineData(true, true, "https://x", "api://a/.default", TestOutcomes.ScopeRefused, IntegrationStatuses.Failed)]
    [InlineData(true, true, "https://x", "api://a/.default", TestOutcomes.ApiUnreachable, IntegrationStatuses.Failed)]
    public void Status_follows_the_rule_disabled_then_not_set_up_then_the_last_test(bool enabled, bool connection, string? url, string? scope, string? last, string expected)
    {
        IntegrationSupport.StatusOf(enabled, connection, url, scope, last).ShouldBe(expected);
    }

    [Theory]
    [InlineData(TestOutcomes.Ok, new[] { "PASSED", "PASSED", "PASSED", "PASSED" })]
    [InlineData(TestOutcomes.NotSetUp, new[] { "FAILED", "NOT_REACHED", "NOT_REACHED", "NOT_REACHED" })]
    [InlineData(TestOutcomes.EntraUnreachable, new[] { "FAILED", "NOT_REACHED", "NOT_REACHED", "NOT_REACHED" })]
    [InlineData(TestOutcomes.CredentialsRefused, new[] { "PASSED", "FAILED", "NOT_REACHED", "NOT_REACHED" })]
    [InlineData(TestOutcomes.SecretExpired, new[] { "PASSED", "FAILED", "NOT_REACHED", "NOT_REACHED" })]
    [InlineData(TestOutcomes.ScopeRefused, new[] { "PASSED", "PASSED", "FAILED", "NOT_REACHED" })]
    [InlineData(TestOutcomes.ApiUnreachable, new[] { "PASSED", "PASSED", "PASSED", "FAILED" })]
    [InlineData(TestOutcomes.ApiRefused, new[] { "PASSED", "PASSED", "PASSED", "FAILED" })]
    public void An_integration_test_has_four_steps_and_stops_at_the_failing_one(string outcome, string[] states)
    {
        IntegrationSupport.StepsOf(outcome, forIntegration: true).Select(s => s.State).ShouldBe(states);
    }

    [Fact]
    public void The_entra_test_has_two_steps()
    {
        IntegrationSupport.StepsOf(TestOutcomes.CredentialsRefused, forIntegration: false).Select(s => (s.Key, s.State)).ShouldBe([("ENTRA_REACHED", "PASSED"), ("CREDENTIALS_ACCEPTED", "FAILED")]);
    }

    [Theory]
    [InlineData("https://matters.example-firm.test/api/v1", true)]
    [InlineData("https://host", true)]
    [InlineData("http://matters.example-firm.test", false)]
    [InlineData("ftp://host", false)]
    [InlineData("https://", false)]
    [InlineData("https://user:pw@host/x", false)]
    [InlineData("https://host/x#frag", false)]
    [InlineData("matters.example-firm.test", false)]
    [InlineData("javascript:alert(1)", false)]
    public void A_base_url_must_be_an_https_address_without_credentials(string url, bool valid)
    {
        IntegrationService.IsHttpsAddress(url).ShouldBe(valid);
    }

    [Fact]
    public void Only_matter_lookup_and_ethical_wall_are_single()
    {
        IntegrationTypes.IsSingle(IntegrationTypes.MatterLookup).ShouldBeTrue();
        IntegrationTypes.IsSingle(IntegrationTypes.EthicalWall).ShouldBeTrue();
        IntegrationTypes.IsSingle(IntegrationTypes.Other).ShouldBeFalse();
        IntegrationTypes.IsValid("SOMETHING").ShouldBeFalse();
    }
}
