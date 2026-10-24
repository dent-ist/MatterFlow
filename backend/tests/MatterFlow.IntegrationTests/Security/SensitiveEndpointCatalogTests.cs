using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace MatterFlow.IntegrationTests.Security;

/// <summary>
/// The catalog test of epic #788 (SM-15/SM-16, README 12.2): every endpoint operation the host exposes is classified in <see cref="SensitiveAccessCatalog"/>, and the catalog
/// names no endpoint that no longer exists. A new endpoint therefore cannot ship without somebody deciding how it relates to the sensitive-matter rule.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class SensitiveEndpointCatalogTests(SqlServerFixture sql)
{
    [Fact]
    public async Task Every_endpoint_operation_is_classified_and_the_catalog_has_no_stale_entry()
    {
        await using var factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _ = factory.CreateClient();
        var source = factory.Services.GetRequiredService<EndpointDataSource>();
        var actual = source.Endpoints.OfType<RouteEndpoint>()
            .SelectMany(e => (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? ["ANY"]).Select(m => $"{m} {e.RoutePattern.RawText}"))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();

        var unclassified = actual.Where(k => !SensitiveAccessCatalog.All.ContainsKey(k)).ToList();
        var stale = SensitiveAccessCatalog.All.Keys.Where(k => !actual.Contains(k)).Order(StringComparer.Ordinal).ToList();
        unclassified.ShouldBeEmpty("Classify these endpoints in SensitiveAccessCatalog (Gated, List, Aggregate, Write, Neutral with a reason, or Open): " + string.Join("; ", unclassified));
        stale.ShouldBeEmpty("These catalog entries match no endpoint any more: " + string.Join("; ", stale));
        SensitiveAccessCatalog.All.Values.ShouldAllBe(e => e.Reason.Length > 0);
    }

    [Fact]
    public void Open_entries_are_exactly_the_reports_endpoints_which_are_not_decided_in_this_epic()
    {
        var open = SensitiveAccessCatalog.All.Where(kv => kv.Value.Kind == AccessKind.Open).Select(kv => kv.Key).ToList();
        open.ShouldNotBeEmpty();
        open.ShouldAllBe(k => k.Contains("api/v1/report", StringComparison.Ordinal), "Only Reports (README section 15, issue #808) may stay undecided.");
    }
}
