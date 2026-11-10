using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>
/// Matter events and the sensitive-matter rule (UI-05, #958): an event of a sensitive matter does not exist for a caller who may not see the matter, not even for a holder of Matter.Edit; list, create,
/// change, delete, the My Matters calendar and Upcoming events all answer as if it were not there. The matter's managers and holders of Matter.ViewSensitive see and write it.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class MatterEventsSensitiveTests(SqlServerFixture sql)
{
    private static object Body(string title) => new { typeCode = "TRIAL", title, date = "2030-02-01", time = (string?)null, note = (string?)null };

    [Fact]
    public async Task A_hidden_matters_events_are_invisible_for_every_operation_and_visible_to_its_managers_and_viewers()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            // The seeded event of S1 (sentinel in its title) and one created by its Primary PM.
            var created = await OkAsync(await u.PmPrimaryClient.PostAsJsonAsync($"/api/v1/matters/{u.S1}/events", Body($"{SensitiveUniverse.Sentinel(u.S1)} trial")), HttpStatusCode.Created);
            var eventId = created.GetProperty("eventId").GetInt32();
            var rowVersion = created.GetProperty("rowVersion").GetString()!;
            created.GetProperty("isSensitive").GetBoolean().ShouldBeTrue();

            // The Secondary PM and a holder of Matter.ViewSensitive (who also holds Matter.Edit) may see and write.
            (await u.PmSecondaryClient.GetAsync($"/api/v1/matters/{u.S1}/events?from=2030-01-01&to=2030-03-01")).StatusCode.ShouldBe(HttpStatusCode.OK);
            (await u.ViewerClient.PostAsJsonAsync($"/api/v1/matters/{u.S1}/events", Body($"{SensitiveUniverse.Sentinel(u.S1)} by viewer"))).StatusCode.ShouldBe(HttpStatusCode.Created);

            // The unrelated user holds Matter.Edit but cannot see S1: everything is a 404, byte for byte like a missing matter or event.
            var missing = await u.UnrelatedClient.GetAsync("/api/v1/matters/999999/events");
            missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            var hidden = await u.UnrelatedClient.GetAsync($"/api/v1/matters/{u.S1}/events");
            hidden.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            Normalize(await hidden.Content.ReadAsStringAsync()).ShouldBe(Normalize(await missing.Content.ReadAsStringAsync()));

            (await u.UnrelatedClient.PostAsJsonAsync($"/api/v1/matters/{u.S1}/events", Body("Sneaky"))).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await u.UnrelatedClient.PutAsJsonAsync($"/api/v1/matter-events/{eventId}", new { typeCode = "TRIAL", title = "Sneaky", date = "2030-02-01", rowVersion })).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await u.UnrelatedClient.DeleteAsync($"/api/v1/matter-events/{eventId}?rowVersion={Uri.EscapeDataString(rowVersion)}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await u.UnrelatedClient.PutAsJsonAsync("/api/v1/matter-events/999999", new { typeCode = "TRIAL", title = "x", date = "2030-02-01", rowVersion })).StatusCode.ShouldBe(HttpStatusCode.NotFound);

            // The calendar and Upcoming events of the My Matters scope never show or count it.
            foreach (var url in new[] { "events?scope=all&from=2030-01-01&to=2030-03-01", "events/upcoming?scope=all&days=60&take=50" })
            {
                var body = await (await u.UnrelatedClient.GetAsync("/api/v1/my-matters/" + url)).Content.ReadAsStringAsync();
                body.ShouldNotContain("ZZSENS");
            }

            var calendar = await OkAsync(await u.UnrelatedClient.GetAsync("/api/v1/my-matters/events?scope=all&from=2030-01-01&to=2030-03-01"));
            calendar.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("matterId").GetInt32()).Distinct().ShouldBe([u.N1]);
            var viewer = await OkAsync(await u.ViewerClient.GetAsync("/api/v1/my-matters/events?scope=all&from=2030-01-01&to=2030-03-01"));
            viewer.GetProperty("total").GetInt32().ShouldBeGreaterThanOrEqualTo(4 + 2);

            // The unchanged event is still there for the Primary, and the delete by the Primary works.
            (await u.PmPrimaryClient.DeleteAsync($"/api/v1/matter-events/{eventId}?rowVersion={Uri.EscapeDataString(rowVersion)}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);

            // Searching for the sentinel finds nothing for the unrelated user (events are not a search type; the audit trail is filtered by the rule).
            var audit = await (await u.UnrelatedClient.GetAsync("/api/v1/audit/search?pageSize=200")).Content.ReadAsStringAsync();
            audit.ShouldNotContain("ZZSENS");
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    private static string Normalize(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("code").GetString() + "|" + doc.RootElement.GetProperty("status").GetInt32() + "|" + doc.RootElement.GetProperty("title").GetString();
    }
}
