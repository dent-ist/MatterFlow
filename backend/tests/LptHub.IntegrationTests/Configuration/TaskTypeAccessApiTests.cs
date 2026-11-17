using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.Audit.Domain;
using LptHub.Configuration.Domain;
using LptHub.IntegrationTests.Fixtures;
using LptHub.IntegrationTests.Tasks;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace LptHub.IntegrationTests.Configuration;

/// <summary>
/// Task Type access by role, data and admin API (epic #1397, issue #1399) against a real SQL Server through the full HTTP pipeline: the three role lists, normalisation,
/// validation, concurrency, audit, the preview, the permission, the role-delete block, and the go-live switch (stored but not enforced).
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class TaskTypeAccessApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private int _director;
    private int _partner;
    private int _associate;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _director = await _factory.CreateRoleAsync("Director Test", "Task.View");
        _partner = await _factory.CreateRoleAsync("Partner Test", "Task.View");
        _associate = await _factory.CreateRoleAsync("Associate Test", "Task.View");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private HttpClient Admin => _h.Admin;

    private async Task<JsonElement> NewTypeAsync(string name) =>
        await TaskHarness.OkAsync(await Admin.PostAsJsonAsync("/api/v1/task-types", new { name }), HttpStatusCode.Created);

    private static int Id(JsonElement type) => type.GetProperty("id").GetInt32();

    private static int[] Ints(JsonElement array) => [.. array.EnumerateArray().Select(e => e.GetInt32())];

    private async Task<JsonElement> GetAccessAsync(int id, HttpClient? client = null) =>
        await TaskHarness.OkAsync(await (client ?? Admin).GetAsync($"/api/v1/task-types/{id}/access"));

    private async Task<HttpResponseMessage> PutAsync(int id, JsonElement current, int[] view, int[] edit, int[] assign, string? rowVersion = null, HttpClient? client = null) =>
        await (client ?? Admin).PutAsJsonAsync($"/api/v1/task-types/{id}/access", new { canView = view, canEdit = edit, canAssign = assign, rowVersion = rowVersion ?? current.GetProperty("rowVersion").GetString() });

    private async Task<List<AuditEvent>> EventsAsync(int typeId) =>
        await _factory.WithDbAsync(db => db.Set<AuditEvent>().Where(e => e.ObjectType == "TaskType" && e.ObjectId == typeId.ToString()).OrderBy(e => e.Id).ToListAsync());

    // ---- default and the lists

    [Fact]
    public async Task A_new_task_type_is_open_to_everyone_and_the_switch_is_off()
    {
        var type = await NewTypeAsync("Open type");

        var access = await GetAccessAsync(Id(type));
        access.GetProperty("isRestricted").GetBoolean().ShouldBeFalse();
        Ints(access.GetProperty("canView")).ShouldBeEmpty();
        Ints(access.GetProperty("canEdit")).ShouldBeEmpty();
        Ints(access.GetProperty("canAssign")).ShouldBeEmpty();
        access.GetProperty("enforced").GetBoolean().ShouldBeFalse("Features:TaskTypeAccess defaults to off");
        type.GetProperty("access").GetProperty("isRestricted").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Saving_the_lists_normalises_edit_and_assign_into_view_flags_the_type_and_shows_on_the_type_itself()
    {
        var type = await NewTypeAsync("Privilege Review");
        var before = await GetAccessAsync(Id(type));

        // Partner may edit and Associate may be assigned, neither is in canView: the server adds them. Director only views.
        var saved = await TaskHarness.OkAsync(await PutAsync(Id(type), before, [_director], [_partner], [_associate]));

        saved.GetProperty("isRestricted").GetBoolean().ShouldBeTrue();
        Ints(saved.GetProperty("canView")).ShouldBe(new[] { _director, _partner, _associate }.Order().ToArray());
        Ints(saved.GetProperty("canEdit")).ShouldBe([_partner]);
        Ints(saved.GetProperty("canAssign")).ShouldBe([_associate]);
        saved.GetProperty("roles").EnumerateArray().Select(r => r.GetProperty("name").GetString()).ShouldBe(["Associate Test", "Director Test", "Partner Test"]);
        saved.GetProperty("rowVersion").GetString().ShouldNotBe(before.GetProperty("rowVersion").GetString());

        var detail = await TaskHarness.OkAsync(await Admin.GetAsync($"/api/v1/task-types/{Id(type)}"));
        detail.GetProperty("access").GetProperty("isRestricted").GetBoolean().ShouldBeTrue();
        Ints(detail.GetProperty("access").GetProperty("canEdit")).ShouldBe([_partner]);
        var list = await TaskHarness.OkAsync(await Admin.GetAsync("/api/v1/task-types"));
        list.EnumerateArray().Single(t => Id(t) == Id(type)).GetProperty("access").GetProperty("canView").GetArrayLength().ShouldBe(3);

        var flag = await _factory.WithDbAsync(db => db.Set<TaskType>().AsNoTracking().Where(t => t.Id == Id(type)).Select(t => t.IsRestricted).SingleAsync());
        flag.ShouldBeTrue();
        (await _factory.WithDbAsync(db => db.Set<TaskTypeRoleAccess>().CountAsync(a => a.TaskTypeId == Id(type)))).ShouldBe(3);
    }

    [Fact]
    public async Task Replacing_the_lists_drops_roles_that_left_changes_flags_and_removing_all_view_roles_opens_the_type_again()
    {
        var type = await NewTypeAsync("Reopened");
        var one = await TaskHarness.OkAsync(await PutAsync(Id(type), await GetAccessAsync(Id(type)), [_director, _partner], [_partner], []));

        var two = await TaskHarness.OkAsync(await PutAsync(Id(type), one, [_director], [], [_director]));
        Ints(two.GetProperty("canView")).ShouldBe([_director]);
        Ints(two.GetProperty("canEdit")).ShouldBeEmpty();
        Ints(two.GetProperty("canAssign")).ShouldBe([_director]);
        two.GetProperty("isRestricted").GetBoolean().ShouldBeTrue();

        var open = await TaskHarness.OkAsync(await PutAsync(Id(type), two, [], [], []));
        open.GetProperty("isRestricted").GetBoolean().ShouldBeFalse();
        (await _factory.WithDbAsync(db => db.Set<TaskTypeRoleAccess>().CountAsync(a => a.TaskTypeId == Id(type)))).ShouldBe(0);
        (await _factory.WithDbAsync(db => db.Set<TaskType>().AsNoTracking().Where(t => t.Id == Id(type)).Select(t => t.IsRestricted).SingleAsync())).ShouldBeFalse();
    }

    [Fact]
    public async Task The_lists_can_be_stored_while_the_switch_is_off_and_the_type_endpoints_still_behave_as_before()
    {
        var type = await NewTypeAsync("Prepared before go-live");
        await TaskHarness.OkAsync(await PutAsync(Id(type), await GetAccessAsync(Id(type)), [_director], [], []));

        // Nothing is enforced yet: a person without any of the roles still reads the type (design: switch off = behaviour exactly as today; the read path is issue #1400).
        var outsider = await _h.UserWithAsync(@"KE\outsider", "Task.View");
        (await outsider.GetAsync($"/api/v1/task-types/{Id(type)}")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await GetAccessAsync(Id(type))).GetProperty("enforced").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task The_switch_is_reported_as_enforced_when_it_is_on()
    {
        await using var on = new DatabaseApiFactory(await sql.CreateDatabaseAsync()) { ExtraSettings = [("Features:TaskTypeAccess", "true")] };
        var admin = new TaskHarness(on).Admin;
        var type = await TaskHarness.OkAsync(await admin.PostAsJsonAsync("/api/v1/task-types", new { name = "Enforced" }), HttpStatusCode.Created);

        (await TaskHarness.OkAsync(await admin.GetAsync($"/api/v1/task-types/{Id(type)}/access"))).GetProperty("enforced").GetBoolean().ShouldBeTrue();
    }

    // ---- validation

    [Fact]
    public async Task Unknown_duplicate_non_positive_and_new_inactive_roles_are_refused_on_the_list_field()
    {
        var type = await NewTypeAsync("Validated");
        var current = await GetAccessAsync(Id(type));

        var unknown = await TaskHarness.ProblemAsync(await PutAsync(Id(type), current, [999999], [], []), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        unknown.GetProperty("errors").GetProperty("canView")[0].GetProperty("code").GetString().ShouldBe("ROLE_NOT_FOUND");

        var duplicate = await TaskHarness.ProblemAsync(await PutAsync(Id(type), current, [_director], [_partner, _partner], []), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        duplicate.GetProperty("errors").GetProperty("canEdit")[0].GetProperty("code").GetString().ShouldBe("DUPLICATE_ROLE");

        var bad = await TaskHarness.ProblemAsync(await PutAsync(Id(type), current, [], [], [0]), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        bad.GetProperty("errors").GetProperty("canAssign")[0].GetProperty("code").GetString().ShouldBe("INVALID");

        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("UPDATE dbo.Role SET IsActive = 0 WHERE RoleId = {0}", _associate));
        var inactive = await TaskHarness.ProblemAsync(await PutAsync(Id(type), current, [_associate], [], []), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        inactive.GetProperty("errors").GetProperty("canView")[0].GetProperty("code").GetString().ShouldBe("ROLE_NOT_FOUND");

        (await GetAccessAsync(Id(type))).GetProperty("isRestricted").GetBoolean().ShouldBeFalse("a refused save changes nothing");
    }

    [Fact]
    public async Task A_role_that_is_deactivated_later_may_stay_in_the_list()
    {
        var type = await NewTypeAsync("Deactivated later");
        var saved = await TaskHarness.OkAsync(await PutAsync(Id(type), await GetAccessAsync(Id(type)), [_director, _partner], [], []));
        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("UPDATE dbo.Role SET IsActive = 0 WHERE RoleId = {0}", _partner));

        var again = await TaskHarness.OkAsync(await PutAsync(Id(type), saved, [_director, _partner], [_director], []));

        Ints(again.GetProperty("canView")).ShouldBe(new[] { _director, _partner }.Order().ToArray());
        again.GetProperty("roles").EnumerateArray().Single(r => r.GetProperty("roleId").GetInt32() == _partner).GetProperty("isActive").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Unknown_task_type_is_not_found_and_a_malformed_row_version_is_a_validation_error()
    {
        await TaskHarness.ProblemAsync(await Admin.GetAsync("/api/v1/task-types/999999/access"), HttpStatusCode.NotFound, "NOT_FOUND");
        var type = await NewTypeAsync("Version");
        await TaskHarness.ProblemAsync(await PutAsync(Id(type), await GetAccessAsync(Id(type)), [], [], [], rowVersion: "not-a-version"), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
    }

    // ---- concurrency

    [Fact]
    public async Task A_stale_row_version_conflicts_and_so_does_a_save_after_the_type_itself_was_edited()
    {
        var type = await NewTypeAsync("Concurrent");
        var first = await GetAccessAsync(Id(type));
        var second = await TaskHarness.OkAsync(await PutAsync(Id(type), first, [_director], [], []));

        await TaskHarness.ProblemAsync(await PutAsync(Id(type), first, [_partner], [], []), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");

        // Renaming the type moves the same row version: the access dialog must reload.
        var rename = await Admin.PutAsJsonAsync($"/api/v1/task-types/{Id(type)}", new
        {
            name = "Concurrent 2",
            description = (string?)null,
            iconKey = type.GetProperty("iconKey").GetString(),
            isActive = true,
            eligibleWorkflowIds = Array.Empty<int>(),
            rowVersion = (await TaskHarness.OkAsync(await Admin.GetAsync($"/api/v1/task-types/{Id(type)}"))).GetProperty("rowVersion").GetString(),
        });
        await TaskHarness.OkAsync(rename);
        await TaskHarness.ProblemAsync(await PutAsync(Id(type), second, [_partner], [], []), HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT");

        // The type edit does not touch the lists.
        Ints((await GetAccessAsync(Id(type))).GetProperty("canView")).ShouldBe([_director]);
    }

    // ---- audit

    [Fact]
    public async Task A_change_writes_one_access_event_with_role_names_and_ids_and_an_extra_event_when_the_flag_flips()
    {
        var type = await NewTypeAsync("Audited access");
        var saved = await TaskHarness.OkAsync(await PutAsync(Id(type), await GetAccessAsync(Id(type)), [_director, _partner], [_partner], []));
        var unchanged = await TaskHarness.OkAsync(await PutAsync(Id(type), saved, [_director, _partner], [_partner], []));
        unchanged.GetProperty("rowVersion").GetString().ShouldBe(saved.GetProperty("rowVersion").GetString(), "saving the same lists changes nothing");
        var changed = await TaskHarness.OkAsync(await PutAsync(Id(type), unchanged, [_director, _partner], [_director], []));
        await TaskHarness.OkAsync(await PutAsync(Id(type), changed, [], [], []));

        var events = await EventsAsync(Id(type));
        var access = events.Where(e => e.EventType == "TASK_TYPE_ACCESS_CHANGED").ToList();
        access.Count.ShouldBe(3, "one per save that changed a list; the unchanged save writes none");
        events.Count(e => e.EventType == "TASK_TYPE_RESTRICTED").ShouldBe(1);
        events.Count(e => e.EventType == "TASK_TYPE_UNRESTRICTED").ShouldBe(1);
        events.Where(e => e.EventType == "FIELD_CHANGED").Select(e => e.FieldKey).ShouldNotContain("IsRestricted", "IsRestricted is written as explicit events only");

        access[0].Summary.ShouldBe("Task Type 'Audited access': Can View changed from (everyone) to Director Test, Partner Test; Can Edit changed from (no extra limit) to Partner Test");
        using var newValue = JsonDocument.Parse(access[0].NewValue!);
        newValue.RootElement.GetProperty("canView").EnumerateArray().Select(r => r.GetProperty("name").GetString()).ShouldBe(["Director Test", "Partner Test"]);
        newValue.RootElement.GetProperty("canView").EnumerateArray().Select(r => r.GetProperty("roleId").GetInt32()).ShouldBe(new[] { _director, _partner }.Order().ToArray());
        using var oldValue = JsonDocument.Parse(access[0].OldValue!);
        oldValue.RootElement.GetProperty("canView").GetArrayLength().ShouldBe(0);
        access.ShouldAllBe(e => e.MatterId == null && e.TaskId == null && e.FieldKey == "access");
    }

    // ---- permission

    [Fact]
    public async Task The_access_endpoints_need_TaskType_Manage_and_the_lists_are_hidden_from_everybody_else()
    {
        var type = await NewTypeAsync("Guarded");
        var reader = await _h.UserWithAsync(@"KE\reader", "Task.View");
        var current = await GetAccessAsync(Id(type));

        (await reader.GetAsync($"/api/v1/task-types/{Id(type)}/access")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await PutAsync(Id(type), current, [_director], [], [], client: reader)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await reader.PostAsJsonAsync($"/api/v1/task-types/{Id(type)}/access/preview", new { canView = new[] { _director }, canEdit = Array.Empty<int>(), canAssign = Array.Empty<int>() })).StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        var detail = await TaskHarness.OkAsync(await reader.GetAsync($"/api/v1/task-types/{Id(type)}"));
        (detail.TryGetProperty("access", out var access) ? access.ValueKind : JsonValueKind.Null).ShouldBe(JsonValueKind.Null, "no hint about the lists without TaskType.Manage");

        var manager = await _h.UserWithAsync(@"KE\manager", "TaskType.Manage");
        (await manager.GetAsync($"/api/v1/task-types/{Id(type)}/access")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await PutAsync(Id(type), current, [_director], [], [], client: manager)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task The_role_list_is_readable_with_TaskType_Manage_alone()
    {
        var manager = await _h.UserWithAsync(@"KE\manager2", "TaskType.Manage");
        var nobody = await _h.UserWithAsync(@"KE\nobody", "Task.View");

        var roles = await TaskHarness.OkAsync(await manager.GetAsync("/api/v1/roles"));
        roles.EnumerateArray().Select(r => r.GetProperty("name").GetString()).ShouldContain("Director Test");
        (await nobody.GetAsync("/api/v1/roles")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await manager.GetAsync($"/api/v1/roles/{_director}")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    // ---- role delete

    private static async Task<JsonElement> ConflictAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(HttpStatusCode.Conflict, body);
        var problem = JsonDocument.Parse(body).RootElement;
        problem.GetProperty("code").GetString().ShouldBe("ROLE_USED_BY_TASK_TYPE", body);
        return problem;
    }

    [Fact]
    public async Task A_role_named_in_any_list_cannot_be_deleted_and_the_message_names_the_task_types_until_it_is_removed_there()
    {
        var a = await NewTypeAsync("Alpha type");
        var b = await NewTypeAsync("Beta type");
        var sa = await TaskHarness.OkAsync(await PutAsync(Id(a), await GetAccessAsync(Id(a)), [_director], [], []));
        var sb = await TaskHarness.OkAsync(await PutAsync(Id(b), await GetAccessAsync(Id(b)), [_partner], [], [_director]));

        var blocked = await ConflictAsync(await Admin.DeleteAsync($"/api/v1/roles/{_director}"));
        blocked.GetProperty("detail").GetString().ShouldBe("This role is used by 2 Task Types. Remove it there first.");
        blocked.GetProperty("meta").GetProperty("taskTypes").EnumerateArray().Select(n => n.GetString()).ShouldBe(["Alpha type", "Beta type"]);
        blocked.GetProperty("meta").GetProperty("taskTypeCount").GetInt32().ShouldBe(2);

        await TaskHarness.OkAsync(await PutAsync(Id(a), sa, [_partner], [], []));
        var one = await ConflictAsync(await Admin.DeleteAsync($"/api/v1/roles/{_director}"));
        one.GetProperty("detail").GetString().ShouldBe("This role is used by 1 Task Type. Remove it there first.");

        await TaskHarness.OkAsync(await PutAsync(Id(b), sb, [_partner], [], []));
        (await Admin.DeleteAsync($"/api/v1/roles/{_director}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task The_database_also_refuses_to_delete_a_role_that_a_list_names()
    {
        var type = await NewTypeAsync("Foreign key");
        await TaskHarness.OkAsync(await PutAsync(Id(type), await GetAccessAsync(Id(type)), [_associate], [], []));

        await _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("DELETE dbo.RolePermission WHERE RoleId = {0}", _associate));
        var ex = await Should.ThrowAsync<Exception>(() => _factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("DELETE dbo.Role WHERE RoleId = {0}", _associate)));
        ex.ToString().ShouldContain("FK_TaskTypeRoleAccess_Role");
    }

    // ---- preview

    [Fact]
    public async Task The_preview_counts_people_and_open_tasks_over_every_task_and_writes_nothing()
    {
        var w = await _h.CreateWorldAsync();
        await _h.UserWithAsync(@"KE\dir1", "Task.View");
        await _h.UserWithAsync(@"KE\par1", "Task.View", "Workflow.Execute", "Task.Assign");
        await _h.UserWithAsync(@"KE\nov1", "Matter.View");
        await _factory.GrantRoleAsync(@"KE\dir1", _director);
        await _factory.GrantRoleAsync(@"KE\par1", _partner);
        var partnerId = await _h.UserIdAsync(@"KE\par1");
        await _h.CreateTaskAsync(w, extra: new() { ["assignedUserId"] = partnerId });
        await _h.CreateTaskAsync(w);
        await _h.ReachAsync(w, "COMPLETED");

        var current = await GetAccessAsync(w.TaskTypeId);
        async Task<JsonElement> Preview(int[] view, int[] edit, int[] assign) =>
            await TaskHarness.OkAsync(await Admin.PostAsJsonAsync($"/api/v1/task-types/{w.TaskTypeId}/access/preview", new { canView = view, canEdit = edit, canAssign = assign }));

        // The harness adds a few people of its own, so the counts are compared with each other: par1 (Partner) is the one person who differs between the two proposals.
        // System Admin never loses sight of a type.
        var onlyDirector = await Preview([_director], [], []);
        var directorAndPartner = await Preview([_director, _partner], [], []);
        onlyDirector.GetProperty("isRestricted").GetBoolean().ShouldBeTrue();
        onlyDirector.GetProperty("becomesOpenToEveryone").GetBoolean().ShouldBeFalse();
        onlyDirector.GetProperty("callerLosesView").GetBoolean().ShouldBeFalse();
        onlyDirector.GetProperty("peopleLosingView").GetInt32().ShouldBe(directorAndPartner.GetProperty("peopleLosingView").GetInt32() + 1);
        onlyDirector.GetProperty("peopleLosingEdit").GetInt32().ShouldBe(onlyDirector.GetProperty("peopleLosingView").GetInt32(), "with no Edit list, whoever loses sight loses editing too");
        onlyDirector.GetProperty("openTasksBecomingHidden").GetInt32().ShouldBe(2, "two open tasks; the completed one is not counted");
        onlyDirector.GetProperty("openTasksAssignedToPeopleLosingView").GetInt32().ShouldBe(1, "the task assigned to par1");
        directorAndPartner.GetProperty("openTasksAssignedToPeopleLosingView").GetInt32().ShouldBe(0);

        // Both roles may view, only Director may edit: par1 loses the right to edit on top of everybody who loses sight.
        var editOnlyDirector = await Preview([_director, _partner], [_director], []);
        editOnlyDirector.GetProperty("peopleLosingView").GetInt32().ShouldBe(directorAndPartner.GetProperty("peopleLosingView").GetInt32());
        editOnlyDirector.GetProperty("peopleLosingEdit").GetInt32().ShouldBe(directorAndPartner.GetProperty("peopleLosingView").GetInt32() + 1);

        // Nothing was written.
        (await GetAccessAsync(w.TaskTypeId)).GetProperty("rowVersion").GetString().ShouldBe(current.GetProperty("rowVersion").GetString());
        (await EventsAsync(w.TaskTypeId)).Select(e => e.EventType).ShouldNotContain("TASK_TYPE_ACCESS_CHANGED");
        (await _factory.WithDbAsync(db => db.Set<TaskTypeRoleAccess>().CountAsync())).ShouldBe(0);
    }

    [Fact]
    public async Task The_preview_says_when_the_type_would_become_open_and_when_the_caller_would_lose_sight_of_it()
    {
        var type = await NewTypeAsync("Previewed");
        await TaskHarness.OkAsync(await PutAsync(Id(type), await GetAccessAsync(Id(type)), [_director], [], []));

        var open = await TaskHarness.OkAsync(await Admin.PostAsJsonAsync($"/api/v1/task-types/{Id(type)}/access/preview", new { canView = Array.Empty<int>(), canEdit = Array.Empty<int>(), canAssign = Array.Empty<int>() }));
        open.GetProperty("becomesOpenToEveryone").GetBoolean().ShouldBeTrue();
        open.GetProperty("isRestricted").GetBoolean().ShouldBeFalse();
        open.GetProperty("peopleLosingView").GetInt32().ShouldBe(0);

        // A manager who holds the Director role and then drops it loses sight of the type; System Admin never does.
        var manager = await _h.UserWithAsync(@"KE\mgr3", "TaskType.Manage", "Task.View");
        await _factory.GrantRoleAsync(@"KE\mgr3", _director);
        var loses = await TaskHarness.OkAsync(await manager.PostAsJsonAsync($"/api/v1/task-types/{Id(type)}/access/preview", new { canView = new[] { _partner }, canEdit = Array.Empty<int>(), canAssign = Array.Empty<int>() }));
        loses.GetProperty("callerLosesView").GetBoolean().ShouldBeTrue();
        var admin = await TaskHarness.OkAsync(await Admin.PostAsJsonAsync($"/api/v1/task-types/{Id(type)}/access/preview", new { canView = new[] { _partner }, canEdit = Array.Empty<int>(), canAssign = Array.Empty<int>() }));
        admin.GetProperty("callerLosesView").GetBoolean().ShouldBeFalse();

        await TaskHarness.ProblemAsync(await Admin.PostAsJsonAsync($"/api/v1/task-types/{Id(type)}/access/preview", new { canView = new[] { 999999 }, canEdit = Array.Empty<int>(), canAssign = Array.Empty<int>() }), HttpStatusCode.BadRequest, "VALIDATION_FAILED");
        await TaskHarness.ProblemAsync(await Admin.PostAsJsonAsync("/api/v1/task-types/999999/access/preview", new { canView = Array.Empty<int>(), canEdit = Array.Empty<int>(), canAssign = Array.Empty<int>() }), HttpStatusCode.NotFound, "NOT_FOUND");
    }
}
