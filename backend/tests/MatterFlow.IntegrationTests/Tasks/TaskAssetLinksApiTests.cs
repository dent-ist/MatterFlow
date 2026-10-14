using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.WorkManagement.Domain;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.PanelAssert;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>Task-Asset links with relationship roles (ticket 45, SCN-016): same-Matter rule, duplicates, inactive assets, closed Tasks, audit, permissions.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskAssetLinksApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;
    private int _typeId;
    private int _counter;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
        var type = await OkAsync(await _h.Admin.PostAsJsonAsync("/api/v1/asset-types", new { name = "Laptop" }), HttpStatusCode.Created);
        _typeId = type.GetProperty("assetTypeId").GetInt32();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    /// <summary>A well-formed row version for requests rejected before the concurrency check (the token is mandatory, SEC-09).</summary>
    private const string AnyRowVersion = "AAAAAAAAB9E=";

    private static string Url(long taskId, int? assetId = null) => $"/api/v1/tasks/{taskId}/assets" + (assetId is null ? string.Empty : $"/{assetId}");

    private async Task<int> CreateAssetAsync(int matterId, string? name = null)
    {
        var asset = await OkAsync(
            await _h.Admin.PostAsJsonAsync("/api/v1/assets", new { matterId, assetTypeId = _typeId, displayName = name ?? $"Laptop {++_counter}" }),
            HttpStatusCode.Created);
        return asset.GetProperty("assetId").GetInt32();
    }

    private async Task<Dictionary<string, int>> RolesAsync()
    {
        var roles = await OkAsync(await _h.Admin.GetAsync("/api/v1/asset-link-roles"));
        return roles.EnumerateArray().ToDictionary(r => r.GetProperty("name").GetString()!, r => r.GetProperty("id").GetInt32());
    }

    private Task<HttpResponseMessage> LinkAsync(long taskId, int assetId, int? roleId = null, HttpClient? client = null) =>
        (client ?? _h.Admin).PostAsJsonAsync(Url(taskId), new { assetId, assetLinkRoleId = roleId });

    private async Task<JsonElement[]> LinksAsync(long taskId)
    {
        var list = await OkAsync(await _h.Admin.GetAsync(Url(taskId)));
        return [.. list.GetProperty("items").EnumerateArray()];
    }

    [Fact]
    public async Task Scn016_links_inside_the_matter_work_and_another_matters_asset_is_rejected()
    {
        var m2 = await _h.CreateMatterAsync("343", "13");
        var task = await _h.CreateTaskAsync(_w);
        var taskId = TaskId(task);
        var roles = await RolesAsync();
        var a1 = await CreateAssetAsync(_w.MatterId, "A1");
        var a2 = await CreateAssetAsync(_w.MatterId, "A2");
        var b1 = await CreateAssetAsync(m2, "B1");

        var first = await OkAsync(await LinkAsync(taskId, a1, roles["Source"]), HttpStatusCode.Created);
        first.GetProperty("assetLinkRoleName").GetString().ShouldBe("Source");
        first.GetProperty("displayName").GetString().ShouldBe("A1");
        first.GetProperty("assetTypeName").GetString().ShouldBe("Laptop");
        first.GetProperty("linkedBy").GetProperty("displayName").GetString().ShouldNotBeNullOrWhiteSpace();
        await OkAsync(await LinkAsync(taskId, a2), HttpStatusCode.Created);

        var cross = await ProblemAsync(await LinkAsync(taskId, b1, roles["Destination"]), HttpStatusCode.Conflict, "CROSS_MATTER_REFERENCE");
        cross.GetProperty("detail").GetString().ShouldNotBeNullOrWhiteSpace();

        var links = await LinksAsync(taskId);
        links.Select(l => l.GetProperty("displayName").GetString()).ShouldBe(["A2", "A1"]);
        links.Single(l => l.GetProperty("displayName").GetString() == "A2").GetProperty("assetLinkRoleId").ValueKind.ShouldBe(JsonValueKind.Null);

        // The composite foreign keys block a raw insert of a cross-Matter link as well.
        var raw = await Should.ThrowAsync<Exception>(() => _h.ExecuteAsync($"INSERT dbo.TaskAsset (TaskId, AssetId, MatterId) VALUES ({taskId}, {b1}, {_w.MatterId})"));
        FindSqlError(raw).ShouldBe(547);
        var rawOtherMatter = await Should.ThrowAsync<Exception>(() => _h.ExecuteAsync($"INSERT dbo.TaskAsset (TaskId, AssetId, MatterId) VALUES ({taskId}, {b1}, {m2})"));
        FindSqlError(rawOtherMatter).ShouldBe(547);
        (await LinksAsync(taskId)).Length.ShouldBe(2);
    }

    private static int FindSqlError(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException!)
        {
            if (e is SqlException sql)
                return sql.Number;
            if (e.InnerException is null)
                break;
        }

        return -1;
    }

    [Fact]
    public async Task Duplicate_inactive_unknown_and_bad_role_links_are_rejected()
    {
        var taskId = TaskId(await _h.CreateTaskAsync(_w));
        var roles = await RolesAsync();
        var asset = await CreateAssetAsync(_w.MatterId);
        await OkAsync(await LinkAsync(taskId, asset), HttpStatusCode.Created);

        await ProblemAsync(await LinkAsync(taskId, asset), HttpStatusCode.Conflict, "ASSET_ALREADY_LINKED");

        var inactive = await CreateAssetAsync(_w.MatterId, "Retired laptop");
        var detail = await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/{inactive}"));
        await OkAsync(await _h.Admin.PostAsJsonAsync($"/api/v1/assets/{inactive}/active", new { isActive = false, rowVersion = detail.GetProperty("rowVersion").GetString() }));
        await ProblemAsync(await LinkAsync(taskId, inactive), HttpStatusCode.Conflict, "ASSET_INACTIVE");

        await ProblemAsync(await LinkAsync(taskId, 999_999), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        var another = await CreateAssetAsync(_w.MatterId);
        await ProblemAsync(await LinkAsync(taskId, another, 999_999), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.PostAsJsonAsync("/api/v1/tasks/999999/assets", new { assetId = asset }), HttpStatusCode.NotFound, "NOT_FOUND");

        var deactivatedRole = await OkAsync(await _h.Admin.GetAsync("/api/v1/asset-link-roles"));
        var result = deactivatedRole.EnumerateArray().Single(r => r.GetProperty("name").GetString() == "Result");
        await OkAsync(await _h.Admin.PutAsJsonAsync($"/api/v1/asset-link-roles/{roles["Result"]}", new { name = "Result", isActive = false, rowVersion = result.GetProperty("rowVersion").GetString() }));
        await ProblemAsync(await LinkAsync(taskId, another, roles["Result"]), HttpStatusCode.BadRequest, "VALIDATION_FAILED");

        (await LinksAsync(taskId)).Length.ShouldBe(1);
    }

    [Fact]
    public async Task Role_can_be_changed_and_cleared_and_the_link_removed_with_audit()
    {
        var task = await _h.CreateTaskAsync(_w);
        var taskId = TaskId(task);
        var roles = await RolesAsync();
        var asset = await CreateAssetAsync(_w.MatterId, "Evidence drive");
        var link = await OkAsync(await LinkAsync(taskId, asset, roles["Source"]), HttpStatusCode.Created);

        var changed = await OkAsync(await _h.Admin.PutAsJsonAsync(Url(taskId, asset), new { assetLinkRoleId = roles["Destination"], rowVersion = link.GetProperty("rowVersion").GetString() }));
        changed.GetProperty("assetLinkRoleName").GetString().ShouldBe("Destination");

        await ProblemAsync(
            await _h.Admin.PutAsJsonAsync(Url(taskId, asset), new { assetLinkRoleId = roles["Subject"], rowVersion = link.GetProperty("rowVersion").GetString() }),
            HttpStatusCode.Conflict,
            "CONCURRENCY_CONFLICT");

        var cleared = await OkAsync(await _h.Admin.PutAsJsonAsync(Url(taskId, asset), new { assetLinkRoleId = (int?)null, rowVersion = changed.GetProperty("rowVersion").GetString() }));
        cleared.GetProperty("assetLinkRoleId").ValueKind.ShouldBe(JsonValueKind.Null);
        await ProblemAsync(await _h.Admin.PutAsJsonAsync(Url(taskId, asset), new { assetLinkRoleId = 999_999, rowVersion = cleared.GetProperty("rowVersion").GetString() }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await ProblemAsync(await _h.Admin.PutAsJsonAsync(Url(taskId, 424_242), new { assetLinkRoleId = roles["Source"], rowVersion = cleared.GetProperty("rowVersion").GetString() }), HttpStatusCode.NotFound, "NOT_FOUND");

        (await _h.Admin.DeleteAsync(Url(taskId, asset))).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await LinksAsync(taskId)).ShouldBeEmpty();
        await ProblemAsync(await _h.Admin.DeleteAsync(Url(taskId, asset)), HttpStatusCode.NotFound, "NOT_FOUND");

        var audit = (await _h.AuditAsync(taskId)).Where(a => a.EventType.StartsWith("TASK_ASSET_", StringComparison.Ordinal)).ToList();
        audit.Select(a => a.EventType).ShouldBe(["TASK_ASSET_LINKED", "TASK_ASSET_ROLE_CHANGED", "TASK_ASSET_ROLE_CHANGED", "TASK_ASSET_UNLINKED"]);
        audit[0].NewValue.ShouldBe("Source");
        audit[0].ObjectId.ShouldBe($"{taskId}:{asset}");
        audit[0].Summary.ShouldBe("Linked asset 'Evidence drive' as Source");
        audit[1].OldValue.ShouldBe("Source");
        audit[1].NewValue.ShouldBe("Destination");
        audit[3].Summary.ShouldBe("Unlinked asset 'Evidence drive'");
    }

    [Theory]
    [InlineData("COMPLETED")]
    [InlineData("CANCELLED")]
    public async Task Closed_tasks_refuse_link_changes_but_still_list_them(string status)
    {
        var open = await _h.CreateTaskAsync(_w, ordered: false);
        var roles = await RolesAsync();
        var linked = await CreateAssetAsync(_w.MatterId, "Linked before close");
        var spare = await CreateAssetAsync(_w.MatterId, "Spare");
        await OkAsync(await LinkAsync(TaskId(open), linked, roles["Source"]), HttpStatusCode.Created);
        var closed = status == "COMPLETED" ? await _h.CompleteAsync(open) : await _h.StatusAsync(open, "CANCELLED", "Not needed");
        var taskId = TaskId(closed);

        var problem = await ProblemAsync(await LinkAsync(taskId, spare), HttpStatusCode.Conflict, "TASK_NOT_EDITABLE");
        problem.GetProperty("meta").GetProperty("taskStatus").GetString().ShouldBe(status);
        await ProblemAsync(await _h.Admin.PutAsJsonAsync(Url(taskId, linked), new { assetLinkRoleId = roles["Result"], rowVersion = AnyRowVersion }), HttpStatusCode.Conflict, "TASK_NOT_EDITABLE");
        await ProblemAsync(await _h.Admin.DeleteAsync(Url(taskId, linked)), HttpStatusCode.Conflict, "TASK_NOT_EDITABLE");

        var list = await OkAsync(await _h.Admin.GetAsync(Url(taskId)));
        list.GetProperty("canEdit").GetBoolean().ShouldBeFalse();
        list.GetProperty("items").EnumerateArray().Single().GetProperty("assetLinkRoleName").GetString().ShouldBe("Source");

        // Reopening makes the links editable again.
        var reopened = await _h.PostAsync(taskId, "reopen", new { rowVersion = RowVersion(closed) });
        Status(reopened).ShouldBe("IN_PROGRESS");
        await OkAsync(await LinkAsync(taskId, spare), HttpStatusCode.Created);
    }

    [Fact]
    public async Task On_hold_and_new_tasks_accept_links_and_report_can_edit()
    {
        var onHold = await _h.ReachAsync(_w, "ON_HOLD");
        var asset = await CreateAssetAsync(_w.MatterId);
        await OkAsync(await LinkAsync(TaskId(onHold), asset), HttpStatusCode.Created);

        (await OkAsync(await _h.Admin.GetAsync(Url(TaskId(onHold))))).GetProperty("canEdit").GetBoolean().ShouldBeTrue();
        var fresh = await _h.CreateTaskAsync(_w);
        await OkAsync(await LinkAsync(TaskId(fresh), asset), HttpStatusCode.Created);
    }

    [Fact]
    public async Task Linking_needs_asset_link_and_task_edit_and_reading_needs_task_view()
    {
        var taskId = TaskId(await _h.CreateTaskAsync(_w));
        var asset = await CreateAssetAsync(_w.MatterId);
        var link = await OkAsync(await LinkAsync(taskId, asset), HttpStatusCode.Created);
        var spare = await CreateAssetAsync(_w.MatterId);

        var nothing = await _h.UserWithAsync(@"KE\nothing");
        var viewer = await _h.UserWithAsync(@"KE\viewer", "Task.View");
        var onlyLink = await _h.UserWithAsync(@"KE\onlylink", "Task.View", "Asset.Link");
        var onlyEdit = await _h.UserWithAsync(@"KE\onlyedit", "Task.View", "Task.Edit");
        var allBut = await _h.UserWithAsync(@"KE\allbut", AllTaskPermissions.Where(p => p != "Task.Edit").Append("Asset.Link").ToArray());
        var both = await _h.UserWithAsync(@"KE\both", "Task.View", "Task.Edit", "Asset.Link");

        await ForbiddenAsync(await nothing.GetAsync(Url(taskId)));
        foreach (var client in new[] { nothing, viewer, onlyEdit, onlyLink, allBut })
        {
            await ForbiddenAsync(await LinkAsync(taskId, spare, null, client));
            await ForbiddenAsync(await client.PutAsJsonAsync(Url(taskId, asset), new { assetLinkRoleId = (int?)null, rowVersion = AnyRowVersion }));
            await ForbiddenAsync(await client.DeleteAsync(Url(taskId, asset)));
        }

        (await viewer.GetAsync(Url(taskId))).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await OkAsync(await viewer.GetAsync(Url(taskId)))).GetProperty("canEdit").GetBoolean().ShouldBeFalse();
        (await OkAsync(await both.GetAsync(Url(taskId)))).GetProperty("canEdit").GetBoolean().ShouldBeTrue();
        (await LinkAsync(taskId, spare, null, both)).StatusCode.ShouldBe(HttpStatusCode.Created);
        link.GetProperty("assetId").GetInt32().ShouldBe(asset);
        (await _factory.CreateClient().GetAsync(Url(taskId))).StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task The_asset_shows_its_linked_tasks_and_a_role_in_use_cannot_be_deleted()
    {
        var roles = await RolesAsync();
        var t1 = await _h.CreateTaskAsync(_w);
        var t2 = await _h.CreateTaskAsync(_w);
        var asset = await CreateAssetAsync(_w.MatterId, "Shared drive");
        await OkAsync(await LinkAsync(TaskId(t1), asset, roles["Source"]), HttpStatusCode.Created);
        await OkAsync(await LinkAsync(TaskId(t2), asset), HttpStatusCode.Created);

        var linked = await OkAsync(await _h.Admin.GetAsync($"/api/v1/assets/{asset}/linked-tasks"));
        var items = linked.GetProperty("items").EnumerateArray().ToArray();
        items.Select(i => i.GetProperty("taskId").GetInt64()).ShouldBe([TaskId(t2), TaskId(t1)]);
        items[1].GetProperty("assetLinkRoleName").GetString().ShouldBe("Source");
        items[1].GetProperty("taskNumber").GetString().ShouldStartWith("TSK-");
        items[1].GetProperty("statusCode").GetString().ShouldBe("NEW");
        items[0].GetProperty("assetLinkRoleName").ValueKind.ShouldBe(JsonValueKind.Null);

        await ProblemAsync(await _h.Admin.GetAsync("/api/v1/assets/999999/linked-tasks"), HttpStatusCode.NotFound, "NOT_FOUND");
        var noAssetView = await _h.UserWithAsync(@"KE\noassets", "Task.View");
        await ForbiddenAsync(await noAssetView.GetAsync($"/api/v1/assets/{asset}/linked-tasks"));

        var inUse = await _h.Admin.DeleteAsync($"/api/v1/asset-link-roles/{roles["Source"]}");
        inUse.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await _factory.CountAsync<TaskAsset>()).ShouldBe(2);
    }
}
