using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.Security;

/// <summary>
/// Lost-write audit (issue #1304), the modules that do not load through a matter filter at all (Identity: absences, pods, saved screen states; Configuration: priorities; Assets: saved asset
/// reports): with the sensitive-matter rule on, a caller who is NOT "see all" makes a SUCCESSFUL write and the value is read back. They are clean by construction, and this class keeps them so.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class LostWriteAdminTests(SqlServerFixture sql)
{
    private static string Str(JsonElement e, string name) => e.GetProperty(name).GetString()!;

    [Fact]
    public async Task Identity_configuration_and_saved_report_changes_by_a_caller_who_is_not_see_all_are_saved()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        await using var _ = u.H.Factory;
        var admin = u.H.Admin;
        var role = await u.H.Factory.CreateRoleAsync("Config person", "Pod.Manage", "Pod.ManageMembers", "Priority.Manage");
        await u.H.Factory.GrantRoleAsync(@"KE\unrelated", role);
        var persona = u.UnrelatedClient;

        // Absences (Calendar): add, change, delete one's own entry.
        var absences = $"/api/v1/users/{u.Unrelated}/absences";
        var entry = await OkAsync(await persona.PostAsJsonAsync(absences, new { type = "VACATION", startDate = "2031-03-03", endDate = "2031-03-07", note = "first" }), HttpStatusCode.Created);
        var entryId = entry.GetProperty("absenceId").GetInt32();
        var changed = await OkAsync(await persona.PutAsJsonAsync($"{absences}/{entryId}", new { type = "TRAINING", startDate = "2031-03-03", endDate = "2031-03-08", note = "second", rowVersion = Str(entry, "rowVersion") }));
        var stored = (await OkAsync(await admin.GetAsync(absences))).EnumerateArray().Single(a => a.GetProperty("absenceId").GetInt32() == entryId);
        Str(stored, "type").ShouldBe("TRAINING");
        Str(stored, "note").ShouldBe("second");
        (await persona.DeleteAsync($"{absences}/{entryId}?rowVersion={Uri.EscapeDataString(Str(changed, "rowVersion"))}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await OkAsync(await admin.GetAsync(absences))).EnumerateArray().ShouldNotContain(a => a.GetProperty("absenceId").GetInt32() == entryId);

        // Pods: create, change, add a member.
        var pod = await OkAsync(await persona.PostAsJsonAsync("/api/v1/pods", new { name = "Review pod" }), HttpStatusCode.Created);
        var podId = pod.GetProperty("pod").GetProperty("podId").GetInt32();
        var renamed = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/pods/{podId}", new { name = "Review pod renamed", description = "by persona", isActive = true, rowVersion = pod.GetProperty("pod").GetProperty("rowVersion").GetString() }));
        Str(renamed.GetProperty("pod"), "name").ShouldBe("Review pod renamed");
        var storedPod = (await OkAsync(await admin.GetAsync($"/api/v1/pods/{podId}"))).GetProperty("pod");
        Str(storedPod, "name").ShouldBe("Review pod renamed");
        Str(storedPod, "description").ShouldBe("by persona");
        await OkAsync(await persona.PostAsJsonAsync($"/api/v1/pods/{podId}/members", new { userIds = new[] { u.Assignee } }));
        (await OkAsync(await admin.GetAsync($"/api/v1/pods/{podId}"))).GetProperty("members").EnumerateArray().ShouldContain(m => m.GetProperty("userId").GetInt32() == u.Assignee);

        // Saved screen state (Identity views).
        const string surface = "task-queue";
        var view = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/me/views/{surface}", new { state = new { sort = "priority", types = new[] { 1 } } }));
        var again = await OkAsync(await persona.PutAsJsonAsync($"/api/v1/me/views/{surface}", new { state = new { sort = "due", types = new[] { 2 } } }));
        var current = (await OkAsync(await persona.GetAsync($"/api/v1/me/views?surface={surface}"))).GetProperty("items").EnumerateArray().Single(v => v.GetProperty("name").ValueKind == JsonValueKind.Null);
        Str(current.GetProperty("state"), "sort").ShouldBe("due");
        view.ValueKind.ShouldBe(JsonValueKind.Object);
        again.ValueKind.ShouldBe(JsonValueKind.Object);

        // Priorities (Configuration).
        var priorities = await OkAsync(await persona.GetAsync("/api/v1/priorities"));
        var low = priorities.EnumerateArray().First(p => Str(p, "label") == "Low");
        var lowId = low.GetProperty("id").GetInt32();
        await OkAsync(await persona.PutAsJsonAsync($"/api/v1/priorities/{lowId}", new { label = "Whenever", color = Str(low, "color"), isActive = true, rowVersion = Str(low, "rowVersion") }));
        (await OkAsync(await admin.GetAsync("/api/v1/priorities"))).EnumerateArray().ShouldContain(p => Str(p, "label") == "Whenever");

        // Saved asset reports (personal): create, change, delete.
        var report = await OkAsync(await persona.PostAsJsonAsync("/api/v1/asset-reports", new { name = "My report", definition = new { v = 1, measure = "count", groupBy = "disposition", scope = "mine" } }), HttpStatusCode.Created);
        var reportId = report.GetProperty("assetReportId").GetInt32();
        await OkAsync(await persona.PutAsJsonAsync($"/api/v1/asset-reports/{reportId}", new { name = "My report renamed", definition = new { v = 1, measure = "count", groupBy = "matter", scope = "mine" }, rowVersion = Str(report, "rowVersion") }));
        var storedReport = await OkAsync(await persona.GetAsync($"/api/v1/asset-reports/{reportId}"));
        Str(storedReport, "name").ShouldBe("My report renamed");
        Str(storedReport.GetProperty("definition"), "groupBy").ShouldBe("matter");
        (await persona.DeleteAsync($"/api/v1/asset-reports/{reportId}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }
}
