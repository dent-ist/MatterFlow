using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Organization;

/// <summary>
/// The guard of issue #1392 (epic #1389): a client number and a matter number are exactly 5 digits wherever the API shows them. The scan walks the JSON of the main endpoints
/// (every GET route of the OpenAPI contract that can be called with the ids of the test data) and fails on a client or matter number field, a CM Number (<c>00343-00012</c>) or a
/// number pair inside free text (audit summaries, messages) that is not 5 digits. The data is made with unpadded input ("343", "7"), because the API is what pads.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class BusinessNumberResponsesTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private Tasks.TaskHarness _h = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new Tasks.TaskHarness(_factory);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task No_main_endpoint_shows_a_client_or_matter_number_that_is_not_5_digits()
    {
        var world = await _h.CreateWorldAsync(); // client 343, matter 12, typed without zeros
        var otherMatterId = await _h.CreateMatterAsync("7", "5"); // a second pair with many leading zeros: 00007-00005
        var task = await _h.CreateTaskAsync(world);
        await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/notes", new { matterId = world.MatterId, title = "Number sweep", body = "Notes about 00343-00012." }), HttpStatusCode.Created);
        var matter = await OkAsync(await _h.Admin.GetAsync($"/api/v1/matters/{world.MatterId}"));
        var clientId = matter.GetProperty("clientId").GetInt32();
        var other = await OkAsync(await _h.Admin.GetAsync($"/api/v1/matters/{otherMatterId}"));
        matter.GetProperty("matterRef").GetString().ShouldBe("00343-00012");
        other.GetProperty("matterRef").GetString().ShouldBe("00007-00005");

        // A change of the matter number writes audit text with both numbers.
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/matters/{otherMatterId}/number", new { number = "6", rowVersion = other.GetProperty("rowVersion").GetString() }));

        var ids = new Dictionary<string, long>(StringComparer.Ordinal)
        {
            ["matterId"] = world.MatterId,
            ["clientId"] = clientId,
            ["projectId"] = world.ProjectId,
            ["taskId"] = TaskId(task),
        };
        var routes = BusinessNumberScan.GetRoutes(ids).Concat(
        [
            "/api/v1/matters?q=343",
            "/api/v1/clients?q=7",
            "/api/v1/matters/lookup?q=00007",
            "/api/v1/search?q=343",
            "/api/v1/search?q=343-12",
            "/api/v1/search?q=7-6",
            $"/api/v1/audit/events?objectType=Matter&objectId={otherMatterId}&pageSize=100",
            $"/api/v1/audit/events?matterId={world.MatterId}&pageSize=100",
            "/api/v1/audit/events?pageSize=100",
        ]).Distinct().ToList();

        var problems = new List<string>();
        var answered = 0;
        var checkedFields = 0;
        foreach (var route in routes)
        {
            var response = await _h.Admin.GetAsync(route);
            if (response.StatusCode != HttpStatusCode.OK || response.Content.Headers.ContentType?.MediaType != "application/json")
                continue;

            answered++;
            var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            checkedFields += BusinessNumberScan.Scan(json, route, problems);
        }

        problems.ShouldBeEmpty("These responses show a client or matter number that is not exactly 5 digits:\n" + string.Join("\n", problems));
        answered.ShouldBeGreaterThan(60, "the sweep must reach most of the endpoints, otherwise it guards nothing");
        checkedFields.ShouldBeGreaterThan(30, "the sweep must find client and matter numbers to check");
    }

    [Fact]
    public async Task The_scan_flags_what_it_is_meant_to_flag_and_nothing_else()
    {
        static List<string> Run(string json)
        {
            var found = new List<string>();
            BusinessNumberScan.Scan(JsonDocument.Parse(json).RootElement, "test", found);
            return found;
        }

        Run("""{"clientNumber":"00343","matterNumber":"00012","matterRef":"00343-00012","items":[{"ref":"00007-00005"}]}""").ShouldBeEmpty();
        Run("""{"clientNumber":"343"}""").Count.ShouldBe(1);
        Run("""{"x":{"matterNumber":"12"}}""").Count.ShouldBe(1);
        Run("""{"matterNumber":12}""").Count.ShouldBe(1); // a JSON number loses its zeros
        Run("""{"matterRef":"343-12"}""").Count.ShouldBe(1);
        Run("""{"summary":"Matter number changed from 00007-00005 to 00007-0006."}""").Count.ShouldBe(1);
        Run("""{"aging":[{"key":"0-2","label":"0-2 days"}]}""").ShouldBeEmpty(); // a chart bucket, not a number
        Run("""{"summary":"Matter 343-12 created."}""").Count.ShouldBe(1);
        // Not numbers of a client or matter: empty and null values (a restricted matter), dates, times, other prefixes.
        Run("""{"clientNumber":"","matterNumber":null,"summary":"Due 2026-11-16, from 10:00-11:00, T-123 and 12-34-56."}""").ShouldBeEmpty();
        Run("""{"month":"2026-11","query":"343-12"}""").ShouldBeEmpty(); // a month of a chart, and what the person typed in the search box
        await Task.CompletedTask;
    }
}

/// <summary>The scan of #1392: which JSON fields and which free-text patterns count as a client or matter number.</summary>
internal static partial class BusinessNumberScan
{
    private static readonly string[] NumberFields = ["clientNumber", "matterNumber"];
    private static readonly string[] RefFields = ["matterRef", "ref", "cmNumber", "matterCm"];

    /// <summary>Fields whose text is a sentence about a client or matter (audit summaries, messages, notification text): a pair of numbers in them is a CM Number. Other strings (chart labels such as "0-2 days") are not scanned.</summary>
    private static readonly string[] TextFields = ["summary", "message", "text", "body", "subject", "title", "description", "detail", "comment", "oldValue", "newValue", "name"];

    /// <summary>Fields that echo what the person typed (a search box): typed text is not a stored number.</summary>
    private static readonly string[] EchoFields = ["query", "q", "term"];

    /// <summary>A pair of numbers in text (<c>343-12</c>) that is not part of a date, a time or a longer code.</summary>
    [GeneratedRegex(@"(?<![\w:.\-/])(\d{1,5})-(\d{1,5})(?![\w\-/:])", RegexOptions.CultureInvariant)]
    private static partial Regex Pair();

    [GeneratedRegex(@"^(19|20)\d{2}-(0[1-9]|1[0-2])$", RegexOptions.CultureInvariant)]
    private static partial Regex YearMonth();

    [GeneratedRegex(@"^\d{5}$", RegexOptions.CultureInvariant)]
    private static partial Regex FiveDigits();

    /// <summary>The GET routes of the OpenAPI contract that can be called with the given ids (a route with another parameter is left out).</summary>
    public static IEnumerable<string> GetRoutes(IReadOnlyDictionary<string, long> ids)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(ContractPath()));
        foreach (var path in doc.RootElement.GetProperty("paths").EnumerateObject())
        {
            if (!path.Value.TryGetProperty("get", out _) || path.Name.Contains("/export", StringComparison.Ordinal))
                continue;

            var route = path.Name;
            var ok = true;
            foreach (Match m in Regex.Matches(route, @"\{(\w+)\}"))
            {
                var name = m.Groups[1].Value;
                if (name == "id")
                {
                    // {id} means the thing the route is about.
                    name = route.StartsWith("/api/v1/matters/", StringComparison.Ordinal) ? "matterId"
                        : route.StartsWith("/api/v1/clients/", StringComparison.Ordinal) ? "clientId"
                        : route.StartsWith("/api/v1/projects/", StringComparison.Ordinal) ? "projectId"
                        : route.StartsWith("/api/v1/tasks/", StringComparison.Ordinal) ? "taskId"
                        : string.Empty;
                }

                if (!ids.TryGetValue(name, out var value))
                {
                    ok = false;
                    break;
                }

                route = route.Replace(m.Value, value.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal);
            }

            if (ok)
                yield return route;
        }
    }

    /// <summary>Walks the JSON; adds one line to <paramref name="problems"/> for each value that is wrong and returns how many numbers it checked.</summary>
    public static int Scan(JsonElement element, string where, List<string> problems, string path = "$")
    {
        var checkedCount = 0;
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var p in element.EnumerateObject())
                    checkedCount += ScanProperty(p, where, problems, path);
                break;
            case JsonValueKind.Array:
                var i = 0;
                foreach (var item in element.EnumerateArray())
                    checkedCount += Scan(item, where, problems, $"{path}[{i++}]");
                break;
        }

        return checkedCount;
    }

    private static int ScanProperty(JsonProperty p, string where, List<string> problems, string path)
    {
        var here = $"{path}.{p.Name}";
        if (EchoFields.Contains(p.Name, StringComparer.OrdinalIgnoreCase))
            return 0;

        if (NumberFields.Contains(p.Name, StringComparer.OrdinalIgnoreCase))
        {
            if (p.Value.ValueKind is JsonValueKind.Null || (p.Value.ValueKind == JsonValueKind.String && p.Value.GetString() == string.Empty))
                return 0; // a matter the viewer may not see
            if (p.Value.ValueKind != JsonValueKind.String || !FiveDigits().IsMatch(p.Value.GetString()!))
                problems.Add($"{where} {here} = {p.Value}");
            return 1;
        }

        if (p.Value.ValueKind == JsonValueKind.String && RefFields.Contains(p.Name, StringComparer.OrdinalIgnoreCase))
        {
            var text = p.Value.GetString()!;
            if (Regex.IsMatch(text, @"^\d+-\d+$", RegexOptions.CultureInvariant))
            {
                if (!Regex.IsMatch(text, @"^\d{5}-\d{5}$", RegexOptions.CultureInvariant))
                    problems.Add($"{where} {here} = {text}");
                return 1;
            }

            return 0;
        }

        if (p.Value.ValueKind == JsonValueKind.String)
            return TextFields.Contains(p.Name, StringComparer.OrdinalIgnoreCase) ? ScanText(p.Value.GetString()!, where, problems, here) : 0;

        return Scan(p.Value, where, problems, here);
    }

    private static int ScanText(string text, string where, List<string> problems, string path)
    {
        var count = 0;
        foreach (Match m in Pair().Matches(text))
        {
            // A year and a month ("2026-11", the month axis of a chart) is a date, not a pair of numbers.
            if (YearMonth().IsMatch(m.Value))
                continue;

            count++;
            if (m.Groups[1].Value.Length != 5 || m.Groups[2].Value.Length != 5)
                problems.Add($"{where} {path}: \"{text}\" holds {m.Value}");
        }

        return count;
    }

    private static string ContractPath()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "contracts", "openapi", "v1.json");
            if (File.Exists(candidate))
                return candidate;
        }

        throw new FileNotFoundException("contracts/openapi/v1.json not found above " + AppContext.BaseDirectory);
    }
}
