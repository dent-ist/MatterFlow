using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using LptHub.Integrations.Contracts;
using LptHub.Integrations.Domain;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.ValueObjects;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LptHub.Integrations.Application;

public enum MatterLookupAnswerKind
{
    Found,
    NotFound,
    Failed,
}

/// <summary>What one call to the Matter Lookup API produced. Numbers are as the API sent them (the service pads them).</summary>
public sealed record MatterLookupAnswer(MatterLookupAnswerKind Kind, string? ClientNumber = null, string? ClientName = null, string? MatterNumber = null, string? MatterName = null);

/// <summary>One call: the API address, the token, the numbers (already padded or not as the mapping says). <see cref="ToString"/> hides the token.</summary>
public sealed record MatterLookupCall(string BaseUrl, string AccessToken, string ClientNumber, string? MatterNumber)
{
    public override string ToString() => $"MatterLookupCall({ClientNumber}, {MatterNumber})";
}

/// <summary>
/// THE one place that knows the Matter Lookup API's request and response shape. The real contract is not known yet (IT has not set the API up), so <see cref="ProvisionalMatterLookupClient"/> works from a
/// documented guess (<see cref="MatterLookupOptions"/>). When the real contract is known, change the options or register another implementation: nothing else changes.
/// </summary>
public interface IMatterLookupClient
{
    Task<MatterLookupAnswer> FindAsync(MatterLookupCall call, CancellationToken ct);
}

/// <summary>The provisional mapping (see <see cref="MatterLookupOptions"/> for the assumed request and response).</summary>
public sealed class ProvisionalMatterLookupClient(IHttpClientFactory httpFactory, IOptions<IntegrationsOptions> options, ILogger<ProvisionalMatterLookupClient> log) : IMatterLookupClient
{
    public async Task<MatterLookupAnswer> FindAsync(MatterLookupCall call, CancellationToken ct)
    {
        var map = options.Value.MatterLookup;
        var path = call.MatterNumber is null ? map.ClientPath : map.MatterPath;
        path = path.Replace("{clientNumber}", Uri.EscapeDataString(call.ClientNumber), StringComparison.Ordinal)
            .Replace("{matterNumber}", Uri.EscapeDataString(call.MatterNumber ?? string.Empty), StringComparison.Ordinal);
        var address = call.BaseUrl.TrimEnd('/') + "/" + path.TrimStart('/');

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, address);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", call.AccessToken);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var http = httpFactory.CreateClient(IntegrationTester.ApiClientName);
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseContentRead, ct);
            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.NoContent)
                return new MatterLookupAnswer(MatterLookupAnswerKind.NotFound);
            if (!response.IsSuccessStatusCode)
            {
                log.LogWarning("Matter Lookup answered HTTP {Status}", (int)response.StatusCode);
                return new MatterLookupAnswer(MatterLookupAnswerKind.Failed);
            }

            return Read(await response.Content.ReadAsStringAsync(ct), map);
        }
        catch (HttpRequestException)
        {
            log.LogWarning("Matter Lookup is not reachable");
            return new MatterLookupAnswer(MatterLookupAnswerKind.Failed);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            log.LogWarning("Matter Lookup did not answer in time");
            return new MatterLookupAnswer(MatterLookupAnswerKind.Failed);
        }
    }

    /// <summary>Reads an object, or the first object of an array; text and number values both work for the numbers. An answer with no usable name is "not found".</summary>
    internal static MatterLookupAnswer Read(string body, MatterLookupOptions map)
    {
        try
        {
            using var json = JsonDocument.Parse(body);
            var root = json.RootElement;
            if (root.ValueKind == JsonValueKind.Array)
            {
                if (root.GetArrayLength() == 0)
                    return new MatterLookupAnswer(MatterLookupAnswerKind.NotFound);
                root = root[0];
            }

            if (root.ValueKind != JsonValueKind.Object)
                return new MatterLookupAnswer(MatterLookupAnswerKind.Failed);

            var clientName = Text(root, map.ClientNameField);
            var matterName = Text(root, map.MatterNameField);
            if (clientName is null && matterName is null)
                return new MatterLookupAnswer(MatterLookupAnswerKind.NotFound);

            return new MatterLookupAnswer(MatterLookupAnswerKind.Found, Text(root, map.ClientNumberField), clientName, Text(root, map.MatterNumberField), matterName);
        }
        catch (JsonException)
        {
            return new MatterLookupAnswer(MatterLookupAnswerKind.Failed);
        }
    }

    private static string? Text(JsonElement obj, string field)
    {
        foreach (var p in obj.EnumerateObject())
        {
            if (!string.Equals(p.Name, field, StringComparison.OrdinalIgnoreCase))
                continue;

            var text = p.Value.ValueKind switch
            {
                JsonValueKind.String => p.Value.GetString(),
                JsonValueKind.Number => p.Value.GetRawText(),
                _ => null,
            };
            return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        }

        return null;
    }
}

/// <summary>
/// The Lookup button of New Client and New Matter: tells whether the button may be used and runs the call. Uses the Matter Lookup integration and its token; returns only what LPT Hub can use
/// (client name, matter name, numbers padded to five digits). A problem is a plain outcome (never an HTTP error), so the form keeps what the person typed.
/// </summary>
public sealed class MatterLookupService(DbContext db, ConnectionAccess connection, IntegrationTokenProvider tokens, IMatterLookupClient client, IOptions<IntegrationsOptions> options)
{
    private const int NameMax = 200;

    public async Task<MatterLookupStatusResponse> StatusAsync(CancellationToken ct)
    {
        var row = await db.Set<Integration>().AsNoTracking().SingleOrDefaultAsync(i => i.TypeCode == IntegrationTypes.MatterLookup, ct);
        if (row is null)
            return new("NOT_SET_UP");

        var complete = IntegrationSupport.IsComplete(await connection.LoadAsync(ct));
        return new(IntegrationSupport.StatusOf(row.IsEnabled, complete, row.BaseUrl, row.Scope, row.LastTestOutcome) switch
        {
            IntegrationStatuses.Disabled => "DISABLED",
            IntegrationStatuses.NotSetUp => "NOT_SET_UP",
            IntegrationStatuses.Failed => "FAILED",
            _ => "READY",
        });
    }

    public async Task<Result<MatterLookupResponse>> SearchAsync(MatterLookupRequest request, CancellationToken ct)
    {
        var fields = new FieldErrors();
        var client1 = BusinessNumber.Parse(request.ClientNumber);
        if (client1.IsFailure)
            fields.Add("clientNumber", "INVALID", client1.Error!.Message);
        BusinessNumber? matter = null;
        if (!string.IsNullOrWhiteSpace(request.MatterNumber))
        {
            var parsed = BusinessNumber.Parse(request.MatterNumber);
            if (parsed.IsFailure)
                fields.Add("matterNumber", "INVALID", parsed.Error!.Message);
            else
                matter = parsed.Value;
        }

        if (fields.ToError() is { } invalid)
            return invalid;

        var status = await StatusAsync(ct);
        if (status.State != "READY")
            return new MatterLookupResponse("NOT_AVAILABLE", null, null, null, null);

        var row = await db.Set<Integration>().AsNoTracking().SingleAsync(i => i.TypeCode == IntegrationTypes.MatterLookup, ct);
        var token = await tokens.TokenForAsync(row, forceNew: false, ct);
        if (token.IsFailure)
            return new MatterLookupResponse(token.Error!.Code == ErrorCodes.IntegrationNotAvailable ? "NOT_AVAILABLE" : "FAILED", null, null, null, null);

        var pad = options.Value.MatterLookup.PadNumbersInRequest;
        var answer = await client.FindAsync(
            new MatterLookupCall(row.BaseUrl!, token.Value.Value, pad ? client1.Value.Value : client1.Value.Value.TrimStart('0'), matter is { } m ? (pad ? m.Value : m.Value.TrimStart('0')) : null),
            ct);
        return answer.Kind switch
        {
            MatterLookupAnswerKind.Found => new MatterLookupResponse("FOUND", Number(answer.ClientNumber), Clip(answer.ClientName), Number(answer.MatterNumber), Clip(answer.MatterName)),
            MatterLookupAnswerKind.NotFound => new MatterLookupResponse("NOT_FOUND", null, null, null, null),
            _ => new MatterLookupResponse("FAILED", null, null, null, null),
        };
    }

    /// <summary>Pads a usable number to five digits; anything that is not a business number is left out.</summary>
    private static string? Number(string? raw) => BusinessNumber.TryParse(raw, out var n) ? n.Value : null;

    private static string? Clip(string? text) => text is { Length: > NameMax } ? text[..NameMax] : text;
}
