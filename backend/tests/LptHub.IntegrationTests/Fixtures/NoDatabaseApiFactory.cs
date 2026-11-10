using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>API host for tests that need no database: schema migrations are switched off so startup does not need a connection string.</summary>
public class NoDatabaseApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseSetting("Migrations:Enabled", "false");
}
