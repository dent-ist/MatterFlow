using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>The report admin API: categories, list, create, save with If-Match, versions, compare, restore, no delete (epic #671, issue #708).</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportAdminApiTests(SqlServerFixture sql)
{
    private const string Base = "/api/v1/report-admin";
    private const string Hundred = "SELECT TOP (100) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b";

    private static StringContent Body(object value) => ReportTestHarness.Json(value);

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>();

    private static HttpRequestMessage Request(HttpMethod method, string url, object? body = null, string? ifMatch = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (body is not null)
            request.Content = Body(body);
        if (ifMatch is not null)
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return request;
    }

    private static async Task<int> NewCategoryAsync(HttpClient manager, string name = "Task follow-up", int sort = 1)
    {
        var response = await manager.PostAsync($"{Base}/categories", Body(new { name, sortOrder = sort }));
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (await ReadAsync(response)).GetProperty("categoryId").GetInt32();
    }

    private static object NewReport(int categoryId, string name = "Overdue tasks", string sqlText = "SELECT 1 AS one", object? parameters = null) =>
        new { name, categoryId, description = "Tasks past due", helpText = "Help", sortOrder = 2, timeoutSeconds = 30, maxRows = 1000, sql = sqlText, parameters = parameters ?? Array.Empty<object>(), changeNote = "First" };

    private static async Task<(int Id, string RowVersion)> CreateAsync(HttpClient manager, int categoryId, string name = "Overdue tasks", string sqlText = "SELECT 1 AS one", object? parameters = null)
    {
        var response = await manager.PostAsync($"{Base}/reports", Body(NewReport(categoryId, name, sqlText, parameters)));
        response.StatusCode.ShouldBe(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        var body = await ReadAsync(response);
        return (body.GetProperty("reportId").GetInt32(), body.GetProperty("rowVersion").GetString()!);
    }

    private static object Edit(int categoryId, string name = "Overdue tasks", string? sqlText = "SELECT 1 AS one", object? parameters = null, bool keepActive = false, string? note = null) =>
        new { name, categoryId, description = "Tasks past due", helpText = "Help", sortOrder = 2, timeoutSeconds = 30, maxRows = 1000, sql = sqlText, parameters = parameters ?? Array.Empty<object>(), changeNote = note, keepActive };

    [Fact]
    public async Task A_report_is_created_inactive_with_version_one_and_the_audit_event()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = await NewCategoryAsync(manager);

        var (id, rowVersion) = await CreateAsync(manager, category);

        var detail = await ReadAsync(await manager.GetAsync($"{Base}/reports/{id}"));
        detail.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        detail.GetProperty("versionNo").GetInt32().ShouldBe(1);
        detail.GetProperty("sql").GetString().ShouldBe("SELECT 1 AS one");
        detail.GetProperty("name").GetString().ShouldBe("Overdue tasks");
        detail.GetProperty("categoryName").GetString().ShouldBe("Task follow-up");
        detail.GetProperty("canActivate").GetBoolean().ShouldBeFalse();
        detail.GetProperty("rowVersion").GetString().ShouldBe(rowVersion);
        var events = await h.AuditAsync(id);
        ReportTestHarness.EventTypes(events).ShouldBe(["REPORT_CREATED"]);
        events[0].GetProperty("Summary").GetString()!.ShouldContain("Overdue tasks");

        var etag = (await manager.GetAsync($"{Base}/reports/{id}")).Headers.ETag;
        etag!.Tag.ShouldBe($"\"{rowVersion}\"");
    }

    [Fact]
    public async Task Create_refuses_bad_input_with_field_errors_and_duplicate_names()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = await NewCategoryAsync(manager);
        await CreateAsync(manager, category);

        var duplicate = await manager.PostAsync($"{Base}/reports", Body(NewReport(category)));
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(duplicate)).GetProperty("code").GetString().ShouldBe("DUPLICATE_NAME");

        var empty = await manager.PostAsync($"{Base}/reports", Body(new { name = " ", categoryId = category, sql = "", sortOrder = 0, timeoutSeconds = 9999 }));
        empty.StatusCode.ShouldBe((HttpStatusCode)422);
        var errors = (await ReadAsync(empty)).GetProperty("errors");
        errors.TryGetProperty("name", out _).ShouldBeTrue();
        errors.TryGetProperty("sql", out _).ShouldBeTrue();
        errors.TryGetProperty("timeoutSeconds", out _).ShouldBeTrue();

        var unknownCategory = await manager.PostAsync($"{Base}/reports", Body(NewReport(9999, "Other")));
        unknownCategory.StatusCode.ShouldBe((HttpStatusCode)422);
        (await ReadAsync(unknownCategory)).GetProperty("code").GetString().ShouldBe("CATEGORY_INVALID");

        var reserved = await manager.PostAsync($"{Base}/reports", Body(NewReport(category, "Reserved", "SELECT :TODAY", new[] { new { name = "TODAY", type = "text", label = "Today" } })));
        reserved.StatusCode.ShouldBe((HttpStatusCode)422);
        (await ReadAsync(reserved)).GetProperty("errors").TryGetProperty("parameters.TODAY.name", out _).ShouldBeTrue();
    }

    [Fact]
    public async Task Every_save_with_new_content_creates_a_version_and_identical_content_does_not()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = await NewCategoryAsync(manager);
        var (id, rowVersion) = await CreateAsync(manager, category);

        var same = await ReadAsync(await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(category), $"\"{rowVersion}\"")));
        same.GetProperty("unchanged").GetBoolean().ShouldBeTrue();
        same.GetProperty("versionNo").GetInt32().ShouldBe(1);
        same.GetProperty("rowVersion").GetString().ShouldBe(rowVersion);

        var saved = await ReadAsync(await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(category, sqlText: "SELECT 2 AS two", note: "Second"), rowVersion)));
        saved.GetProperty("unchanged").GetBoolean().ShouldBeFalse();
        saved.GetProperty("versionNo").GetInt32().ShouldBe(2);
        var newRowVersion = saved.GetProperty("rowVersion").GetString()!;
        newRowVersion.ShouldNotBe(rowVersion);

        var versions = await ReadAsync(await manager.GetAsync($"{Base}/reports/{id}/versions"));
        versions.EnumerateArray().Select(v => v.GetProperty("versionNo").GetInt32()).ShouldBe([2, 1]);
        versions[0].GetProperty("isCurrent").GetBoolean().ShouldBeTrue();
        versions[0].GetProperty("changeNote").GetString().ShouldBe("Second");
        ReportTestHarness.EventTypes(await h.AuditAsync(id)).ShouldBe(["REPORT_CREATED", "REPORT_UPDATED"]);
    }

    [Fact]
    public async Task A_concurrent_edit_gives_CONCURRENCY_CONFLICT_and_a_missing_If_Match_is_refused()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = await NewCategoryAsync(manager);
        var (id, rowVersion) = await CreateAsync(manager, category);
        (await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(category, sqlText: "SELECT 2 AS two"), rowVersion))).StatusCode.ShouldBe(HttpStatusCode.OK);

        var stale = await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(category, sqlText: "SELECT 3 AS three"), rowVersion));
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(stale)).GetProperty("code").GetString().ShouldBe("CONCURRENCY_CONFLICT");

        var missing = await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(category)));
        missing.StatusCode.ShouldBe((HttpStatusCode)428);
        (await ReadAsync(missing)).GetProperty("code").GetString().ShouldBe("IF_MATCH_REQUIRED");

        var garbage = await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(category), "not base64!"));
        garbage.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        (await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/9999", Edit(category), rowVersion))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await ReadAsync(await manager.GetAsync($"{Base}/reports/{id}"))).GetProperty("versionNo").GetInt32().ShouldBe(2);
    }

    [Fact]
    public async Task Changing_only_the_details_writes_no_version_but_audits_the_change_and_a_category_move()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var first = await NewCategoryAsync(manager);
        var second = await NewCategoryAsync(manager, "Finance", 2);
        var (id, rowVersion) = await CreateAsync(manager, first);
        var (_, _) = await CreateAsync(manager, first, "Taken name");

        var renamed = await ReadAsync(await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(second, "Renamed"), rowVersion)));

        renamed.GetProperty("versionNo").GetInt32().ShouldBe(1);
        renamed.GetProperty("unchanged").GetBoolean().ShouldBeTrue();
        var detail = await ReadAsync(await manager.GetAsync($"{Base}/reports/{id}"));
        detail.GetProperty("name").GetString().ShouldBe("Renamed");
        detail.GetProperty("categoryName").GetString().ShouldBe("Finance");
        var events = await h.AuditAsync(id);
        ReportTestHarness.EventTypes(events).ShouldBe(["REPORT_CREATED", "REPORT_CATEGORY_CHANGED", "REPORT_UPDATED"]);
        events[1].GetProperty("OldValue").GetString().ShouldBe("Task follow-up");
        events[1].GetProperty("NewValue").GetString().ShouldBe("Finance");
        events[2].GetProperty("NewValue").GetString().ShouldBe("name");

        var clash = await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(second, "Taken name"), renamed.GetProperty("rowVersion").GetString()));
        clash.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(clash)).GetProperty("code").GetString().ShouldBe("DUPLICATE_NAME");
    }

    [Fact]
    public async Task A_new_version_of_an_active_report_deactivates_it_unless_it_is_previewed_in_the_same_save()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = await NewCategoryAsync(manager);
        var (id, rowVersion) = await CreateAsync(manager, category, sqlText: Hundred);
        var preview = await ReadAsync(await manager.PostAsync($"{Base}/reports/{id}/preview", Body(new { })));
        preview.GetProperty("countsForActivation").GetBoolean().ShouldBeTrue();
        var active = await ReadAsync(await manager.PostAsync($"{Base}/reports/{id}/activate", null));
        rowVersion = active.GetProperty("rowVersion").GetString()!;

        var kept = await ReadAsync(await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(category, sqlText: Hundred + " /* v2 */", keepActive: true), rowVersion)));
        kept.GetProperty("isActive").GetBoolean().ShouldBeTrue();
        kept.GetProperty("deactivated").GetBoolean().ShouldBeFalse();
        kept.GetProperty("preview").GetProperty("success").GetBoolean().ShouldBeTrue();

        var dropped = await ReadAsync(await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(category, sqlText: Hundred + " /* v3 */"), kept.GetProperty("rowVersion").GetString())));
        dropped.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        dropped.GetProperty("deactivated").GetBoolean().ShouldBeTrue();
        ReportTestHarness.EventTypes(await h.AuditAsync(id)).ShouldContain("REPORT_DEACTIVATED");

        var failing = await manager.PostAsync($"{Base}/reports/{id}/activate", null);
        failing.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Versions_can_be_read_compared_and_restored_as_a_new_version_that_needs_a_new_preview()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = await NewCategoryAsync(manager);
        var (id, rowVersion) = await CreateAsync(manager, category, sqlText: Hundred);
        await manager.PostAsync($"{Base}/reports/{id}/preview", Body(new { }));
        rowVersion = (await ReadAsync(await manager.PostAsync($"{Base}/reports/{id}/activate", null))).GetProperty("rowVersion").GetString()!;
        var v2 = await ReadAsync(await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(category, sqlText: "SELECT 1 AS a\nUNION ALL SELECT 2", note: "Two rows"), rowVersion)));
        rowVersion = v2.GetProperty("rowVersion").GetString()!;

        var version1 = await ReadAsync(await manager.GetAsync($"{Base}/reports/{id}/versions/1"));
        version1.GetProperty("sql").GetString().ShouldBe(Hundred);
        version1.GetProperty("version").GetProperty("isCurrent").GetBoolean().ShouldBeFalse();

        var diff = await ReadAsync(await manager.GetAsync($"{Base}/reports/{id}/versions/2/compare"));
        diff.GetProperty("fromVersionNo").GetInt32().ShouldBe(1);
        diff.GetProperty("toVersionNo").GetInt32().ShouldBe(2);
        diff.GetProperty("sql").EnumerateArray().Select(l => l.GetProperty("kind").GetString()).ShouldBe(["removed", "added", "added"]);

        (await manager.PostAsync($"{Base}/reports/{id}/versions/2/restore", null)).StatusCode.ShouldBe((HttpStatusCode)428);
        var stale = await manager.SendAsync(Request(HttpMethod.Post, $"{Base}/reports/{id}/versions/1/restore", null, "\"" + Convert.ToBase64String(new byte[8]) + "\""));
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        var current = await manager.SendAsync(Request(HttpMethod.Post, $"{Base}/reports/{id}/versions/2/restore", null, rowVersion));
        current.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(current)).GetProperty("code").GetString().ShouldBe("ALREADY_CURRENT");
        (await manager.SendAsync(Request(HttpMethod.Post, $"{Base}/reports/{id}/versions/9/restore", null, rowVersion))).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var restored = await ReadAsync(await manager.SendAsync(Request(HttpMethod.Post, $"{Base}/reports/{id}/versions/1/restore", null, rowVersion)));
        restored.GetProperty("versionNo").GetInt32().ShouldBe(3);
        restored.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        var detail = await ReadAsync(await manager.GetAsync($"{Base}/reports/{id}"));
        detail.GetProperty("sql").GetString().ShouldBe(Hundred);
        detail.GetProperty("changeNote").GetString().ShouldBe("Restored version 1");
        (await ReadAsync(await manager.GetAsync($"{Base}/reports/{id}/versions"))).GetArrayLength().ShouldBe(3);
        (await manager.PostAsync($"{Base}/reports/{id}/activate", null)).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        var events = await h.AuditAsync(id);
        ReportTestHarness.EventTypes(events).ShouldContain("REPORT_VERSION_RESTORED");
        events.Single(e => e.GetProperty("EventType").GetString() == "REPORT_VERSION_RESTORED").GetProperty("Summary").GetString()!.ShouldContain("version 1 restored as version 3");
    }

    [Fact]
    public async Task There_is_no_way_to_delete_a_report_or_a_category()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = await NewCategoryAsync(manager);
        var (id, _) = await CreateAsync(manager, category);

        foreach (var url in new[] { $"{Base}/reports/{id}", $"{Base}/categories/{category}", $"{Base}/reports/{id}/versions/1", $"{Base}/reports/{id}/versions" })
            ((int)(await manager.DeleteAsync(url)).StatusCode).ShouldBeInRange(400, 499);

        (await manager.GetAsync($"{Base}/reports/{id}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var version = await h.Tasks.Admin.GetAsync($"{Base}/reports/{id}/versions");
        (await ReadAsync(version)).GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task Versions_stay_append_only_in_the_database()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = await NewCategoryAsync(manager);
        var (id, _) = await CreateAsync(manager, category);

        var ex = await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ExecuteAsync(h.AppConnection, $"UPDATE dbo.ReportVersion SET SqlText = N'SELECT 666' WHERE ReportId = {id}"));
        ex.Message.ShouldContain("append-only");
    }

    [Fact]
    public async Task Categories_can_be_created_renamed_reordered_and_deactivated_with_a_row_version_and_audit()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var created = await ReadAsync(await manager.PostAsync($"{Base}/categories", Body(new { name = "Finance", sortOrder = 5 })));
        var id = created.GetProperty("categoryId").GetInt32();
        var rowVersion = created.GetProperty("rowVersion").GetString()!;
        (await manager.PostAsync($"{Base}/categories", Body(new { name = "Finance", sortOrder = 1 }))).StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await manager.PostAsync($"{Base}/categories", Body(new { name = "", sortOrder = 1 }))).StatusCode.ShouldBe((HttpStatusCode)422);

        var updated = await ReadAsync(await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/categories/{id}", new { name = "Finance & billing", sortOrder = 1, isActive = true }, rowVersion)));
        updated.GetProperty("name").GetString().ShouldBe("Finance & billing");
        var stale = await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/categories/{id}", new { name = "Other", sortOrder = 1, isActive = false }, rowVersion));
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(stale)).GetProperty("code").GetString().ShouldBe("CONCURRENCY_CONFLICT");
        (await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/categories/{id}", new { name = "x", sortOrder = 1, isActive = true }))).StatusCode.ShouldBe((HttpStatusCode)428);

        var off = await ReadAsync(await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/categories/{id}", new { name = "Finance & billing", sortOrder = 1, isActive = false }, updated.GetProperty("rowVersion").GetString())));
        off.GetProperty("isActive").GetBoolean().ShouldBeFalse();
        var inactiveCategory = await manager.PostAsync($"{Base}/reports", Body(NewReport(id)));
        inactiveCategory.StatusCode.ShouldBe((HttpStatusCode)422);

        var list = await ReadAsync(await manager.GetAsync($"{Base}/categories"));
        list.EnumerateArray().Select(c => c.GetProperty("name").GetString()).ShouldBe(["Finance & billing"]);
        var events = await h.AuditAsync(id, "ReportCategory");
        ReportTestHarness.EventTypes(events).ShouldBe(["REPORT_CATEGORY_CHANGED", "REPORT_CATEGORY_CHANGED", "REPORT_CATEGORY_CHANGED"]);
        events[1].GetProperty("Summary").GetString()!.ShouldContain("renamed from 'Finance'");
    }

    [Fact]
    public async Task The_list_filters_by_status_category_and_search_and_shows_counts()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var a = await NewCategoryAsync(manager, "Alpha", 1);
        var b = await NewCategoryAsync(manager, "Beta", 2);
        var (r1, _) = await CreateAsync(manager, a, "Overdue tasks", Hundred);
        await CreateAsync(manager, b, "Open 100% items");
        await manager.PostAsync($"{Base}/reports/{r1}/preview", Body(new { }));
        await manager.PostAsync($"{Base}/reports/{r1}/activate", null);

        async Task<string[]> Names(string query) =>
            (await ReadAsync(await manager.GetAsync($"{Base}/reports{query}"))).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("name").GetString()!).ToArray();

        (await Names("")).ShouldBe(["Overdue tasks", "Open 100% items"]);
        (await Names("?status=active")).ShouldBe(["Overdue tasks"]);
        (await Names("?status=inactive")).ShouldBe(["Open 100% items"]);
        (await Names($"?categoryId={b}")).ShouldBe(["Open 100% items"]);
        (await Names("?search=overdue")).ShouldBe(["Overdue tasks"]);
        (await Names("?search=100%25")).ShouldBe(["Open 100% items"]);
        (await Names("?search=%25")).ShouldBe(["Open 100% items"]);
        (await Names("?search=beta")).ShouldBe(["Open 100% items"]);

        var first = (await ReadAsync(await manager.GetAsync($"{Base}/reports?search=overdue"))).GetProperty("items")[0];
        first.GetProperty("previewed").GetBoolean().ShouldBeTrue();
        first.GetProperty("versionNo").GetInt32().ShouldBe(1);
        first.GetProperty("roleCount").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task Changing_a_choice_list_query_is_audited_without_the_query_text()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = await NewCategoryAsync(manager);
        const string sqlText = "SELECT :KIND AS k";
        object Params(string optionsSql) => new[] { new { name = "KIND", type = "single", label = "Kind", optionsKind = "query", optionsSql } };
        var (id, rowVersion) = await CreateAsync(manager, category, sqlText: sqlText, parameters: Params("SELECT 'a' AS Value, 'secret_marker_a' AS Label"));

        var saved = await ReadAsync(await manager.SendAsync(Request(HttpMethod.Put, $"{Base}/reports/{id}", Edit(category, sqlText: sqlText, parameters: Params("SELECT 'b' AS Value, 'secret_marker_b' AS Label")), rowVersion)));

        saved.GetProperty("versionNo").GetInt32().ShouldBe(2);
        var events = await h.AuditAsync(id);
        ReportTestHarness.EventTypes(events).ShouldBe(["REPORT_CREATED", "REPORT_CHOICE_SQL_CHANGED", "REPORT_UPDATED", "REPORT_PARAMETERS_CHANGED", "REPORT_CHOICE_SQL_CHANGED"]);
        events.ShouldAllBe(e => !e.ToString().Contains("secret_marker"));
        events[4].GetProperty("FieldKey").GetString().ShouldBe("choiceSql:KIND");
    }

    [Fact]
    public async Task A_bad_choice_query_or_unknown_lookup_kind_is_refused_on_save_with_the_parameter_named()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (manager, _) = await h.PersonAsync(@"KE\manager", "Report.Manage");
        var category = await NewCategoryAsync(manager);

        object Create(params object[] parameters) => NewReport(category, "R" + Guid.NewGuid().ToString("N")[..6], "SELECT :A", parameters);

        var writes = await manager.PostAsync($"{Base}/reports", Body(Create(new { name = "A", type = "single", label = "A", optionsKind = "query", optionsSql = "DELETE dbo.Pod" })));
        writes.StatusCode.ShouldBe((HttpStatusCode)422);
        (await ReadAsync(writes)).GetProperty("errors").TryGetProperty("parameters.A.optionsSql", out _).ShouldBeTrue();

        var usesParameter = await manager.PostAsync($"{Base}/reports", Body(Create(new { name = "A", type = "single", label = "A", optionsKind = "query", optionsSql = "SELECT :OTHER AS Value, 'x' AS Label" })));
        usesParameter.StatusCode.ShouldBe((HttpStatusCode)422);

        var noKind = await manager.PostAsync($"{Base}/reports", Body(Create(new { name = "A", type = "lookup", label = "A" })));
        (await ReadAsync(noKind)).GetProperty("errors").TryGetProperty("parameters.A.lookupKind", out _).ShouldBeTrue();

        var tooMany = await manager.PostAsync($"{Base}/reports", Body(Create(new { name = "A", type = "single", label = "A", optionsKind = "fixed", options = Enumerable.Range(0, 201).Select(i => new { value = "v" + i, label = "L" + i }).ToArray() })));
        tooMany.StatusCode.ShouldBe((HttpStatusCode)422);

        var fine = await manager.PostAsync($"{Base}/reports", Body(Create(new { name = "a", type = "single", label = "A", optionsKind = "fixed", options = new[] { new { value = "x", label = "X" } } })));
        fine.StatusCode.ShouldBe(HttpStatusCode.Created);
        var created = (await ReadAsync(fine)).GetProperty("reportId").GetInt32();
        var stored = (await ReadAsync(await manager.GetAsync($"{Base}/reports/{created}"))).GetProperty("parameters")[0];
        stored.GetProperty("name").GetString().ShouldBe("A"); // upper-cased
    }

    public static TheoryData<string, string, string?> Endpoints => new()
    {
        { "GET", "/categories", null },
        { "POST", "/categories", "{\"name\":\"x\"}" },
        { "PUT", "/categories/1", "{\"name\":\"x\"}" },
        { "GET", "/reports", null },
        { "POST", "/reports", "{\"name\":\"x\"}" },
        { "GET", "/reports/1", null },
        { "PUT", "/reports/1", "{\"name\":\"x\"}" },
        { "GET", "/reports/1/versions", null },
        { "GET", "/reports/1/versions/1", null },
        { "GET", "/reports/1/versions/1/compare", null },
        { "POST", "/reports/1/versions/1/restore", null },
        { "POST", "/reports/1/versions", "{\"sql\":\"SELECT 1\"}" },
        { "POST", "/reports/1/preview", "{}" },
        { "POST", "/reports/1/activate", null },
        { "POST", "/reports/1/deactivate", null },
        { "GET", "/reports/1/runs", null },
        { "GET", "/schema", null },
        { "GET", "/schema/Task", null },
        { "POST", "/reports/1/choices/test", "{\"sql\":\"SELECT 1\"}" },
    };

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Every_manage_endpoint_refuses_people_without_Report_Manage(string method, string path, string? body)
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var people = new[]
        {
            (await h.PersonAsync(@"KE\run", "Report.Run")).Client,
            (await h.PersonAsync(@"KE\assign", "Report.Assign")).Client,
            (await h.PersonAsync(@"KE\runassign", "Report.Run", "Report.Assign")).Client,
            (await h.PersonAsync(@"KE\none", "Matter.View")).Client,
        };

        foreach (var person in people)
        {
            var request = new HttpRequestMessage(new HttpMethod(method), Base + path) { Content = body is null ? null : new StringContent(body, Encoding.UTF8, MediaTypeHeaderValue.Parse("application/json")) };
            request.Headers.TryAddWithoutValidation("If-Match", "\"AAAAAAAAB9E=\"");
            (await person.SendAsync(request)).StatusCode.ShouldBe(HttpStatusCode.Forbidden, $"{method} {path}");
        }
    }

    [Fact]
    public async Task Run_permission_and_assignment_do_not_let_a_person_read_definitions()
    {
        await using var h = await ReportTestHarness.StartAsync(sql);
        var (runner, role) = await h.PersonAsync(@"KE\runner", "Report.Run");
        var id = await h.AddReportAsync("SELECT 'secret_marker' AS s", roleIds: role);

        (await runner.GetAsync($"{Base}/reports/{id}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await runner.GetAsync($"{Base}/reports/{id}/versions/1")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await runner.GetAsync($"{Base}/reports")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
