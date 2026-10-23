using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Domain;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.DependencyInjection;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>
/// A real API with the report login configured and Ready, plus helpers that insert reports straight into the Reports tables the way the admin
/// API will, so the run path can be tested before and independently of it.
/// </summary>
internal sealed class ReportTestHarness : IAsyncDisposable
{
    private int _reports;

    private ReportTestHarness(DatabaseApiFactory factory, TaskHarness tasks, string appConnection, ReportLogin login)
    {
        Factory = factory;
        Tasks = tasks;
        AppConnection = appConnection;
        Login = login;
    }

    public DatabaseApiFactory Factory { get; }

    public TaskHarness Tasks { get; }

    public string AppConnection { get; }

    public ReportLogin Login { get; }

    /// <summary>
    /// Starts the API on a fresh database with a provisioned report login (role mf_report_reader) and waits until Reports are Ready.
    /// <paramref name="withLogin"/> false leaves the report connection unconfigured (Reports stay off).
    /// </summary>
    public static async Task<ReportTestHarness> StartAsync(SqlServerFixture sql, bool withLogin = true, params (string Key, string Value)[] settings)
    {
        var appConnection = await sql.CreateDatabaseAsync();
        var login = await sql.CreateServerLoginAsync(appConnection);
        var factory = new DatabaseApiFactory(appConnection, reportsConnectionString: withLogin ? login.ConnectionString : null) { ExtraSettings = settings };
        var tasks = new TaskHarness(factory);

        // The first request migrates the database; then the login gets its user and role and the probe is repeated.
        await tasks.Admin.GetAsync("/api/v1/me");
        if (withLogin)
        {
            await SqlServerFixture.CreateDatabaseUserAsync(appConnection, login.Name, "mf_report_reader");
            var status = await factory.Services.GetRequiredService<IReportsAvailability>().CheckAsync(CancellationToken.None);
            if (!status.Enabled)
                throw new InvalidOperationException("Reports are not ready in the test: " + status.Message);
        }

        return new ReportTestHarness(factory, tasks, appConnection, login);
    }

    /// <summary>A person holding the given permissions; returns the client and the id of the person's own role (for the assignment).</summary>
    public async Task<(HttpClient Client, int RoleId)> PersonAsync(string account, params string[] permissions)
    {
        var client = await Tasks.UserWithAsync(account, permissions);
        var roleId = Convert.ToInt32(await SqlServerFixture.ScalarAsync(AppConnection, $"SELECT RoleId FROM dbo.Role WHERE Name = N'Role {account.Replace("'", "''")}'"), CultureInfo.InvariantCulture);
        return (client, roleId);
    }

    /// <summary>Inserts an active report with one version and assigns it to the roles. Returns the report id.</summary>
    public async Task<int> AddReportAsync(string sqlText, string parametersJson = "[]", int? timeoutSeconds = null, int? maxRows = null, bool active = true, byte[]? hashOverride = null, params int[] roleIds)
    {
        var n = Interlocked.Increment(ref _reports);
        var hash = Convert.ToHexString(hashOverride ?? SqlValidator.Hash(sqlText));
        var script = $"""
            IF NOT EXISTS (SELECT 1 FROM dbo.ReportCategory WHERE Name = N'Test') INSERT dbo.ReportCategory (Name) VALUES (N'Test');
            DECLARE @cat int = (SELECT ReportCategoryId FROM dbo.ReportCategory WHERE Name = N'Test');
            INSERT dbo.ReportDefinition (ReportCategoryId, Name, IsActive, TimeoutSeconds, MaxRows) VALUES (@cat, N'Report {n}', 0, @timeout, @maxRows);
            DECLARE @r int = SCOPE_IDENTITY();
            INSERT dbo.ReportVersion (ReportId, VersionNo, SqlText, SqlHash, ParametersJson) VALUES (@r, 1, @sql, 0x{hash}, @params);
            DECLARE @v int = SCOPE_IDENTITY();
            UPDATE dbo.ReportDefinition SET CurrentVersionId = @v, IsActive = @active WHERE ReportId = @r;
            SELECT @r;
            """;
        await using var connection = new SqlConnection(AppConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = script;
        command.Parameters.AddWithValue("@sql", sqlText);
        command.Parameters.AddWithValue("@params", parametersJson);
        command.Parameters.AddWithValue("@timeout", (object?)timeoutSeconds ?? DBNull.Value);
        command.Parameters.AddWithValue("@maxRows", (object?)maxRows ?? DBNull.Value);
        command.Parameters.AddWithValue("@active", active);
        var reportId = Convert.ToInt32(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture);
        foreach (var role in roleIds)
            await SqlServerFixture.ExecuteAsync(AppConnection, $"INSERT dbo.RoleReport (RoleId, ReportId) VALUES ({role}, {reportId})");
        return reportId;
    }

    public static StringContent Json(object value) => TaskHarness.Body(value);

    public static StringContent Parameters(object values) => TaskHarness.Body(new { parameters = values });

    public async Task<JsonElement> RunLogAsync(int reportId)
    {
        await using var connection = new SqlConnection(AppConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT ReportRunId, Status, Kind, [RowCount], Truncated, ErrorCode, ParametersJson, UserId, FinishedAt FROM dbo.ReportRun WHERE ReportId = @r ORDER BY ReportRunId FOR JSON PATH";
        command.Parameters.AddWithValue("@r", reportId);
        var json = (string?)await command.ExecuteScalarAsync() ?? "[]";
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    public async ValueTask DisposeAsync() => await Factory.DisposeAsync();
}
