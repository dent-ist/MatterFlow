using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;
using Xunit.Abstractions;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;
using Place = MatterFlow.IntegrationTests.Workflows.WorkflowInstanceHarness.Place;

namespace MatterFlow.IntegrationTests.Workflows;

/// <summary>
/// The additive list fields and the health-strip summaries of the Workflows and Workflow Steps lists (#366): publication date, step count, version
/// count, draft flag and active Task Type count per workflow; published form version and draft field count per step; the library-wide summaries
/// (independent of filters and paging); the new sort keys; the permissions; and a fixed number of SQL statements however many rows a page holds.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class AdminListFieldsApiTests(SqlServerFixture sql, ITestOutputHelper output) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private int _stepA;
    private int _stepB;
    private int _stepC;
    private readonly Dictionary<string, int> _w = [];
    private readonly CommandLog _commands = new();

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        var wf = _h.Workflows;
        _stepA = await wf.CreateStepAsync("List step A", withInputForm: true);
        _stepB = await wf.CreateStepAsync("List step B");
        _stepC = await wf.CreateStepAsync("List step C");

        // Published first, so it holds the oldest publication date: published v1, then retired.
        var retiredOnly = await wf.CreatePublishedWorkflowAsync("W retired only", true, new Place(_stepA));
        _w["retired"] = retiredOnly.WorkflowId;
        await RetireAsync(retiredOnly.WorkflowId, retiredOnly.VersionId);

        // Inactive but published.
        var inactive = await wf.CreatePublishedWorkflowAsync("W inactive", true, new Place(_stepA), new Place(_stepB));
        _w["inactive"] = inactive.WorkflowId;
        var detail = await Ok(await _h.Admin.GetAsync($"/api/v1/workflows/{inactive.WorkflowId}"));
        await Ok(await _h.Admin.PutAsJsonAsync(
            $"/api/v1/workflows/{inactive.WorkflowId}",
            new { name = "W inactive", description = "d", isActive = false, rowVersion = detail.GetProperty("workflow").GetProperty("rowVersion").GetString() }));

        // Multi-version: v1 published then retired by v2 (3 steps), and an open draft v3.
        var multi = await wf.CreatePublishedWorkflowAsync("W multi", true, new Place(_stepA));
        _w["multi"] = multi.WorkflowId;
        await wf.PublishNextVersionAsync(multi.WorkflowId, true, new Place(_stepA), new Place(_stepB), new Place(_stepC));
        await Ok(await _h.Admin.PostAsync($"/api/v1/workflows/{multi.WorkflowId}/versions", new StringContent("{}", System.Text.Encoding.UTF8, "application/json")), HttpStatusCode.Created);

        // Draft only: never published.
        var draftOnly = await Ok(await _h.Admin.PostAsJsonAsync("/api/v1/workflows", new { name = "W draft only", description = "d", isOrdered = true }), HttpStatusCode.Created);
        _w["draft"] = draftOnly.GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32();

        // Task types: two active ones eligible for "multi", one inactive one too, one active for "retired".
        await _h.CreateTaskTypeAsync("List type one", [_w["multi"], _w["retired"]], withForm: false);
        await _h.CreateTaskTypeAsync("List type two", [_w["multi"]], withForm: false);
        var third = await _h.CreateTaskTypeAsync("List type three", [_w["multi"]], withForm: false);
        var type = await Ok(await _h.Admin.GetAsync($"/api/v1/task-types/{third}"));
        await Ok(await _h.Admin.PutAsJsonAsync(
            $"/api/v1/task-types/{third}",
            new
            {
                name = "List type three",
                description = (string?)null,
                isActive = false,
                eligibleWorkflowIds = new[] { _w["multi"] },
                defaultWorkflowDefinitionId = _w["multi"],
                rowVersion = type.GetProperty("rowVersion").GetString(),
                iconKey = type.GetProperty("iconKey").GetString(),
            }));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static async Task<JsonElement> Ok(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK) => await OkAsync(response, expected);

    private async Task RetireAsync(int workflowId, int versionId)
    {
        var version = await Ok(await _h.Admin.GetAsync($"/api/v1/workflows/{workflowId}/versions/{versionId}"));
        await Ok(await _h.Admin.PostAsJsonAsync(
            $"/api/v1/workflows/{workflowId}/versions/{versionId}/retire",
            new { rowVersion = version.GetProperty("version").GetProperty("rowVersion").GetString() }));
    }

    private async Task<JsonElement> WorkflowsAsync(string query = "") => await Ok(await _h.Admin.GetAsync("/api/v1/workflows" + query));

    private static JsonElement Item(JsonElement page, string name, string key = "name") => page.GetProperty("items").EnumerateArray().Single(i => i.GetProperty(key).GetString() == name);

    private static string[] Names(JsonElement page) => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("name").GetString()!)];

    // ---- workflows

    [Fact]
    public async Task The_workflow_list_carries_the_publication_date_step_count_versions_draft_flag_and_active_task_type_count()
    {
        var page = await WorkflowsAsync();

        var multi = Item(page, "W multi");
        multi.GetProperty("hasDraft").GetBoolean().ShouldBeTrue();
        multi.GetProperty("draftVersionId").GetInt32().ShouldBeGreaterThan(0);
        multi.GetProperty("versionCount").GetInt32().ShouldBe(3);
        multi.GetProperty("publishedVersionNo").GetInt32().ShouldBe(2);
        multi.GetProperty("stepCount").GetInt32().ShouldBe(3);
        multi.GetProperty("publishedStepCount").GetInt32().ShouldBe(3);
        multi.GetProperty("publishedAtUtc").GetDateTime().ShouldBeGreaterThan(DateTime.UtcNow.AddMinutes(-10));
        // Three types are eligible, one is inactive: the count is the active ones, the list still names all three.
        multi.GetProperty("taskTypeCount").GetInt32().ShouldBe(2);
        multi.GetProperty("taskTypes").GetArrayLength().ShouldBe(3);

        // Draft only: never published, nothing to say about a publication.
        var draft = Item(page, "W draft only");
        draft.GetProperty("hasDraft").GetBoolean().ShouldBeTrue();
        draft.GetProperty("versionCount").GetInt32().ShouldBe(1);
        draft.GetProperty("publishedAtUtc").ValueKind.ShouldBe(JsonValueKind.Null);
        draft.GetProperty("stepCount").ValueKind.ShouldBe(JsonValueKind.Null);
        draft.GetProperty("taskTypeCount").GetInt32().ShouldBe(0);

        // Retired only: no published version, but the date and size of its last publication are known.
        var retired = Item(page, "W retired only");
        retired.GetProperty("hasDraft").GetBoolean().ShouldBeFalse();
        retired.GetProperty("draftVersionId").ValueKind.ShouldBe(JsonValueKind.Null);
        retired.GetProperty("publishedVersionId").ValueKind.ShouldBe(JsonValueKind.Null);
        retired.GetProperty("publishedStepCount").ValueKind.ShouldBe(JsonValueKind.Null);
        retired.GetProperty("publishedAtUtc").ValueKind.ShouldBe(JsonValueKind.String);
        retired.GetProperty("stepCount").GetInt32().ShouldBe(1);
        retired.GetProperty("versionCount").GetInt32().ShouldBe(1);
        retired.GetProperty("taskTypeCount").GetInt32().ShouldBe(1);

        var inactive = Item(page, "W inactive");
        inactive.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        inactive.GetProperty("stepCount").GetInt32().ShouldBe(2);

        // The detail carries the same fields for the one workflow.
        var detail = await Ok(await _h.Admin.GetAsync($"/api/v1/workflows/{_w["multi"]}"));
        detail.GetProperty("workflow").GetProperty("taskTypeCount").GetInt32().ShouldBe(2);
        detail.GetProperty("workflow").GetProperty("versionCount").GetInt32().ShouldBe(3);
    }

    [Fact]
    public async Task The_summary_counts_the_whole_library_whatever_the_filters_and_the_page()
    {
        // 4 workflows: inactive is out of every active count; retired-only and draft-only are not published; multi and draft have a draft.
        var expected = new { Total = 4, Active = 3, Inactive = 1, Published = 1, NotPublished = 2, DraftInProgress = 2 };
        foreach (var query in new[] { string.Empty, "?isActive=false", "?name=multi", "?hasDraft=true&pageSize=1", "?q=nothing-matches-this", "?page=3&pageSize=2" })
        {
            var page = await WorkflowsAsync(query);
            var summary = page.GetProperty("summary");
            summary.GetProperty("total").GetInt32().ShouldBe(expected.Total, query);
            summary.GetProperty("active").GetInt32().ShouldBe(expected.Active, query);
            summary.GetProperty("inactive").GetInt32().ShouldBe(expected.Inactive, query);
            summary.GetProperty("published").GetInt32().ShouldBe(expected.Published, query);
            summary.GetProperty("notPublished").GetInt32().ShouldBe(expected.NotPublished, query);
            summary.GetProperty("draftInProgress").GetInt32().ShouldBe(expected.DraftInProgress, query);
        }

        // The paging fields keep describing the filtered list.
        var filtered = await WorkflowsAsync("?isActive=false");
        filtered.GetProperty("total").GetInt32().ShouldBe(1);
        filtered.GetProperty("items").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task The_workflow_list_sorts_by_publication_date_and_by_active_task_type_count_with_never_published_last()
    {
        // Published in this order: retired-only, inactive, multi (twice); draft-only never. Never-published workflows are last in both directions.
        Names(await WorkflowsAsync("?sort=publishedAtUtc")).ShouldBe(["W retired only", "W inactive", "W multi", "W draft only"]);
        Names(await WorkflowsAsync("?sort=-publishedAtUtc")).ShouldBe(["W multi", "W inactive", "W retired only", "W draft only"]);

        // Active task types: multi 2, retired 1, the others 0 (by name).
        Names(await WorkflowsAsync("?sort=-taskTypeCount")).ShouldBe(["W multi", "W retired only", "W draft only", "W inactive"]);
        Names(await WorkflowsAsync("?sort=taskTypeCount")).ShouldBe(["W draft only", "W inactive", "W retired only", "W multi"]);

        // Paging follows the sort and the old keys still work.
        Names(await WorkflowsAsync("?sort=-taskTypeCount&pageSize=2&page=2")).ShouldBe(["W draft only", "W inactive"]);
        Names(await WorkflowsAsync("?sort=-name")).ShouldBe(["W retired only", "W multi", "W inactive", "W draft only"]);
        Names(await WorkflowsAsync()).ShouldBe(["W draft only", "W inactive", "W multi", "W retired only"]);

        var bad = await _h.Admin.GetAsync("/api/v1/workflows?sort=bogus");
        await ProblemAsync(bad, HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    [Fact]
    public async Task The_workflow_list_needs_Workflow_Manage_and_nothing_else()
    {
        var manager = await _h.UserWithAsync(@"KE\wfonly", "Workflow.Manage");
        var page = await Ok(await manager.GetAsync("/api/v1/workflows"));
        page.GetProperty("summary").GetProperty("total").GetInt32().ShouldBe(4);
        Item(page, "W multi").GetProperty("taskTypeCount").GetInt32().ShouldBe(2);

        var viewer = await _h.UserWithAsync(@"KE\viewer", "Task.View");
        (await viewer.GetAsync("/api/v1/workflows")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        var typeAdmin = await _h.UserWithAsync(@"KE\ttonly", "TaskType.Manage", "Task.View");
        (await typeAdmin.GetAsync("/api/v1/workflows")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await typeAdmin.GetAsync("/api/v1/step-definitions")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ---- steps

    [Fact]
    public async Task The_step_list_carries_the_published_form_version_and_the_draft_field_count_and_the_summary_counts_the_library()
    {
        // Step A has a published input form (one field). Give step B an open draft with two fields and step C an open but empty draft.
        var steps = await Ok(await _h.Admin.GetAsync("/api/v1/step-definitions"));
        var a = Item(steps, "List step A", "title");
        a.GetProperty("publishedFormVersionId").GetInt32().ShouldBeGreaterThan(0);
        a.GetProperty("draftFormFieldCount").GetInt32().ShouldBe(0);
        Item(steps, "List step B", "title").GetProperty("publishedFormVersionId").ValueKind.ShouldBe(JsonValueKind.Null);

        await SaveDraftFieldsAsync(_stepB, """{"fields":[{"key":"a","label":"A","control":"TEXT"},{"key":"b","label":"B","control":"TEXT"}]}""");
        await SaveDraftFieldsAsync(_stepC, """{"fields":[]}""");
        var d = await Ok(await _h.Admin.PostAsJsonAsync(
            "/api/v1/step-definitions",
            new { title = "List step D" }), HttpStatusCode.Created);
        var spare = d.GetProperty("stepDefinitionId").GetInt32();
        await DeactivateStepAsync(spare);

        steps = await Ok(await _h.Admin.GetAsync("/api/v1/step-definitions"));
        var b = Item(steps, "List step B", "title");
        b.GetProperty("draftFormFieldCount").GetInt32().ShouldBe(2);
        b.GetProperty("publishedFormVersionId").ValueKind.ShouldBe(JsonValueKind.Null);
        Item(steps, "List step C", "title").GetProperty("draftFormFieldCount").GetInt32().ShouldBe(0);

        // The detail says the same about the same step, and the used-in counts are kept.
        var detail = await Ok(await _h.Admin.GetAsync($"/api/v1/step-definitions/{_stepB}"));
        detail.GetProperty("draftFormFieldCount").GetInt32().ShouldBe(2);
        a.GetProperty("usedInWorkflows").GetInt32().ShouldBe(3);
        a.GetProperty("usedInVersions").GetInt32().ShouldBe(5);

        // Four steps, three active (D is inactive); A, B and C are all used by workflows; only B has inputs in draft (A's form is published, C's draft is empty).
        foreach (var query in new[] { string.Empty, "?isActive=false", "?q=nothing-matches-this", "?pageSize=1&page=2", "?used=false" })
        {
            var summary = (await Ok(await _h.Admin.GetAsync("/api/v1/step-definitions" + query))).GetProperty("summary");
            summary.GetProperty("total").GetInt32().ShouldBe(4, query);
            summary.GetProperty("active").GetInt32().ShouldBe(3, query);
            summary.GetProperty("inactive").GetInt32().ShouldBe(1, query);
            summary.GetProperty("notUsed").GetInt32().ShouldBe(0, query);
            summary.GetProperty("inputsInDraft").GetInt32().ShouldBe(1, query);
        }

        // A step used nowhere is counted as not used while it is active.
        await _h.Admin.PostAsJsonAsync("/api/v1/step-definitions", new { title = "List step E" });
        var after = (await Ok(await _h.Admin.GetAsync("/api/v1/step-definitions"))).GetProperty("summary");
        after.GetProperty("notUsed").GetInt32().ShouldBe(1);
        after.GetProperty("active").GetInt32().ShouldBe(4);
    }

    [Fact]
    public async Task The_step_list_needs_Workflow_Manage()
    {
        var manager = await _h.UserWithAsync(@"KE\wfonly2", "Workflow.Manage");
        var page = await Ok(await manager.GetAsync("/api/v1/step-definitions"));
        page.GetProperty("summary").GetProperty("total").GetInt32().ShouldBe(3);
        var viewer = await _h.UserWithAsync(@"KE\viewer2", "Task.View");
        (await viewer.GetAsync("/api/v1/step-definitions")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ---- no N+1

    [Fact]
    public async Task A_page_of_one_hundred_rows_takes_the_same_number_of_statements_as_a_page_of_one()
    {
        // 100 more workflows (a third of them published with a step) and 100 more steps (a fifth with a published input form).
        for (var i = 0; i < 100; i++)
        {
            var created = await Ok(await _h.Admin.PostAsJsonAsync("/api/v1/workflows", new { name = $"Bulk workflow {i:000}", description = "d", isOrdered = true }), HttpStatusCode.Created);
            if (i % 3 == 0)
            {
                var id = created.GetProperty("workflow").GetProperty("workflowDefinitionId").GetInt32();
                var draftId = created.GetProperty("workflow").GetProperty("draftVersionId").GetInt32();
                await PublishWithStepAsync(id, draftId);
            }

            var step = await Ok(await _h.Admin.PostAsJsonAsync("/api/v1/step-definitions", new { title = $"Bulk step {i:000}" }), HttpStatusCode.Created);
            if (i % 5 == 0)
                await SaveAndPublishFieldsAsync(step.GetProperty("formDefinitionId").GetInt32());
        }

        var logged = _factory.WithWebHostBuilder(builder => builder.ConfigureServices(services => services.AddLogging(logging =>
        {
            logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Information);
            logging.AddProvider(_commands);
        })));
        var http = logged.CreateClient();
        http.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        http.DefaultRequestHeaders.Add("X-Dev-User", DatabaseApiFactory.AdminAccount);

        foreach (var (list, sorts) in new[] { ("workflows", new[] { "", "&sort=-publishedAtUtc", "&sort=-taskTypeCount" }), ("step-definitions", new[] { "", "&sort=-usedInWorkflows" }) })
        {
            foreach (var sort in sorts)
            {
                var small = await StatementsAsync(http, $"/api/v1/{list}?pageSize=1{sort}");
                var big = await StatementsAsync(http, $"/api/v1/{list}?pageSize=100{sort}");
                output.WriteLine($"{list}{sort}: {small} statements for 1 row, {big} for 100 rows");
                big.ShouldBe(small, $"{list}{sort}: the number of statements must not grow with the rows of the page");
                big.ShouldBeLessThan(14, $"{list}{sort}");
            }
        }

        (await Ok(await http.GetAsync("/api/v1/workflows?pageSize=100"))).GetProperty("items").GetArrayLength().ShouldBe(100);
        (await Ok(await http.GetAsync("/api/v1/step-definitions?pageSize=100"))).GetProperty("items").GetArrayLength().ShouldBe(100);
    }

    private async Task<int> StatementsAsync(HttpClient http, string url)
    {
        await Ok(await http.GetAsync(url));
        _commands.Clear();
        await Ok(await http.GetAsync(url));
        return _commands.Snapshot().Count;
    }

    // ---- helpers

    private async Task PublishWithStepAsync(int workflowId, int draftId)
    {
        var version = await Ok(await _h.Admin.GetAsync($"/api/v1/workflows/{workflowId}/versions/{draftId}"));
        var saved = await Ok(await _h.Admin.PutAsJsonAsync(
            $"/api/v1/workflows/{workflowId}/versions/{draftId}",
            new { isOrdered = true, steps = new[] { new { sourceStepDefinitionId = _stepB, isSkippable = false, skipCommentRequired = false } }, rowVersion = version.GetProperty("version").GetProperty("rowVersion").GetString() }));
        await Ok(await _h.Admin.PostAsJsonAsync(
            $"/api/v1/workflows/{workflowId}/versions/{draftId}/publish",
            new { rowVersion = saved.GetProperty("version").GetProperty("rowVersion").GetString() }));
    }

    private async Task SaveDraftFieldsAsync(int stepId, string fieldsJson)
    {
        var step = await Ok(await _h.Admin.GetAsync($"/api/v1/step-definitions/{stepId}"));
        var definitionId = step.GetProperty("formDefinitionId").GetInt32();
        var draft = await Ok(await _h.Admin.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}")), HttpStatusCode.Created);
        var versionId = draft.GetProperty("version").GetProperty("formVersionId").GetInt32();
        (await FormDraftApi.SaveAsync(_h.Admin, definitionId, versionId, fieldsJson)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    private async Task SaveAndPublishFieldsAsync(int definitionId)
    {
        var draft = await Ok(await _h.Admin.PostAsync($"/api/v1/forms/{definitionId}/versions", Json("{}")), HttpStatusCode.Created);
        var versionId = draft.GetProperty("version").GetProperty("formVersionId").GetInt32();
        (await FormDraftApi.SaveAsync(_h.Admin, definitionId, versionId, """{"fields":[{"key":"n","label":"N","control":"TEXT"}]}""")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await FormDraftApi.PublishAsync(_h.Admin, definitionId, versionId)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    private async Task DeactivateStepAsync(int stepId)
    {
        var step = await Ok(await _h.Admin.GetAsync($"/api/v1/step-definitions/{stepId}"));
        await Ok(await _h.Admin.PostAsJsonAsync($"/api/v1/step-definitions/{stepId}/deactivate", new { rowVersion = step.GetProperty("rowVersion").GetString() }));
    }
}
