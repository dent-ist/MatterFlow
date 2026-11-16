using System.Net;
using LptHub.Integrations.Application;
using Shouldly;

namespace LptHub.UnitTests.Integrations;

public class MatterLookupClientTests
{
    private static ProvisionalMatterLookupClient Client(ScriptedHandler handler, Action<IntegrationsOptions>? change = null) =>
        new(new HandlerFactory(handler), TestOptions.Default(change), new CapturingLogger<ProvisionalMatterLookupClient>());

    [Fact]
    public async Task A_client_is_looked_up_with_the_bearer_token_on_the_provisional_path()
    {
        var handler = new ScriptedHandler().Then(HttpStatusCode.OK, """{"clientNumber":"343","clientName":"Acme Corp"}""");

        var answer = await Client(handler).FindAsync(new MatterLookupCall("https://matters.example.test/api/v1/", "tok", "00343", null), CancellationToken.None);

        answer.Kind.ShouldBe(MatterLookupAnswerKind.Found);
        answer.ClientName.ShouldBe("Acme Corp");
        answer.ClientNumber.ShouldBe("343");
        handler.Requests.Single().Uri.ToString().ShouldBe("https://matters.example.test/api/v1/clients/00343");
        handler.Requests.Single().Authorization.ShouldBe("Bearer tok");
    }

    [Fact]
    public async Task A_matter_is_looked_up_by_client_and_matter_number()
    {
        var handler = new ScriptedHandler().Then(HttpStatusCode.OK, """{"clientName":"Acme Corp","matterNumber":12,"matterName":"Merger Review"}""");

        var answer = await Client(handler).FindAsync(new MatterLookupCall("https://m.test/api", "tok", "00343", "00012"), CancellationToken.None);

        handler.Requests.Single().Uri.ToString().ShouldBe("https://m.test/api/matters/00343/00012");
        answer.Kind.ShouldBe(MatterLookupAnswerKind.Found);
        answer.MatterName.ShouldBe("Merger Review");
        answer.MatterNumber.ShouldBe("12");
    }

    [Fact]
    public async Task The_paths_and_field_names_come_from_the_options_so_the_real_contract_changes_one_place()
    {
        var handler = new ScriptedHandler().Then(HttpStatusCode.OK, """[{"cn":"Acme","mn":"Deal"}]""");

        var answer = await Client(handler, o =>
        {
            o.MatterLookup.MatterPath = "lookup?client={clientNumber}&matter={matterNumber}";
            o.MatterLookup.ClientNameField = "cn";
            o.MatterLookup.MatterNameField = "mn";
        }).FindAsync(new MatterLookupCall("https://m.test", "tok", "00343", "00012"), CancellationToken.None);

        handler.Requests.Single().Uri.Query.ShouldBe("?client=00343&matter=00012");
        answer.ClientName.ShouldBe("Acme");
        answer.MatterName.ShouldBe("Deal");
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.NoContent)]
    public async Task Not_found_and_no_content_mean_nothing_found(HttpStatusCode status)
    {
        var answer = await Client(new ScriptedHandler().Then(status)).FindAsync(new MatterLookupCall("https://m.test", "t", "00343", null), CancellationToken.None);

        answer.Kind.ShouldBe(MatterLookupAnswerKind.NotFound);
    }

    [Theory]
    [InlineData("[]", MatterLookupAnswerKind.NotFound)]
    [InlineData("{}", MatterLookupAnswerKind.NotFound)]
    [InlineData("42", MatterLookupAnswerKind.Failed)]
    [InlineData("nonsense", MatterLookupAnswerKind.Failed)]
    public void An_unusable_answer_is_not_found_or_failed_never_an_exception(string body, MatterLookupAnswerKind expected)
    {
        ProvisionalMatterLookupClient.Read(body, new MatterLookupOptions()).Kind.ShouldBe(expected);
    }

    [Fact]
    public async Task Server_errors_and_network_errors_and_timeouts_are_a_failure_not_an_exception()
    {
        var handler = new ScriptedHandler().Then(HttpStatusCode.InternalServerError).ThenThrow(new HttpRequestException("down")).ThenThrow(new TaskCanceledException("slow"));
        var call = new MatterLookupCall("https://m.test", "t", "00343", null);

        (await Client(handler).FindAsync(call, CancellationToken.None)).Kind.ShouldBe(MatterLookupAnswerKind.Failed);
        (await Client(handler).FindAsync(call, CancellationToken.None)).Kind.ShouldBe(MatterLookupAnswerKind.Failed);
        (await Client(handler).FindAsync(call, CancellationToken.None)).Kind.ShouldBe(MatterLookupAnswerKind.Failed);
    }

    [Fact]
    public void A_call_never_prints_its_token()
    {
        new MatterLookupCall("https://m.test", "the-token", "00343", null).ToString().ShouldNotContain("the-token");
    }
}
