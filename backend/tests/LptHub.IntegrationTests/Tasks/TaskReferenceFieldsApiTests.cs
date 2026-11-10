using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>SEC2-04 (SEC-12 carried over): ASSET_REF and USER_REF values of a Task form must exist, be active, and an Asset must belong to the Task's Matter.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskReferenceFieldsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Form = """
        {"fields":[
          {"key":"source_asset","label":"Source asset","control":"ASSET_REF"},
          {"key":"reviewer","label":"Reviewer","control":"USER_REF"}
        ]}
        """;

    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private int _assetTypeId;
    private int _counter;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        var typeId = await _h.CreateTaskTypeAsync("Referencing", [_w.OrderedWorkflowId], formFieldsJson: Form);
        _w = _w with { TaskTypeId = typeId };
        var type = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created);
        _assetTypeId = type.GetProperty("assetTypeId").GetInt32();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<int> AssetAsync(int matterId)
    {
        var asset = await OkAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId, assetTypeId = _assetTypeId, displayName = $"Laptop {++_counter}" }),
            HttpStatusCode.Created);
        return asset.GetProperty("assetId").GetInt32();
    }

    private Task<HttpResponseMessage> CreateAsync(Dictionary<string, object?> formValues) =>
        _h.Admin.PostAsJsonAsync("/api/v1/tasks", _h.NewTask(_w, extra: new() { ["formValues"] = formValues }));

    private static async Task ShouldRejectAsync(HttpResponseMessage response, string field, string code)
    {
        var problem = await ProblemAsync(response, HttpStatusCode.BadRequest, "FORM_VALIDATION_FAILED");
        problem.GetProperty("errors").GetProperty("form:" + field).EnumerateArray().Select(e => e.GetProperty("code").GetString()).ShouldContain(code);
    }

    [Fact]
    public async Task Create_accepts_an_active_asset_of_the_same_matter_and_an_active_user()
    {
        var asset = await AssetAsync(_w.MatterId);
        var userId = await _h.UserIdAsync(@"KE\director");

        var task = await OkAsync(await CreateAsync(new() { ["source_asset"] = asset, ["reviewer"] = userId }), HttpStatusCode.Created);

        task.GetProperty("formValues").GetProperty("source_asset").GetInt32().ShouldBe(asset);
    }

    [Fact]
    public async Task Create_rejects_an_asset_of_another_matter()
    {
        var other = await _h.CreateMatterAsync("343", "13");
        var foreign = await AssetAsync(other);

        await ShouldRejectAsync(await CreateAsync(new() { ["source_asset"] = foreign }), "source_asset", "CROSS_MATTER_REFERENCE");
        (await _h.ScalarAsync("SELECT COUNT(*) AS Value FROM dbo.Task")).ShouldBe(0);
    }

    [Theory]
    [InlineData(4711)]
    [InlineData(999999)]
    public async Task Create_rejects_a_nonexistent_asset(int id)
    {
        await ShouldRejectAsync(await CreateAsync(new() { ["source_asset"] = id }), "source_asset", "INVALID_REFERENCE");
    }

    [Fact]
    public async Task Create_rejects_an_inactive_asset()
    {
        var asset = await AssetAsync(_w.MatterId);
        var stored = await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/{asset}"));
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/assets/{asset}/active", new { isActive = false, rowVersion = stored.GetProperty("rowVersion").GetString() }));

        await ShouldRejectAsync(await CreateAsync(new() { ["source_asset"] = asset }), "source_asset", "INVALID_REFERENCE");
    }

    [Fact]
    public async Task Create_rejects_a_nonexistent_or_disabled_user()
    {
        await ShouldRejectAsync(await CreateAsync(new() { ["reviewer"] = 987654 }), "reviewer", "INVALID_REFERENCE");

        var userId = await _h.UserIdAsync(@"KE\scientist");
        await _h.ExecuteAsync($"UPDATE dbo.AppUser SET IsActive = 0 WHERE UserId = {userId}");
        await ShouldRejectAsync(await CreateAsync(new() { ["reviewer"] = userId }), "reviewer", "INVALID_REFERENCE");
    }

    [Fact]
    public async Task Update_validates_only_the_changed_reference_fields()
    {
        var asset = await AssetAsync(_w.MatterId);
        var task = await OkAsync(await CreateAsync(new() { ["source_asset"] = asset }), HttpStatusCode.Created);
        var other = await _h.CreateMatterAsync("343", "13");
        var foreign = await AssetAsync(other);

        var response = await _h.Admin.PutAsJsonAsync($"/api/v1/tasks/{TaskId(task)}", UpdateBody(task, new() { ["formValues"] = new Dictionary<string, object?> { ["source_asset"] = foreign } }));
        await ShouldRejectAsync(response, "source_asset", "CROSS_MATTER_REFERENCE");

        // Later the stored asset is deactivated; saving an unrelated change still works because the unchanged value is not re-checked.
        var stored = await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/{asset}"));
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/assets/{asset}/active", new { isActive = false, rowVersion = stored.GetProperty("rowVersion").GetString() }));
        var fresh = await _h.GetTaskAsync(TaskId(task));
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/tasks/{TaskId(fresh)}", UpdateBody(fresh, new() { ["title"] = "Renamed" })));
    }

    private static Dictionary<string, object?> UpdateBody(JsonElement task, Dictionary<string, object?> changes)
    {
        var body = new Dictionary<string, object?>
        {
            ["rowVersion"] = RowVersion(task),
            ["title"] = task.GetProperty("title").GetString(),
            ["description"] = task.GetProperty("description").GetString(),
            ["requestorName"] = task.GetProperty("requestorName").GetString(),
            ["requestorEmail"] = task.GetProperty("requestorEmail").GetString(),
            ["projectId"] = null,
            ["dueDate"] = task.GetProperty("dueDate").GetString(),
        };
        foreach (var (key, value) in changes)
            body[key] = value;

        return body;
    }
}
