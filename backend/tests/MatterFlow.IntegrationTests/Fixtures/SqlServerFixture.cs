using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Testcontainers.MsSql;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>One real SQL Server container (random host port) shared by the tests; each test gets its own migrated database.</summary>
public sealed class SqlServerFixture : IAsyncLifetime
{
    private readonly MsSqlContainer _container = new MsSqlBuilder().WithImage("mcr.microsoft.com/mssql/server:2022-latest").Build();

    public async Task InitializeAsync() => await _container.StartAsync();

    public async Task DisposeAsync() => await _container.DisposeAsync();

    /// <summary>Creates an empty database and returns its connection string.</summary>
    public async Task<string> CreateDatabaseAsync()
    {
        var name = "mf_" + Guid.NewGuid().ToString("N");
        await ExecuteAsync(_container.GetConnectionString(), $"CREATE DATABASE [{name}];");
        return new SqlConnectionStringBuilder(_container.GetConnectionString()) { InitialCatalog = name }.ConnectionString;
    }

    /// <summary>Creates a database and applies every embedded schema script (the production path).</summary>
    public async Task<string> CreateMigratedDatabaseAsync()
    {
        var cs = await CreateDatabaseAsync();
        var runner = new SchemaMigrationRunner(
            cs,
            new EmbeddedMigrationScriptSource(),
            new MigrationsOptions { LockTimeoutSeconds = 60 },
            NullLogger<SchemaMigrationRunner>.Instance);
        await runner.RunAsync();
        return cs;
    }

    public static async Task ExecuteAsync(string connectionString, string sql)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }
}

[CollectionDefinition(Name)]
public sealed class SqlServerCollection : ICollectionFixture<SqlServerFixture>
{
    public const string Name = "SqlServer";
}
