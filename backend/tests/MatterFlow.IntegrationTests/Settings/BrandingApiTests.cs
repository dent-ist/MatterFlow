using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Audit.Domain;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Settings;

/// <summary>Epic #850 (BR-01 to BR-03): the public branding endpoints, the administration endpoints, the cache headers and the audit.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class BrandingApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Base = "/api/v1/admin/settings/branding";
    private const string GoodSvg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0B5FFF"/></svg>""";

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private HttpClient _anonymous = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _anonymous = _factory.CreateClient(); // no X-Dev-User: not signed in
        _anonymous.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static byte[] Png(uint size, int padding = 0)
    {
        var bytes = new List<byte> { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        void Chunk(string type, byte[] data)
        {
            var len = new byte[4];
            BinaryPrimitives.WriteUInt32BigEndian(len, (uint)data.Length);
            bytes.AddRange(len);
            bytes.AddRange(Encoding.ASCII.GetBytes(type));
            bytes.AddRange(data);
            bytes.AddRange(new byte[4]);
        }

        var ihdr = new byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.AsSpan(0), size);
        BinaryPrimitives.WriteUInt32BigEndian(ihdr.AsSpan(4), size);
        ihdr[8] = 8;
        ihdr[9] = 6;
        Chunk("IHDR", ihdr);
        Chunk("IDAT", new byte[20 + padding]);
        Chunk("IEND", []);
        return [.. bytes];
    }

    private static MultipartFormDataContent IconForm(byte[] bytes, string rowVersion, string fileName = "logo.png", string contentType = "image/png")
    {
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return new MultipartFormDataContent { { file, "file", fileName }, { new StringContent(rowVersion), "rowVersion" } };
    }

    private static string Str(JsonElement e, string name) => e.GetProperty(name).GetString() ?? string.Empty;

    private async Task<JsonElement> AdminViewAsync() => await OkAsync(await _h.Admin.GetAsync(Base));

    private async Task<JsonElement> SetNameAsync(string name, string rowVersion, HttpStatusCode expected = HttpStatusCode.OK) =>
        await OkAsync(await _h.Admin.PutAsJsonAsync(Base + "/name", new { appName = name, rowVersion }), expected);

    private async Task<JsonElement> SetIconAsync(byte[] bytes, string rowVersion, HttpStatusCode expected = HttpStatusCode.OK, string fileName = "logo.png") =>
        await OkAsync(await _h.Admin.PutAsync(Base + "/icon", IconForm(bytes, rowVersion, fileName)), expected);

    private static string[] Directives(HttpResponseMessage r) =>
        [.. Header(r, "Cache-Control").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Order(StringComparer.Ordinal)];

    private static string Header(HttpResponseMessage r, string name) =>
        r.Headers.TryGetValues(name, out var v) ? string.Join(",", v) : r.Content.Headers.TryGetValues(name, out var c) ? string.Join(",", c) : string.Empty;

    [Fact]
    public async Task A_fresh_database_answers_the_defaults_to_anyone_and_has_no_icon()
    {
        var response = await _anonymous.GetAsync("/api/v1/branding");
        var body = await OkAsync(response);

        Str(body, "appName").ShouldBe("MatterFlow");
        body.GetProperty("iconUrl").ValueKind.ShouldBe(JsonValueKind.Null);
        body.GetProperty("iconKind").ValueKind.ShouldBe(JsonValueKind.Null);
        Str(body, "version").Length.ShouldBe(12);
        Directives(response).ShouldBe(["max-age=60", "must-revalidate", "public"]);
        Header(response, "ETag").ShouldBe("\"" + Str(body, "version") + "\"");
        Header(response, "X-Content-Type-Options").ShouldBe("nosniff");
        response.Headers.Contains("Set-Cookie").ShouldBeFalse();

        var icon = await _anonymous.GetAsync("/api/v1/branding/icon");
        icon.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        Header(icon, "Cache-Control").ShouldContain("no-store");

        var admin = await AdminViewAsync();
        Str(admin, "appName").ShouldBe("MatterFlow");
        admin.GetProperty("appNameIsCustom").GetBoolean().ShouldBeFalse();
        Str(admin, "appNameRowVersion").ShouldBe(string.Empty);
        Str(admin, "iconRowVersion").ShouldBe(string.Empty);
        admin.GetProperty("limits").GetProperty("appNameMaxLength").GetInt32().ShouldBe(40);
        admin.GetProperty("limits").GetProperty("iconMaxBytes").GetInt32().ShouldBe(262144);
        admin.GetProperty("updatedAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task The_public_name_answers_304_to_a_matching_ETag_and_changes_at_once_after_a_save()
    {
        var first = await _anonymous.GetAsync("/api/v1/branding");
        var etag = Header(first, "ETag");

        HttpRequestMessage Conditional()
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/branding");
            request.Headers.TryAddWithoutValidation("If-None-Match", etag);
            return request;
        }

        var notModified = await _anonymous.SendAsync(Conditional());
        notModified.StatusCode.ShouldBe(HttpStatusCode.NotModified);
        Directives(notModified).ShouldBe(["max-age=60", "must-revalidate", "public"]);

        var saved = await SetNameAsync("  Smith   &  Co ", string.Empty);
        Str(saved, "appName").ShouldBe("Smith & Co");

        // The writing node serves the new name immediately (its copy is dropped on every write).
        var after = await _anonymous.GetAsync("/api/v1/branding");
        var body = await OkAsync(after);
        Str(body, "appName").ShouldBe("Smith & Co");
        Header(after, "ETag").ShouldNotBe(etag);
        (await _anonymous.SendAsync(Conditional())).StatusCode.ShouldBe(HttpStatusCode.OK); // the old tag no longer matches
    }

    [Fact]
    public async Task Admin_endpoints_need_Settings_Manage_401_for_nobody_403_for_others_and_a_role_with_the_permission_works()
    {
        (await _anonymous.GetAsync(Base)).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await _anonymous.PutAsJsonAsync(Base + "/name", new { appName = "X", rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        var other = await _h.UserWithAsync(@"KE\notsettings", "Task.View", "Matter.View", "Role.Manage");
        (await other.GetAsync(Base)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await other.PutAsJsonAsync(Base + "/name", new { appName = "X", rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await other.PutAsync(Base + "/icon", IconForm(Png(64), ""))).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await other.DeleteAsync(Base + "/name")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await other.DeleteAsync(Base + "/icon")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var holder = await _h.UserWithAsync(@"KE\settingsholder", "Settings.Manage");
        (await holder.GetAsync(Base)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await holder.PutAsJsonAsync(Base + "/name", new { appName = "Holder Firm", rowVersion = "" })).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await other.GetAsync("/api/v1/branding")).StatusCode.ShouldBe(HttpStatusCode.OK); // anyone reads the public values
    }

    [Theory]
    [InlineData("", "BRANDING_NAME_REQUIRED")]
    [InlineData("   ", "BRANDING_NAME_REQUIRED")]
    [InlineData("<script>", "BRANDING_NAME_INVALID_CHARS")]
    [InlineData("a > b", "BRANDING_NAME_INVALID_CHARS")]
    [InlineData("tab\there", "BRANDING_NAME_INVALID_CHARS")]
    [InlineData("rtl ‮ x", "BRANDING_NAME_INVALID_CHARS")]
    [InlineData("0123456789012345678901234567890123456789X", "BRANDING_NAME_TOO_LONG")]
    public async Task An_invalid_name_is_a_400_with_a_stable_code_on_the_field_and_changes_nothing(string name, string code)
    {
        var problem = await ProblemAsync(await _h.Admin.PutAsJsonAsync(Base + "/name", new { appName = name, rowVersion = "" }), HttpStatusCode.BadRequest, code);
        problem.GetProperty("errors").GetProperty("appName")[0].GetProperty("code").GetString().ShouldBe(code);

        Str(await OkAsync(await _anonymous.GetAsync("/api/v1/branding")), "appName").ShouldBe("MatterFlow");
        (await AuditAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task A_stale_or_missing_row_version_is_a_409_and_a_malformed_one_a_400()
    {
        var saved = await SetNameAsync("First", string.Empty);
        var version = Str(saved, "appNameRowVersion");
        version.ShouldNotBeEmpty();

        // Somebody else saved with the version they read; this person still holds the old (empty) one.
        await ProblemAsync(await _h.Admin.PutAsJsonAsync(Base + "/name", new { appName = "Second", rowVersion = "" }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
        var second = await SetNameAsync("Second", version);
        await ProblemAsync(await _h.Admin.PutAsJsonAsync(Base + "/name", new { appName = "Third", rowVersion = version }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
        await ProblemAsync(await _h.Admin.DeleteAsync(Base + "/name?rowVersion=" + Uri.EscapeDataString(version)), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
        await ProblemAsync(await _h.Admin.PutAsJsonAsync(Base + "/name", new { appName = "Third", rowVersion = "not-base64!" }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        Str(await AdminViewAsync(), "appName").ShouldBe("Second");
        Str(second, "appName").ShouldBe("Second");
    }

    [Fact]
    public async Task A_row_that_was_reset_meanwhile_conflicts_with_a_save_made_on_the_old_version()
    {
        var saved = await SetNameAsync("Temp", string.Empty);
        var version = Str(saved, "appNameRowVersion");
        var reset = await OkAsync(await _h.Admin.DeleteAsync(Base + "/name?rowVersion=" + Uri.EscapeDataString(version)));
        Str(reset, "appName").ShouldBe("MatterFlow");

        await ProblemAsync(await _h.Admin.PutAsJsonAsync(Base + "/name", new { appName = "Late", rowVersion = version }), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");
    }

    [Fact]
    public async Task A_png_icon_is_stored_served_with_its_type_and_caching_and_visible_in_the_public_view()
    {
        var png = Png(128);
        var saved = await SetIconAsync(png, string.Empty);
        saved.GetProperty("iconKind").GetString().ShouldBe("png");
        saved.GetProperty("iconBytes").GetInt32().ShouldBe(png.Length);
        Str(saved, "iconContentType").ShouldBe("image/png");
        Str(saved, "iconRowVersion").ShouldNotBeEmpty();
        Str(saved, "updatedBy").ShouldNotBeEmpty();

        var view = await OkAsync(await _anonymous.GetAsync("/api/v1/branding"));
        view.GetProperty("iconKind").GetString().ShouldBe("png");
        var url = Str(view, "iconUrl");
        url.ShouldBe("/api/v1/branding/icon?v=" + Str(view, "version"));

        var icon = await _anonymous.GetAsync(url);
        icon.StatusCode.ShouldBe(HttpStatusCode.OK);
        icon.Content.Headers.ContentType!.MediaType.ShouldBe("image/png");
        (await icon.Content.ReadAsByteArrayAsync()).ShouldBe(png);
        Directives(icon).ShouldBe(["max-age=3600", "public"]);
        Header(icon, "ETag").ShouldBe("\"" + Str(view, "version") + "\"");
        Header(icon, "X-Content-Type-Options").ShouldBe("nosniff");
        Header(icon, "Content-Disposition").ShouldBe("inline");
        Header(icon, "Pragma").ShouldBeEmpty();

        var conditional = new HttpRequestMessage(HttpMethod.Get, url);
        conditional.Headers.TryAddWithoutValidation("If-None-Match", Header(icon, "ETag"));
        (await _anonymous.SendAsync(conditional)).StatusCode.ShouldBe(HttpStatusCode.NotModified);
    }

    [Fact]
    public async Task An_svg_icon_is_served_as_svg_with_a_sandbox_policy()
    {
        await SetIconAsync(Encoding.UTF8.GetBytes(GoodSvg), string.Empty, fileName: "logo.svg");

        var icon = await _anonymous.GetAsync("/api/v1/branding/icon");
        icon.StatusCode.ShouldBe(HttpStatusCode.OK);
        icon.Content.Headers.ContentType!.MediaType.ShouldBe("image/svg+xml");
        Header(icon, "Content-Security-Policy").ShouldContain("sandbox");
        Header(icon, "Content-Security-Policy").ShouldContain("default-src 'none'");
        Directives(icon).ShouldBe(["max-age=3600", "public"]);
        (await OkAsync(await _anonymous.GetAsync("/api/v1/branding"))).GetProperty("iconKind").GetString().ShouldBe("svg");
    }

    [Fact]
    public async Task The_type_is_decided_by_content_not_by_file_name_or_the_clients_content_type()
    {
        // A PNG named .svg and labelled image/svg+xml is a PNG.
        var form = IconForm(Png(64), string.Empty, "sneaky.svg", "image/svg+xml");
        var saved = await OkAsync(await _h.Admin.PutAsync(Base + "/icon", form));
        saved.GetProperty("iconKind").GetString().ShouldBe("png");

        // An SVG named .png is an SVG; an HTML page named .png is refused.
        var version = Str(saved, "iconRowVersion");
        var svg = await OkAsync(await _h.Admin.PutAsync(Base + "/icon", IconForm(Encoding.UTF8.GetBytes(GoodSvg), version, "logo.png")));
        svg.GetProperty("iconKind").GetString().ShouldBe("svg");
        var html = IconForm(Encoding.UTF8.GetBytes("<html><body>hello</body></html>"), Str(svg, "iconRowVersion"), "logo.png");
        await ProblemAsync(await _h.Admin.PutAsync(Base + "/icon", html), HttpStatusCode.BadRequest, "BRANDING_ICON_TYPE_UNSUPPORTED");
    }

    [Theory]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><script>alert(1)</script></svg>""", "BRANDING_ICON_UNSAFE")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="1" height="1" onload="x()"/></svg>""", "BRANDING_ICON_UNSAFE")]
    [InlineData("""<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"/>""", "BRANDING_ICON_UNSAFE")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 16"/>""", "BRANDING_ICON_NOT_SQUARE")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">""", "BRANDING_ICON_CORRUPT")]
    public async Task An_unsafe_or_broken_svg_is_refused_with_its_code_on_the_file_field_and_nothing_is_stored(string svg, string code)
    {
        var problem = await ProblemAsync(await _h.Admin.PutAsync(Base + "/icon", IconForm(Encoding.UTF8.GetBytes(svg), string.Empty, "logo.svg", "image/svg+xml")), HttpStatusCode.BadRequest, code);
        problem.GetProperty("errors").GetProperty("file")[0].GetProperty("code").GetString().ShouldBe(code);

        (await _anonymous.GetAsync("/api/v1/branding/icon")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await AuditAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task Size_limits_are_enforced_a_png_over_256_KB_is_400_and_a_body_over_300_KB_is_refused_before_it_is_read()
    {
        // Just over 256 KB.
        var over = Png(64, padding: 262144);
        await ProblemAsync(await _h.Admin.PutAsync(Base + "/icon", IconForm(over, string.Empty)), HttpStatusCode.BadRequest, "BRANDING_ICON_TOO_LARGE");

        // About 400 KB.
        var way = new byte[400 * 1024];
        await ProblemAsync(await _h.Admin.PutAsync(Base + "/icon", IconForm(way, string.Empty)), HttpStatusCode.RequestEntityTooLarge, "BRANDING_ICON_TOO_LARGE");

        // Small but wrong: too small and not square.
        await ProblemAsync(await _h.Admin.PutAsync(Base + "/icon", IconForm(Png(32), string.Empty)), HttpStatusCode.BadRequest, "BRANDING_ICON_TOO_SMALL");

        (await _anonymous.GetAsync("/api/v1/branding/icon")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_request_without_a_file_is_a_400()
    {
        var empty = new MultipartFormDataContent { { new StringContent(""), "rowVersion" } };
        await ProblemAsync(await _h.Admin.PutAsync(Base + "/icon", empty), HttpStatusCode.BadRequest, "BRANDING_ICON_TYPE_UNSUPPORTED");
        var notMultipart = await _h.Admin.PutAsync(Base + "/icon", new StringContent("{}", Encoding.UTF8, "application/json"));
        ((int)notMultipart.StatusCode).ShouldBeInRange(400, 415);
    }

    [Fact]
    public async Task Reset_removes_the_stored_values_and_the_defaults_return()
    {
        var name = await SetNameAsync("Reset Me", string.Empty);
        var icon = await SetIconAsync(Png(64), string.Empty);

        var afterIcon = await OkAsync(await _h.Admin.DeleteAsync(Base + "/icon?rowVersion=" + Uri.EscapeDataString(Str(icon, "iconRowVersion"))));
        afterIcon.GetProperty("iconUrl").ValueKind.ShouldBe(JsonValueKind.Null);
        Str(afterIcon, "appName").ShouldBe("Reset Me");
        (await _anonymous.GetAsync("/api/v1/branding/icon")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var afterName = await OkAsync(await _h.Admin.DeleteAsync(Base + "/name?rowVersion=" + Uri.EscapeDataString(Str(name, "appNameRowVersion"))));
        Str(afterName, "appName").ShouldBe("MatterFlow");
        afterName.GetProperty("appNameIsCustom").GetBoolean().ShouldBeFalse();
        Str(await OkAsync(await _anonymous.GetAsync("/api/v1/branding")), "appName").ShouldBe("MatterFlow");

        // Resetting what is already the default succeeds and writes nothing.
        var before = (await AuditAsync()).Count;
        (await _h.Admin.DeleteAsync(Base + "/name")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await AuditAsync()).Count.ShouldBe(before);
    }

    [Fact]
    public async Task Every_change_is_audited_with_metadata_and_the_hash_but_never_the_icon_bytes()
    {
        var name = await SetNameAsync("Audited Firm", string.Empty);
        await SetNameAsync("Audited Firm 2", Str(name, "appNameRowVersion"));
        var png = Png(96, padding: 5000);
        var icon = await SetIconAsync(png, string.Empty);
        await OkAsync(await _h.Admin.DeleteAsync(Base + "/icon?rowVersion=" + Uri.EscapeDataString(Str(icon, "iconRowVersion"))));

        var events = await AuditAsync();
        events.Select(e => e.EventType).ShouldBe(["SETTINGS_BRANDING_NAME_CHANGED", "SETTINGS_BRANDING_NAME_CHANGED", "SETTINGS_BRANDING_ICON_CHANGED", "SETTINGS_BRANDING_RESET"]);
        events.ShouldAllBe(e => e.ObjectType == "AppSetting" && e.ActorUserId != null && e.MatterId == null && e.TaskId == null);

        events[0].OldValue.ShouldBe("MatterFlow");
        events[0].NewValue.ShouldBe("Audited Firm");
        events[1].OldValue.ShouldBe("Audited Firm");
        events[1].NewValue.ShouldBe("Audited Firm 2");

        events[2].ObjectId.ShouldBe("Branding.Icon");
        events[2].OldValue.ShouldBeNull();
        events[2].NewValue!.ShouldContain("image/png");
        events[2].NewValue!.ShouldContain($"{png.Length} bytes");
        events[2].NewValue!.ShouldContain("sha256 " + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(png)).ToLowerInvariant());
        events[2].NewValue!.Length.ShouldBeLessThan(200); // a description, never the bytes

        events[3].ObjectId.ShouldBe("Branding.Icon");
        events[3].OldValue!.ShouldContain("image/png");
    }

    [Fact]
    public async Task Only_the_branding_paths_are_cacheable_every_other_api_path_stays_no_store()
    {
        foreach (var path in new[] { "/api/v1/me", "/api/v1/system/ping", "/api/v1/priorities", Base, "/api/v1/brandingx", "/api/v1/branding/other" })
        {
            var response = await _h.Admin.GetAsync(path);
            Header(response, "Cache-Control").Contains("no-store").ShouldBeTrue(path);
            Header(response, "Cache-Control").Contains("public").ShouldBeFalse(path);
            Header(response, "Pragma").ShouldBe("no-cache", path);
        }

        // Even the branding paths fall back to no-store when the response is an error.
        var missing = await _anonymous.GetAsync("/api/v1/branding/icon");
        missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        Header(missing, "Cache-Control").ShouldContain("no-store");
        Header(missing, "Content-Security-Policy").ShouldBe("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    }

    [Fact]
    public async Task The_permission_is_in_the_catalog_and_the_system_administrator_holds_it_implicitly()
    {
        var me = await OkAsync(await _h.Admin.GetAsync("/api/v1/me"));
        me.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()).ShouldContain("Settings.Manage");

        var groups = await _factory.WithDbAsync(db => db.Database.SqlQueryRaw<string>("SELECT GroupName AS [Value] FROM dbo.Permission WHERE Code = 'Settings.Manage'").ToListAsync());
        groups.ShouldBe(["Administration"]);
    }

    private Task<List<AuditEvent>> AuditAsync() =>
        _factory.WithDbAsync(db => db.Set<AuditEvent>().AsNoTracking().Where(a => a.ObjectType == "AppSetting").OrderBy(a => a.Id).ToListAsync());
}

/// <summary>
/// The production sign-in provider is Windows/Negotiate. IIS decides whether an unauthenticated browser request reaches the application at all
/// (deploy/web.config opens exactly /api/v1/branding to anonymous requests); this class proves the application side of that decision: with the
/// Windows provider an anonymous request to the two public branding endpoints is served, while every protected endpoint still answers a Negotiate challenge.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class BrandingWindowsProviderTests(SqlServerFixture sql)
{
    [Fact]
    public async Task With_the_Windows_provider_the_public_branding_endpoints_answer_anonymous_requests_and_nothing_else_does()
    {
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { ExtraSettings = [("Auth:Provider", "Windows")] };
        var client = factory.CreateClient();

        var branding = await client.GetAsync("/api/v1/branding");
        branding.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await branding.Content.ReadAsStringAsync()).ShouldContain("\"appName\":\"MatterFlow\"");
        branding.Headers.Contains("WWW-Authenticate").ShouldBeFalse();
        (await client.GetAsync("/api/v1/branding/icon")).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        foreach (var path in new[] { "/api/v1/me", "/api/v1/admin/settings/branding", "/api/v1/priorities", "/api/v1/tasks" })
        {
            var response = await client.GetAsync(path);
            response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized, path);
            response.Headers.WwwAuthenticate.Select(h => h.Scheme).ShouldContain("Negotiate", path);
        }
    }
}

