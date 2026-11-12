using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Shouldly;
using static LptHub.IntegrationTests.Tasks.TaskHarness;

namespace LptHub.IntegrationTests.Vendors;

/// <summary>
/// Vendor-to-matter links under the sensitive-matter rule (epic #788, epic #1373): a person who may not see a matter cannot link to it, unlink from it, list its vendors
/// or learn that it exists (404, identical to a missing matter), and never sees it on a vendor's Matters list or in its count. The delete rule still counts every link.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class VendorsSensitiveMatterTests(SqlServerFixture sql)
{
    private static readonly string[] VendorPermissions = ["Vendor.View", "Vendor.Link", "Matter.View"];

    [Fact]
    public async Task A_hidden_matter_is_a_404_everywhere_and_never_shows_on_the_vendor_side()
    {
        var u = await SensitiveUniverse.BuildAsync(sql, enabled: true);
        try
        {
            var vendor = await OkAsync(await u.H.Admin.PostAsJsonAsync("/api/v1/vendors", new { name = "Shared Vendor", category = "PREFERRED" }), HttpStatusCode.Created);
            var vendorId = vendor.GetProperty("vendorId").GetInt32();

            var unrelated = await u.H.UserWithAsync(@"KE\vunrelated", VendorPermissions); // same people, no manager role on S1
            var manager = await u.H.UserWithAsync(@"KE\vmanager", VendorPermissions);
            await u.H.ExecuteAsync($"UPDATE dbo.Matter SET PrimaryManagerId = {await u.H.UserIdAsync(@"KE\vmanager")} WHERE MatterId = {u.S2}");
            u.H.Factory.InvalidateAll();
            var viewer = await u.H.UserWithAsync(@"KE\vseeall", [.. VendorPermissions, "Matter.ViewSensitive"]);

            // The unrelated user links the normal matter, the see-all viewer links S1 and the manager links S2.
            (await unrelated.PostAsJsonAsync($"/api/v1/matters/{u.N1}/vendors", new { vendorId })).StatusCode.ShouldBe(HttpStatusCode.Created);
            (await viewer.PostAsJsonAsync($"/api/v1/matters/{u.S1}/vendors", new { vendorId })).StatusCode.ShouldBe(HttpStatusCode.Created);
            (await manager.PostAsJsonAsync($"/api/v1/matters/{u.S2}/vendors", new { vendorId })).StatusCode.ShouldBe(HttpStatusCode.Created);

            // A hidden matter answers exactly like one that does not exist, on all three matter-side calls.
            var missing = await ProblemBodyAsync(await unrelated.GetAsync("/api/v1/matters/999999/vendors"));
            foreach (var hidden in new[] { u.S1, u.S2 })
            {
                var list = await unrelated.GetAsync($"/api/v1/matters/{hidden}/vendors");
                list.StatusCode.ShouldBe(HttpStatusCode.NotFound);
                (await ProblemBodyAsync(list)).ShouldBe(missing);
                var link = await unrelated.PostAsJsonAsync($"/api/v1/matters/{hidden}/vendors", new { vendorId });
                link.StatusCode.ShouldBe(HttpStatusCode.NotFound);
                (await ProblemBodyAsync(link)).ShouldBe(missing);
                (await unrelated.DeleteAsync($"/api/v1/matters/{hidden}/vendors/{vendorId}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
            }

            (await manager.GetAsync($"/api/v1/matters/{u.S1}/vendors")).StatusCode.ShouldBe(HttpStatusCode.NotFound); // manages S2, not S1
            (await OkAsync(await manager.GetAsync($"/api/v1/matters/{u.S2}/vendors"))).GetArrayLength().ShouldBe(1);

            // Vendor side: the unrelated user sees only the normal matter and a count of one; the see-all viewer sees all three.
            var seen = await OkAsync(await unrelated.GetAsync($"/api/v1/vendors/{vendorId}/matters"));
            seen.EnumerateArray().Select(m => m.GetProperty("matterId").GetInt32()).ShouldBe([u.N1]);
            (await (await unrelated.GetAsync($"/api/v1/vendors/{vendorId}/matters")).Content.ReadAsStringAsync()).ShouldNotContain(SensitiveUniverse.SentinelPrefix);
            (await OkAsync(await unrelated.GetAsync($"/api/v1/vendors/{vendorId}"))).GetProperty("matterCount").GetInt32().ShouldBe(1);
            (await OkAsync(await unrelated.GetAsync("/api/v1/vendors"))).GetProperty("items")[0].GetProperty("matterCount").GetInt32().ShouldBe(1);
            (await OkAsync(await viewer.GetAsync($"/api/v1/vendors/{vendorId}/matters"))).GetArrayLength().ShouldBe(3);
            (await OkAsync(await viewer.GetAsync($"/api/v1/vendors/{vendorId}"))).GetProperty("matterCount").GetInt32().ShouldBe(3);

            // The unrelated user cannot unlink the sensitive matters, so the hidden links stay; the delete rule counts all of them.
            var admin = u.H.Admin;
            var refused = await ProblemAsync(await admin.DeleteAsync($"/api/v1/vendors/{vendorId}"), HttpStatusCode.Conflict, "VENDOR_LINKED_TO_MATTERS");
            refused.GetProperty("meta").GetProperty("matterCount").GetInt32().ShouldBe(3);

            // The audit events of a sensitive matter carry the matter, so the audit trail hides them like the matter.
            var events = await u.H.AuditAsync("VENDOR_LINKED");
            events.Select(e => e.MatterId).ToList().ShouldBe([u.N1, u.S1, u.S2]);

            // The see-all viewer unlinks S1; the matter list of S1 is then empty for the viewer.
            (await viewer.DeleteAsync($"/api/v1/matters/{u.S1}/vendors/{vendorId}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
            (await OkAsync(await viewer.GetAsync($"/api/v1/matters/{u.S1}/vendors"))).GetArrayLength().ShouldBe(0);
        }
        finally
        {
            await u.H.Factory.DisposeAsync();
        }
    }

    private static async Task<string> ProblemBodyAsync(HttpResponseMessage response)
    {
        var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        // The trace id differs per request; everything else must be identical.
        return string.Join("|", problem.EnumerateObject().Where(p => p.Name != "traceId").Select(p => p.Name + "=" + p.Value.GetRawText()));
    }
}
