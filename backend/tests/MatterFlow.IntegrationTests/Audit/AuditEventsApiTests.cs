using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.Audit.Contracts;
using MatterFlow.Data;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.SharedKernel.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Audit;

/// <summary>
/// GET /api/v1/audit/events against a real database. The real Audit.View handler belongs to the authorization module; these tests
/// register a permissive stand-in for the policy name (test-only) to exercise the endpoint itself.
/// </summary>
[Collection(SqlServerCollection.Name)]
public class AuditEventsApiTests(SqlServerFixture sql)
{
    private async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:MatterFlow", cs);
            builder.UseSetting("ConnectionStrings:Default", cs); // schema runner: applies the real scripts at startup
            builder.ConfigureServices(services => services.AddAuthorization(o =>
                o.AddPolicy(PolicyNames.AuditView, p => p.RequireAssertion(_ => true))));
        });
    }

    private static async Task SeedAsync(WebApplicationFactory<Program> factory, int count)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var writer = scope.ServiceProvider.GetRequiredService<IAuditWriter>();
        for (var i = 1; i <= count; i++)
        {
            writer.Write(new AuditEntry
            {
                EventType = AuditEventTypes.FieldChanged,
                ObjectType = "Task",
                ObjectId = "12",
                FieldKey = "Title",
                OldValue = "v" + (i - 1),
                NewValue = i == count ? new string('x', 5000) : "v" + i,
            });
        }

        writer.Write(new AuditEntry { EventType = "OTHER", ObjectType = "Task", ObjectId = "99" });
        await scope.ServiceProvider.GetRequiredService<MatterFlowDbContext>().SaveChangesAsync();
    }

    [Fact]
    public async Task Lists_events_of_one_object_in_order_with_keyset_paging_and_truncation()
    {
        await using var factory = await CreateFactoryAsync();
        await SeedAsync(factory, 3);
        var client = factory.CreateClient();

        var page1 = await client.GetFromJsonAsync<JsonElement>("/api/v1/audit/events?objectType=Task&objectId=12&pageSize=2");

        page1.GetProperty("items").GetArrayLength().ShouldBe(2);
        page1.GetProperty("items")[0].GetProperty("newValue").GetString().ShouldBe("v1");
        var next = page1.GetProperty("nextAfterId").GetInt64();

        var page2 = await client.GetFromJsonAsync<JsonElement>($"/api/v1/audit/events?objectType=Task&objectId=12&pageSize=2&afterId={next}");

        page2.GetProperty("items").GetArrayLength().ShouldBe(1);
        page2.GetProperty("nextAfterId").ValueKind.ShouldBe(JsonValueKind.Null);
        var last = page2.GetProperty("items")[0];
        last.GetProperty("newValue").GetString()!.Length.ShouldBe(4000);
        last.GetProperty("newValueTruncated").GetBoolean().ShouldBeTrue();
        last.GetProperty("objectId").GetString().ShouldBe("12");
    }

    [Fact]
    public async Task Missing_object_filter_is_a_400()
    {
        await using var factory = await CreateFactoryAsync();

        var response = await factory.CreateClient().GetAsync("/api/v1/audit/events?objectType=Task");

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
}
