using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.Identity.Contracts;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Workflows;

/// <summary>
/// Step tags through the full HTTP pipeline against a real SQL Server: normalisation and limits with stable error codes, case-insensitive
/// identity across steps, the list filters (all / any, q matching tag text), tag suggestions with counts, audit, and that tags are
/// library metadata that never reach a published workflow version.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class StepTagsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
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

    private static StringContent Json(object value) => new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");

    private static async Task<JsonElement> OkAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        response.StatusCode.ShouldBe(expected, await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static int StepId(JsonElement step) => step.GetProperty("stepDefinitionId").GetInt32();

    private static string[] TagsOf(JsonElement step) => [.. step.GetProperty("tags").EnumerateArray().Select(t => t.GetString()!)];

    private static async Task<JsonElement> CreateAsync(HttpClient client, string title, params string[] tags) =>
        await OkAsync(await client.PostAsync("/api/v1/step-definitions", Json(new { title, tags })), HttpStatusCode.Created);

    private static async Task<JsonElement> UpdateAsync(HttpClient client, JsonElement step, string[]? tags, string? title = null, bool? active = null) =>
        await OkAsync(await PutAsync(client, step, tags, title, active));

    private static Task<HttpResponseMessage> PutAsync(HttpClient client, JsonElement step, string[]? tags, string? title = null, bool? active = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["title"] = title ?? step.GetProperty("title").GetString(),
            ["isActive"] = active ?? step.GetProperty("isActive").GetBoolean(),
            ["rowVersion"] = step.GetProperty("rowVersion").GetString(),
        };
        if (tags is not null)
        {
            body["tags"] = tags;
        }

        return client.PutAsync($"/api/v1/step-definitions/{StepId(step)}", Json(body));
    }

    private static async Task<string[]> ListTitlesAsync(HttpClient client, string query)
    {
        var page = await OkAsync(await client.GetAsync("/api/v1/step-definitions?" + query));
        return [.. page.GetProperty("items").EnumerateArray().Select(s => s.GetProperty("title").GetString()!)];
    }

    private static async Task<string> ErrorCodeAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.BadRequest)
    {
        response.StatusCode.ShouldBe(expected, await response.Content.ReadAsStringAsync());
        var body = await ReadAsync(response);
        return body.GetProperty("code").GetString()!;
    }

    [Fact]
    public async Task Tags_are_normalised_and_deduplicated_ignoring_case_keeping_the_first_spelling_and_order()
    {
        var client = As();
        var step = await CreateAsync(client, "Load", "  Relativity ", "pro   cessing", "RELATIVITY", "relativity", "Qc");
        TagsOf(step).ShouldBe(["Relativity", "pro cessing", "Qc"]);

        var read = await OkAsync(await client.GetAsync($"/api/v1/step-definitions/{StepId(step)}"));
        TagsOf(read).ShouldBe(["Relativity", "pro cessing", "Qc"]);

        // Reordering and re-casing: the stored display spelling stays the one entered first.
        var updated = await UpdateAsync(client, read, ["qc", "RELATIVITY"]);
        TagsOf(updated).ShouldBe(["Qc", "Relativity"]);
    }

    [Fact]
    public async Task A_tag_is_one_tag_across_steps_whatever_its_case()
    {
        var client = As();
        var first = await CreateAsync(client, "A", "Relativity");
        var second = await CreateAsync(client, "B", "relativity");
        TagsOf(first).ShouldBe(["Relativity"]);
        TagsOf(second).ShouldBe(["Relativity"]);

        var tags = await OkAsync(await client.GetAsync("/api/v1/step-definitions/tags"));
        tags.GetArrayLength().ShouldBe(1);
        tags[0].GetProperty("name").GetString().ShouldBe("Relativity");
        tags[0].GetProperty("stepCount").GetInt32().ShouldBe(2);
    }

    [Fact]
    public async Task Limits_and_invalid_tags_fail_with_stable_codes_and_nothing_is_saved()
    {
        var client = As();
        (await ErrorCodeAsync(await client.PostAsync("/api/v1/step-definitions", Json(new { title = "Long", tags = new[] { new string('x', 41) } })))).ShouldBe("TAG_TOO_LONG");
        (await ErrorCodeAsync(await client.PostAsync("/api/v1/step-definitions", Json(new { title = "Many", tags = Enumerable.Range(1, 21).Select(i => "t" + i) })))).ShouldBe("TOO_MANY_TAGS");
        (await ErrorCodeAsync(await client.PostAsync("/api/v1/step-definitions", Json(new { title = "Blank", tags = new[] { "  " } })))).ShouldBe("TAG_INVALID");
        (await ErrorCodeAsync(await client.PostAsync("/api/v1/step-definitions", Json(new { title = "Control", tags = new[] { "a\u0007b" } })))).ShouldBe("TAG_INVALID");
        (await ErrorCodeAsync(await client.PostAsync("/api/v1/step-definitions", Json(new { title = "Tab", tags = new[] { "a\tb" } })))).ShouldBe("TAG_INVALID");

        // Exactly at the limits is fine (40 characters, 20 tags; the 21st is a case-variant duplicate and does not count).
        var edge = Enumerable.Range(1, 20).Select(i => "t" + i).Append("T1").ToArray();
        var ok = await CreateAsync(client, "Edge", edge);
        TagsOf(ok).Length.ShouldBe(20);
        var forty = await CreateAsync(client, "Forty", new string('y', 40));
        TagsOf(forty)[0].Length.ShouldBe(40);

        var failing = await CreateAsync(client, "Existing", "keep");
        (await ErrorCodeAsync(await PutAsync(client, failing, [new string('x', 41)]))).ShouldBe("TAG_TOO_LONG");
        TagsOf(await OkAsync(await client.GetAsync($"/api/v1/step-definitions/{StepId(failing)}"))).ShouldBe(["keep"]);
        (await client.GetAsync("/api/v1/step-definitions?q=Long")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ListTitlesAsync(client, "q=Long")).ShouldBeEmpty();
    }

    [Fact]
    public async Task Omitting_tags_on_update_keeps_them_and_an_empty_list_removes_them_and_unused_tags_disappear()
    {
        var client = As();
        var step = await CreateAsync(client, "Keeper", "Alpha", "Beta");
        var renamed = await UpdateAsync(client, step, tags: null, title: "Keeper 2");
        TagsOf(renamed).ShouldBe(["Alpha", "Beta"]);

        var cleared = await UpdateAsync(client, renamed, []);
        TagsOf(cleared).ShouldBeEmpty();
        (await OkAsync(await client.GetAsync("/api/v1/step-definitions/tags"))).GetArrayLength().ShouldBe(0);

        // The display spelling is the one of the first use again after the tag was removed everywhere.
        TagsOf(await UpdateAsync(client, cleared, ["ALPHA"])).ShouldBe(["ALPHA"]);
    }

    [Fact]
    public async Task The_list_filters_by_all_or_any_tag_and_q_matches_tag_text()
    {
        var client = As();
        await CreateAsync(client, "Intake", "Intake");
        await CreateAsync(client, "Load", "Relativity", "Processing");
        await CreateAsync(client, "Produce", "Relativity", "Production");
        await CreateAsync(client, "Untagged");

        (await ListTitlesAsync(client, "tags=relativity")).ShouldBe(["Load", "Produce"]);
        (await ListTitlesAsync(client, "tags=Relativity&tags=PROCESSING")).ShouldBe(["Load"]); // default: all
        (await ListTitlesAsync(client, "tags=Relativity&tags=Processing&tagMatch=all")).ShouldBe(["Load"]);
        (await ListTitlesAsync(client, "tags=Processing&tags=Production&tagMatch=any")).ShouldBe(["Load", "Produce"]);
        (await ListTitlesAsync(client, "tags=Processing&tags=Production")).ShouldBeEmpty();
        (await ListTitlesAsync(client, "tags=Nothing")).ShouldBeEmpty();
        (await ListTitlesAsync(client, "tags=Relativity&q=prod")).ShouldBe(["Produce"]);

        // q matches the title, the description and the tag text.
        (await ListTitlesAsync(client, "q=relativ")).ShouldBe(["Load", "Produce"]);
        (await ListTitlesAsync(client, "q=ntake")).ShouldBe(["Intake"]);
        (await ListTitlesAsync(client, "q=Untagged")).ShouldBe(["Untagged"]);

        var page = await OkAsync(await client.GetAsync("/api/v1/step-definitions?tags=Relativity&pageSize=1"));
        page.GetProperty("total").GetInt32().ShouldBe(2);
        page.GetProperty("items").GetArrayLength().ShouldBe(1);

        (await client.GetAsync("/api/v1/step-definitions?tagMatch=some")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await client.GetAsync("/api/v1/step-definitions?bogusTag=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var tooMany = string.Join('&', Enumerable.Range(1, 21).Select(i => "tags=t" + i));
        (await ErrorCodeAsync(await client.GetAsync("/api/v1/step-definitions?" + tooMany))).ShouldBe("TOO_MANY_TAGS");
    }

    [Fact]
    public async Task List_rows_carry_their_tags_in_entered_order()
    {
        var client = As();
        await CreateAsync(client, "One", "Zed", "Alpha");
        await CreateAsync(client, "Two");
        var page = await OkAsync(await client.GetAsync("/api/v1/step-definitions?sort=title"));
        var items = page.GetProperty("items");
        TagsOf(items[0]).ShouldBe(["Zed", "Alpha"]);
        TagsOf(items[1]).ShouldBeEmpty();
    }

    [Fact]
    public async Task Tag_suggestions_have_usage_counts_filter_by_text_and_by_step_state()
    {
        var client = As();
        await CreateAsync(client, "A", "Relativity", "Processing");
        await CreateAsync(client, "B", "Relativity");
        var inactive = await CreateAsync(client, "C", "Relativity", "Review");
        await UpdateAsync(client, inactive, null, active: false);

        var all = await OkAsync(await client.GetAsync("/api/v1/step-definitions/tags"));
        all.EnumerateArray().Select(t => (t.GetProperty("name").GetString(), t.GetProperty("stepCount").GetInt32())).ToList()
            .ShouldBe([("Relativity", 3), ("Processing", 1), ("Review", 1)]);

        var active = await OkAsync(await client.GetAsync("/api/v1/step-definitions/tags?isActive=true"));
        active.EnumerateArray().Select(t => (t.GetProperty("name").GetString(), t.GetProperty("stepCount").GetInt32())).ToList()
            .ShouldBe([("Relativity", 2), ("Processing", 1)]);

        var q = await OkAsync(await client.GetAsync("/api/v1/step-definitions/tags?q=RE"));
        (await OkAsync(await client.GetAsync("/api/v1/step-definitions/tags?q=ess"))).EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList().ShouldBe(["Processing"]);
        q.EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList().ShouldBe(["Relativity", "Review"]);

        (await OkAsync(await client.GetAsync("/api/v1/step-definitions/tags?limit=1"))).GetArrayLength().ShouldBe(1);
        (await client.GetAsync("/api/v1/step-definitions/tags?limit=0")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await client.GetAsync("/api/v1/step-definitions/tags?nope=1")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Tag_changes_are_audited_and_move_the_row_version()
    {
        var client = As();
        var step = await CreateAsync(client, "Audited", "One");
        var updated = await UpdateAsync(client, step, ["One", "Two"]);
        updated.GetProperty("rowVersion").GetString().ShouldNotBe(step.GetProperty("rowVersion").GetString());

        // The old row version is now stale (a tag-only change still counts as a change of the step).
        (await ErrorCodeAsync(await PutAsync(client, step, ["Three"]), HttpStatusCode.Conflict)).ShouldBe("CONCURRENCY_CONFLICT");

        var unchanged = await UpdateAsync(client, updated, ["one", "two"]);
        unchanged.GetProperty("rowVersion").GetString().ShouldBe(updated.GetProperty("rowVersion").GetString());

        var page = await ReadAsync(await client.GetAsync($"/api/v1/audit/events?objectType=StepDefinition&objectId={StepId(step)}"));
        var tagEvents = page.GetProperty("items").EnumerateArray()
            .Where(e => e.GetProperty("fieldKey").GetString() == "Tags")
            .Select(e => (Old: e.GetProperty("oldValue").GetString(), New: e.GetProperty("newValue").GetString()))
            .ToList();
        tagEvents.Count.ShouldBe(2); // creation and the one real change; the identical update wrote nothing
        tagEvents.ShouldContain((null, "One"));
        tagEvents.ShouldContain(("One", "One, Two"));
    }

    [Fact]
    public async Task Tags_are_library_metadata_and_never_change_a_published_workflow_version()
    {
        var client = As();
        var step = await CreateAsync(client, "Tagged step", "Relativity");
        var workflow = await OkAsync(await client.PostAsync("/api/v1/workflows", Json(new { name = "Tagged workflow", isOrdered = true })), HttpStatusCode.Created);
        var workflowId = workflow.GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32();
        var draftId = workflow.GetProperty("workflow").GetProperty("draftVersionId").GetInt32();
        var draft = await OkAsync(await client.GetAsync($"/api/v1/workflows/{workflowId}/versions/{draftId}"));
        var saved = await OkAsync(await client.PutAsync(
            $"/api/v1/workflows/{workflowId}/versions/{draftId}",
            Json(new { isOrdered = true, steps = new object[] { new { sourceStepDefinitionId = StepId(step), isSkippable = false, skipCommentRequired = false } }, rowVersion = draft.GetProperty("version").GetProperty("rowVersion").GetString() })));
        var published = await OkAsync(await client.PostAsync(
            $"/api/v1/workflows/{workflowId}/versions/{draftId}/publish",
            Json(new { rowVersion = saved.GetProperty("version").GetProperty("rowVersion").GetString() })));
        var before = published.GetProperty("steps").GetRawText();
        published.GetProperty("steps")[0].TryGetProperty("tags", out _).ShouldBeFalse();

        // Retag the library step: the published version reads exactly as before and still has no tags.
        await UpdateAsync(client, step, ["Production", "QC"]);
        var after = await OkAsync(await client.GetAsync($"/api/v1/workflows/{workflowId}/versions/{draftId}"));
        after.GetProperty("steps").GetRawText().ShouldBe(before);
        after.GetProperty("version").GetProperty("status").GetString().ShouldBe("Published");
        after.GetRawText().ShouldNotContain("Production");
    }

    [Fact]
    public async Task Tag_endpoints_need_workflow_manage()
    {
        var admin = As();
        await CreateAsync(admin, "Visible", "Relativity");
        const string reader = @"KE\tagreader";
        const string designer = @"KE\tagdesigner";
        foreach (var user in new[] { reader, designer })
        {
            (await As(user).GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        }

        await _factory.GrantRoleAsync(reader, await _factory.CreateRoleAsync("Tag reader", Permissions.Task.View));
        await _factory.GrantRoleAsync(designer, await _factory.CreateRoleAsync("Tag designer", Permissions.Workflow.Manage));

        (await As(reader).GetAsync("/api/v1/step-definitions/tags")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await As(reader).GetAsync("/api/v1/step-definitions?tags=Relativity")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await As(designer).GetAsync("/api/v1/step-definitions/tags")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await _factory.CreateClient().GetAsync("/api/v1/step-definitions/tags")).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
