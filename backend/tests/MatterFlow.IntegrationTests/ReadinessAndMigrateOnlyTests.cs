using System.Net;
using System.Text.Json;
using MatterFlow.Api.Hosting;
using MatterFlow.IntegrationTests.Fixtures;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Shouldly;

namespace MatterFlow.IntegrationTests;

/// <summary>Ticket #60: <c>/health/ready</c> states and the <c>--migrate-only</c> command, against a real SQL Server.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReadinessAndMigrateOnlyTests(SqlServerFixture sql)
{
    // A port nothing listens on: the connection is refused at once.
    private const string UnreachableConnection = "Server=127.0.0.1,1;Database=MatterFlow;User Id=x;Password=x;Encrypt=False;Connect Timeout=3";

    private static HttpClient Client(string? connectionString, out WebApplicationFactory<Program> factory)
    {
        factory = new NoDatabaseApiFactory().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Test");
            b.UseSetting("Auth:Provider", "Dev");
            b.UseSetting("AllowedHosts", "*");
            b.UseSetting("Seeds:Enabled", "false"); // the readiness probe is tested on its own: no startup seeds against empty or unreachable databases
            if (connectionString is not null)
                b.UseSetting("ConnectionStrings:MatterFlow", connectionString);
        });
        return factory.CreateClient();
    }

    private static async Task<(HttpStatusCode Status, JsonElement Body, string Raw, HttpResponseMessage Response)> ReadyAsync(string? connectionString)
    {
        var client = Client(connectionString, out var factory);
        using (factory)
        {
            var response = await client.GetAsync("/health/ready");
            var raw = await response.Content.ReadAsStringAsync();
            return (response.StatusCode, JsonDocument.Parse(raw).RootElement.Clone(), raw, response);
        }
    }

    [Fact]
    public async Task Ready_is_200_when_the_database_is_reachable_and_every_script_is_applied()
    {
        var connectionString = await sql.CreateMigratedDatabaseAsync();

        var (status, body, _, response) = await ReadyAsync(connectionString);

        status.ShouldBe(HttpStatusCode.OK);
        body.GetProperty("status").GetString().ShouldBe("ready");
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/json");
    }

    [Fact]
    public async Task Ready_is_503_when_the_database_is_empty_so_nothing_has_been_migrated()
    {
        var connectionString = await sql.CreateDatabaseAsync();

        var (status, body, _, _) = await ReadyAsync(connectionString);

        status.ShouldBe(HttpStatusCode.ServiceUnavailable);
        body.GetProperty("status").GetString().ShouldBe("not_ready");
        body.GetProperty("reason").GetString().ShouldBe(ReadinessHealthCheck.MigrationsPending);
    }

    [Fact]
    public async Task Ready_is_503_when_a_migration_script_is_pending()
    {
        var connectionString = await sql.CreateMigratedDatabaseAsync();
        await SqlServerFixture.ExecuteAsync(connectionString, "DELETE FROM dbo.SchemaMigration WHERE Prefix = (SELECT MAX(Prefix) FROM dbo.SchemaMigration);");

        var (status, body, _, _) = await ReadyAsync(connectionString);

        status.ShouldBe(HttpStatusCode.ServiceUnavailable);
        body.GetProperty("reason").GetString().ShouldBe(ReadinessHealthCheck.MigrationsPending);
    }

    [Fact]
    public async Task Ready_is_503_when_a_migration_is_recorded_as_failed()
    {
        var connectionString = await sql.CreateMigratedDatabaseAsync();
        await SqlServerFixture.ExecuteAsync(connectionString, "UPDATE dbo.SchemaMigration SET Success = 0 WHERE Prefix = (SELECT MAX(Prefix) FROM dbo.SchemaMigration);");

        var (status, body, _, _) = await ReadyAsync(connectionString);

        status.ShouldBe(HttpStatusCode.ServiceUnavailable);
        body.GetProperty("reason").GetString().ShouldBe(ReadinessHealthCheck.MigrationFailed);
    }

    [Fact]
    public async Task Ready_is_503_without_leaking_details_when_the_database_is_down()
    {
        var (status, body, raw, _) = await ReadyAsync(UnreachableConnection);

        status.ShouldBe(HttpStatusCode.ServiceUnavailable);
        body.GetProperty("reason").GetString().ShouldBe(ReadinessHealthCheck.Unreachable);
        raw.ShouldNotContain("127.0.0.1");
        raw.ShouldNotContain("Password");
    }

    [Fact]
    public async Task Ready_is_503_when_no_connection_string_is_configured_but_live_stays_200()
    {
        var client = Client(null, out var factory);
        using (factory)
        {
            var ready = await client.GetAsync("/health/ready");
            var live = await client.GetAsync("/health/live");

            ready.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
            (await ready.Content.ReadAsStringAsync()).ShouldContain(ReadinessHealthCheck.NotConfigured);
            live.StatusCode.ShouldBe(HttpStatusCode.OK);
        }
    }

    [Fact]
    public async Task Migrate_only_applies_every_pending_script_with_the_migrations_login_and_exits_0()
    {
        var connectionString = await sql.CreateDatabaseAsync();

        var exitCode = await MigrateOnlyCommand.RunAsync([MigrateOnlyCommand.Switch, $"--ConnectionStrings:Migrations={connectionString}"]);

        exitCode.ShouldBe(0);
        (await ScalarAsync(connectionString, "SELECT COUNT(*) FROM dbo.SchemaMigration WHERE Success = 1")).ShouldBeGreaterThan(10);
        (await ReadyAsync(connectionString)).Status.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Migrate_only_is_idempotent_and_ignores_Migrations_Enabled_false()
    {
        var connectionString = await sql.CreateDatabaseAsync();
        string[] args = [MigrateOnlyCommand.Switch, "--Migrations:Enabled=false", $"--ConnectionStrings:Migrations={connectionString}"];

        (await MigrateOnlyCommand.RunAsync(args)).ShouldBe(0);
        var applied = await ScalarAsync(connectionString, "SELECT COUNT(*) FROM dbo.SchemaMigration");
        (await MigrateOnlyCommand.RunAsync(args)).ShouldBe(0);

        applied.ShouldBeGreaterThan(0);
        (await ScalarAsync(connectionString, "SELECT COUNT(*) FROM dbo.SchemaMigration")).ShouldBe(applied);
    }

    [Fact]
    public async Task Migrate_only_exits_1_when_the_database_cannot_be_reached_or_no_connection_is_configured()
    {
        (await MigrateOnlyCommand.RunAsync([MigrateOnlyCommand.Switch, $"--ConnectionStrings:Migrations={UnreachableConnection}"])).ShouldBe(1);
        (await MigrateOnlyCommand.RunAsync([MigrateOnlyCommand.Switch])).ShouldBe(1);
    }

    [Fact]
    public async Task Migrate_only_exits_1_on_a_script_failure_recorded_in_the_database()
    {
        var connectionString = await sql.CreateMigratedDatabaseAsync();
        await SqlServerFixture.ExecuteAsync(connectionString, "UPDATE dbo.SchemaMigration SET Success = 0 WHERE Prefix = (SELECT MAX(Prefix) FROM dbo.SchemaMigration);");

        (await MigrateOnlyCommand.RunAsync([MigrateOnlyCommand.Switch, $"--ConnectionStrings:Migrations={connectionString}"])).ShouldBe(1);
    }

    [Theory]
    [InlineData("--migrate-only", null, true)]
    [InlineData("--MIGRATE-ONLY", null, true)]
    [InlineData("--other", null, false)]
    [InlineData("--other", "true", true)]
    [InlineData("--other", "1", true)]
    [InlineData("--other", "false", false)]
    [InlineData("--other", "", false)]
    public void Migrate_only_is_requested_by_the_switch_or_the_environment_variable(string arg, string? environmentValue, bool expected) =>
        MigrateOnlyCommand.IsRequested([arg], name => name == MigrateOnlyCommand.EnvironmentVariable ? environmentValue : null).ShouldBe(expected);

    private static async Task<int> ScalarAsync(string connectionString, string sqlText)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sqlText;
        return (int)(await command.ExecuteScalarAsync())!;
    }
}
