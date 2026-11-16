using System.Net;
using LptHub.Integrations.Application;
using LptHub.Integrations.Domain;
using Shouldly;

namespace LptHub.UnitTests.Integrations;

public class EntraTokenClientTests
{
    private const string Secret = "S3cr3t~value~that~must~never~leak";
    private static readonly DateOnly Today = new(2026, 11, 16);

    private static (EntraTokenClient Client, ScriptedHandler Handler, CapturingLogger<EntraTokenClient> Log) Make()
    {
        var handler = new ScriptedHandler();
        var log = new CapturingLogger<EntraTokenClient>();
        return (new EntraTokenClient(new HandlerFactory(handler), TestOptions.Default(), log), handler, log);
    }

    private static Task<TokenAttempt> Request(EntraTokenClient c, DateOnly? expires = null) =>
        c.RequestAsync("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", Secret, "api://app/.default", expires, Today, CancellationToken.None);

    [Fact]
    public async Task Asks_the_tenant_token_address_with_the_integrations_scope()
    {
        var (client, handler, _) = Make();
        handler.Then(HttpStatusCode.OK, """{"access_token":"tok","expires_in":3599}""");

        var attempt = await Request(client);

        attempt.Succeeded.ShouldBeTrue();
        attempt.Token.ShouldBe("tok");
        attempt.ExpiresInSeconds.ShouldBe(3599);
        var sent = handler.Requests.Single();
        sent.Uri.ToString().ShouldBe("https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/oauth2/v2.0/token");
        sent.Body.ShouldContain("grant_type=client_credentials");
        sent.Body.ShouldContain("scope=api%3A%2F%2Fapp%2F.default");
        sent.Body.ShouldContain("client_id=22222222-2222-2222-2222-222222222222");
    }

    [Theory]
    [InlineData("""{"error":"invalid_client","error_codes":[7000215]}""", TestOutcomes.CredentialsRefused)]
    [InlineData("""{"error":"invalid_client","error_codes":[7000222]}""", TestOutcomes.SecretExpired)]
    [InlineData("""{"error":"invalid_scope","error_codes":[70011]}""", TestOutcomes.ScopeRefused)]
    [InlineData("""{"error":"invalid_request","error_codes":[500011]}""", TestOutcomes.ScopeRefused)]
    [InlineData("""{"error":"unauthorized_client","error_codes":[700016]}""", TestOutcomes.CredentialsRefused)]
    [InlineData("not json at all", TestOutcomes.CredentialsRefused)]
    public async Task A_refusal_is_mapped_to_a_plain_outcome(string body, string expected)
    {
        var (client, handler, _) = Make();
        handler.Then(HttpStatusCode.BadRequest, body);

        (await Request(client)).Outcome.ShouldBe(expected);
    }

    [Fact]
    public async Task A_refused_client_with_a_past_expiry_date_reads_as_expired()
    {
        var (client, handler, _) = Make();
        handler.Then(HttpStatusCode.Unauthorized, """{"error":"invalid_client","error_codes":[7000215]}""");

        (await Request(client, expires: Today.AddDays(-1))).Outcome.ShouldBe(TestOutcomes.SecretExpired);
    }

    [Fact]
    public async Task A_server_error_a_network_error_and_a_timeout_are_not_reachable()
    {
        var (client, handler, _) = Make();
        handler.Then(HttpStatusCode.ServiceUnavailable)
            .ThenThrow(new HttpRequestException("dns"))
            .ThenThrow(new TaskCanceledException("timeout"))
            .Then(HttpStatusCode.OK, "<html>captive portal</html>");

        (await Request(client)).Outcome.ShouldBe(TestOutcomes.EntraUnreachable);
        (await Request(client)).Outcome.ShouldBe(TestOutcomes.EntraUnreachable);
        (await Request(client)).Outcome.ShouldBe(TestOutcomes.EntraUnreachable);
        (await Request(client)).Outcome.ShouldBe(TestOutcomes.EntraUnreachable);
    }

    [Fact]
    public async Task The_caller_cancelling_is_not_a_timeout()
    {
        var (client, handler, _) = Make();
        handler.ThenThrow(new TaskCanceledException("cancelled"));
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Should.ThrowAsync<OperationCanceledException>(() => client.RequestAsync("t", "c", Secret, "s", null, Today, cts.Token));
    }

    [Fact]
    public async Task Neither_the_secret_nor_the_token_reaches_a_log_or_a_printed_result()
    {
        var (client, handler, log) = Make();
        handler.Then(HttpStatusCode.OK, """{"access_token":"the-access-token-value","expires_in":3599}""")
            .Then(HttpStatusCode.Unauthorized, """{"error":"invalid_client","error_description":"AADSTS7000215: Invalid client secret provided","error_codes":[7000215]}""");

        var ok = await Request(client);
        var refused = await Request(client);

        string.Join('\n', log.Lines).ShouldNotContain(Secret);
        string.Join('\n', log.Lines).ShouldNotContain("the-access-token-value");
        string.Join('\n', log.Lines).ShouldNotContain("AADSTS");
        ok.ToString().ShouldNotContain("the-access-token-value");
        refused.ToString().ShouldNotContain("AADSTS");
    }
}
