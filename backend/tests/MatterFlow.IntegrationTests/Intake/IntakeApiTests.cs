using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Intake;

/// <summary>
/// <c>POST /api/v1/intake/parse-email</c> through the real pipeline (Dev auth, permission policy, multipart and JSON binding, ProblemDetails)
/// against a real database (needed for the permission lookup). Nothing is stored; the tests assert the response and the errors.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class IntakeApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Url = "/api/v1/intake/parse-email";

    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient As(string user = DatabaseApiFactory.AdminAccount)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        return client;
    }

    private static string Sample(string name) => Path.Combine(AppContext.BaseDirectory, "Intake", "samples", name);

    private static MultipartFormDataContent Upload(byte[] bytes, string fileName, string field = "file")
    {
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        return new MultipartFormDataContent { { file, field, fileName } };
    }

    private static StringContent Json(string pastedText) =>
        new(JsonSerializer.Serialize(new { pastedText }), Encoding.UTF8, "application/json");

    private static async Task<JsonElement> ProblemAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(status, body);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        var problem = JsonDocument.Parse(body).RootElement;
        problem.GetProperty("code").GetString().ShouldBe(code);
        return problem;
    }

    [Fact]
    public async Task Eml_upload_returns_the_parsed_values()
    {
        var response = await As().PostAsync(Url, Upload(File.ReadAllBytes(Sample("04-utf8-subject.eml")), "04-utf8-subject.eml"));

        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(HttpStatusCode.OK, body);
        var json = JsonDocument.Parse(body).RootElement;
        json.GetProperty("subject").GetString().ShouldBe("Aktenüberprüfung – 文书確認 📂");
        json.GetProperty("fromName").GetString().ShouldBe("Jürgen Müller");
        json.GetProperty("fromEmail").GetString().ShouldBe("juergen.mueller@example-firm.test");
        json.GetProperty("sentAt").GetDateTimeOffset().ShouldBe(new DateTimeOffset(2026, 10, 15, 8, 30, 0, TimeSpan.Zero));
        json.GetProperty("body").GetString()!.ShouldContain("Grüße aus Zürich.");
        json.GetProperty("source").GetString().ShouldBe("eml");
        json.GetProperty("warnings").GetArrayLength().ShouldBe(0);
    }

    [Theory]
    [InlineData("01-plain.eml", "Production volume 7 - request for load file", "Jane Doe")]
    [InlineData("02-html-only.eml", "HTML only: review set update", "Doe, Jane")]
    [InlineData("03-multipart-attachment.eml", "Search term report attached", "Raj Patel")]
    [InlineData("05-forwarded-chain.eml", "FW: FW: Custodian interview schedule", "Maria Gomez")]
    public async Task Every_sample_is_parsed_through_the_endpoint(string file, string subject, string fromName)
    {
        var response = await As().PostAsync(Url, Upload(File.ReadAllBytes(Sample(file)), file));

        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(HttpStatusCode.OK, body);
        var json = JsonDocument.Parse(body).RootElement;
        json.GetProperty("subject").GetString().ShouldBe(subject);
        json.GetProperty("fromName").GetString().ShouldBe(fromName);
    }

    [Fact]
    public async Task Pasted_text_json_returns_the_parsed_values()
    {
        var response = await As().PostAsync(Url, Json("From: Jane Doe <jane@x.test>\nSent: Thursday, October 15, 2026 3:10 PM\nSubject: Hello\n\nBody text"));

        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(HttpStatusCode.OK, body);
        var json = JsonDocument.Parse(body).RootElement;
        json.GetProperty("source").GetString().ShouldBe("text");
        json.GetProperty("subject").GetString().ShouldBe("Hello");
        json.GetProperty("fromEmail").GetString().ShouldBe("jane@x.test");
        json.GetProperty("sentAt").GetDateTimeOffset().ShouldBe(new DateTimeOffset(2026, 10, 15, 19, 10, 0, TimeSpan.Zero));
        json.GetProperty("body").GetString().ShouldBe("Body text");
    }

    [Fact]
    public async Task Documented_text_route_behaves_like_the_shared_route()
    {
        var response = await As().PostAsync(Url + "/text", Json("From: Jane Doe <jane@x.test>\nSent: Thursday, October 15, 2026 3:10 PM\nSubject: Hello\n\nBody text"));

        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(HttpStatusCode.OK, body);
        JsonDocument.Parse(body).RootElement.GetProperty("subject").GetString().ShouldBe("Hello");
    }

    [Fact]
    public async Task Empty_pasted_text_is_a_validation_problem()
    {
        var problem = await ProblemAsync(await As().PostAsync(Url, Json("  ")), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        problem.GetProperty("errors").GetProperty("pastedText").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task Missing_file_part_is_a_validation_problem()
    {
        await ProblemAsync(await As().PostAsync(Url, Upload("x"u8.ToArray(), "a.eml", field: "other")), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task Unsupported_extension_is_415()
    {
        await ProblemAsync(await As().PostAsync(Url, Upload("x"u8.ToArray(), "notes.pdf")), HttpStatusCode.UnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE");
    }

    [Fact]
    public async Task Binary_garbage_named_eml_is_a_parse_failure()
    {
        await ProblemAsync(await As().PostAsync(Url, Upload(new byte[] { 0x50, 0x4B, 3, 4, 0, 0 }, "evil.eml")), HttpStatusCode.BadRequest, "EMAIL_PARSE_FAILED");
    }

    [Fact]
    public async Task Upload_over_ten_megabytes_is_413_with_a_problem_body()
    {
        var big = new byte[10 * 1024 * 1024 + 4096];
        Array.Fill(big, (byte)'a');

        var response = await As().PostAsync(Url, Upload(big, "big.eml"));

        await ProblemAsync(response, HttpStatusCode.RequestEntityTooLarge, "PAYLOAD_TOO_LARGE");
    }

    [Fact]
    public async Task Huge_upload_is_rejected_with_a_problem_body()
    {
        var big = new byte[14 * 1024 * 1024];
        Array.Fill(big, (byte)'a');

        var response = await As().PostAsync(Url, Upload(big, "big.eml"));

        response.StatusCode.ShouldBeOneOf(HttpStatusCode.RequestEntityTooLarge, HttpStatusCode.BadRequest);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    }

    [Fact]
    public async Task User_without_task_create_is_forbidden_and_user_with_it_is_allowed()
    {
        const string user = @"KE\intake-tester";
        var client = As(user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK); // JIT-provisions the user

        await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Viewer", Permissions.Task.View));
        var denied = await client.PostAsync(Url, Json("Hello"));
        await ProblemAsync(denied, HttpStatusCode.Forbidden, "PERMISSION_DENIED");

        await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Intake tester", Permissions.Task.Create));

        (await client.PostAsync(Url, Json("Hello"))).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Request_without_the_client_header_is_rejected()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsync(Url, Json("Hello"));

        response.IsSuccessStatusCode.ShouldBeFalse();
    }

    // ---- SEC-02: hostile input and request limits

    [Fact]
    public async Task Hostile_nested_html_upload_is_answered_quickly()
    {
        var html = string.Concat(Enumerable.Repeat("<div>", 30_000)) + "payload";
        var eml = "From: A <a@x.test>\r\nSubject: hostile\r\nContent-Type: text/html\r\n\r\n" + html + "\r\n";

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var response = await As().PostAsync(Url, Upload(Encoding.ASCII.GetBytes(eml), "hostile.eml"));
        stopwatch.Stop();

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        stopwatch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(3));
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("body").GetString().ShouldBe("payload");
    }

    [Fact]
    public async Task A_user_who_exceeds_the_intake_request_budget_gets_429()
    {
        await using var limited = _factory.WithWebHostBuilder(b => b.UseSetting("Intake:RequestsPerMinutePerUser", "3"));
        HttpClient Client()
        {
            var client = limited.CreateClient();
            client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
            client.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);
            return client;
        }

        var client = Client();
        for (var i = 0; i < 3; i++)
            (await client.PostAsync(Url, Json("Hello"))).StatusCode.ShouldBe(HttpStatusCode.OK);

        var rejected = await client.PostAsync(Url, Json("Hello"));
        await ProblemAsync(rejected, HttpStatusCode.TooManyRequests, "TOO_MANY_REQUESTS");
        rejected.Headers.Contains("Retry-After").ShouldBeTrue();
    }
}
