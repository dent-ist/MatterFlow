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

    /// <summary>Server-level part of a SQL login for the reports tests: creates the login (unique name) and returns a connection string for the database.</summary>
    public async Task<ReportLogin> CreateServerLoginAsync(string databaseConnectionString, string? serverRole = null)
    {
        var name = "rl_" + Guid.NewGuid().ToString("N")[..12];
        const string password = "Rpt!Passw0rd#2026x";
        await ExecuteAsync(_container.GetConnectionString(), $"CREATE LOGIN [{name}] WITH PASSWORD = '{password}', CHECK_POLICY = OFF;" + (serverRole is null ? "" : $" ALTER SERVER ROLE {serverRole} ADD MEMBER [{name}];"));
        var builder = new SqlConnectionStringBuilder(databaseConnectionString) { UserID = name, Password = password, IntegratedSecurity = false, ConnectTimeout = 10 };
        return new ReportLogin(name, builder.ConnectionString);
    }

    /// <summary>Database-level part: the user for the login, optionally in a database role (the database must be migrated for the role to exist).</summary>
    public static async Task CreateDatabaseUserAsync(string databaseConnectionString, string login, params string[] roles)
    {
        await ExecuteAsync(databaseConnectionString, $"CREATE USER [{login}] FOR LOGIN [{login}];" + string.Concat(roles.Select(r => $" ALTER ROLE [{r}] ADD MEMBER [{login}];")));
    }

    /// <summary>A scalar query run with the given connection string (used to test what a login may do).</summary>
    public static async Task<object?> ScalarAsync(string connectionString, string sql)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        return await cmd.ExecuteScalarAsync();
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

/// <summary>A SQL login created for a reports test: its name and a connection string for the test database.</summary>
public sealed record ReportLogin(string Name, string ConnectionString);

[CollectionDefinition(Name)]
public sealed class SqlServerCollection : ICollectionFixture<SqlServerFixture>
{
    public const string Name = "SqlServer";
}
