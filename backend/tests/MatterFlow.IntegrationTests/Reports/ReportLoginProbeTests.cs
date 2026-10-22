using System.Net;
using System.Net.Http.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using MatterFlow.Reports.Api;
using Microsoft.Data.SqlClient;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>
/// The report login against a real SQL Server (epic #671, issue #684): the connection guard, the startup probe and what it says for the demo
/// login, an unprovisioned login, over-privileged logins (db_owner, sysadmin, the application role) and a wrong password. The login itself is
/// exercised directly: it must read business data and nothing else.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportLoginProbeTests(SqlServerFixture sql)
{
    private const string Status = "/api/v1/report-admin/status";
    private const string Check = "/api/v1/report-admin/status/check";

    private static string RepoFile(params string[] parts)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
            dir = dir.Parent;
        return Path.Combine([dir!.FullName, .. parts]);
    }

    /// <summary>Starts the API on an empty database (which migrates it) and returns a client holding Report.Manage.</summary>
    private async Task<(DatabaseApiFactory Factory, HttpClient Manager, string AppCs)> StartAsync(Func<string, Task<string?>> reportsConnection)
    {
        var appCs = await sql.CreateDatabaseAsync();
        var factory = new DatabaseApiFactory(appCs, reportsConnectionString: await reportsConnection(appCs));
        var manager = await new TaskHarness(factory).UserWithAsync(@"KE\manager", "Report.Manage");
        return (factory, manager, appCs);
    }

    private static async Task<ReportsStatusResponse> PostCheckAsync(HttpClient manager)
    {
        var response = await manager.PostAsync(Check, null);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<ReportsStatusResponse>())!;
    }

    [Fact]
    public async Task Without_a_report_connection_reports_are_off_and_say_why()
    {
        var (factory, manager, _) = await StartAsync(_ => Task.FromResult<string?>(null));
        await using var _f = factory;

        var status = await PostCheckAsync(manager);

        status.Enabled.ShouldBeFalse();
        status.State.ShouldBe("NotConfigured");
        status.Login.ShouldBeNull();
    }

    [Fact]
    public async Task The_application_connection_is_never_accepted_as_the_report_connection()
    {
        var (factory, manager, _) = await StartAsync(cs => Task.FromResult<string?>(cs));
        await using var _f = factory;

        var status = await PostCheckAsync(manager);

        status.Enabled.ShouldBeFalse();
        status.State.ShouldBe("SharedWithApplication");
    }

    [Fact]
    public async Task The_demo_provisioning_script_gives_a_ready_login_and_is_idempotent()
    {
        // The demo login keeps its fixed name mf_reports, so the connection string is built from the container's own address.
        var (factory, manager, appCs) = await StartAsync(cs =>
            Task.FromResult<string?>(new SqlConnectionStringBuilder(cs) { UserID = "mf_reports", Password = "MatterFlow_Reports1!", IntegratedSecurity = false }.ConnectionString));
        await using var _f = factory;
        var script = await File.ReadAllTextAsync(RepoFile("tools", "db", "provision-report-login.sql"));

        (await PostCheckAsync(manager)).State.ShouldBe("LoginFailed"); // nothing provisioned yet: no login
        await SqlServerFixture.ExecuteAsync(appCs, script); // the API has migrated by now (the manager above made requests)
        await SqlServerFixture.ExecuteAsync(appCs, script); // again: cheap and harmless
        var status = await PostCheckAsync(manager);

        status.Enabled.ShouldBeTrue(status.Message);
        status.State.ShouldBe("Ready");
        status.Login.ShouldNotBeNull();
        status.Login.LoginName.ShouldBe("mf_reports");
        status.Login.WritesDenied.ShouldBeTrue();
        status.Login.AuditTablesDenied.ShouldBeTrue();
        status.Login.ReadableTables.ShouldBeGreaterThan(30);
        status.Login.CompatibilityLevel.ShouldBeGreaterThanOrEqualTo(130);
        (await manager.GetFromJsonAsync<ReportsStatusResponse>(Status))!.State.ShouldBe("Ready");
    }

    [Fact]
    public async Task A_login_that_is_not_in_the_report_role_is_reported_and_turns_ready_once_it_is()
    {
        ReportLogin? login = null;
        var (factory, manager, appCs) = await StartAsync(async cs => (login = await sql.CreateServerLoginAsync(cs)).ConnectionString);
        await using var _f = factory;
        await SqlServerFixture.CreateDatabaseUserAsync(appCs, login!.Name); // user, but no role

        var before = await PostCheckAsync(manager);
        before.Enabled.ShouldBeFalse();
        before.State.ShouldBe("RoleMissing");

        await SqlServerFixture.ExecuteAsync(appCs, $"ALTER ROLE mf_report_reader ADD MEMBER [{login.Name}]");
        (await PostCheckAsync(manager)).State.ShouldBe("Ready");
    }

    [Theory]
    [InlineData("db_owner", null)]
    [InlineData("db_datareader", null)]
    [InlineData("mf_app", null)]
    [InlineData("mf_report_reader", "db_datawriter")]
    [InlineData(null, "sysadmin")]
    public async Task A_login_with_more_rights_than_a_reader_keeps_reports_off(string? databaseRole, string? extra)
    {
        // Rights are added on top of (or instead of) the report role: any of them is too much.
        var serverRole = extra == "sysadmin" ? "sysadmin" : null;
        ReportLogin? login = null;
        var (factory, manager, appCs) = await StartAsync(async cs => (login = await sql.CreateServerLoginAsync(cs, serverRole)).ConnectionString);
        await using var _f = factory;
        var roles = new[] { "mf_report_reader", databaseRole, serverRole is null ? extra : null }.Where(r => r is not null).Cast<string>().Distinct().ToArray();
        await SqlServerFixture.CreateDatabaseUserAsync(appCs, login!.Name, roles);

        var status = await PostCheckAsync(manager);

        status.Enabled.ShouldBeFalse();
        status.State.ShouldBe("TooPrivileged");
        status.Message.ShouldContain("too many rights");
    }

    [Fact]
    public async Task A_wrong_password_is_reported_without_echoing_secrets_or_server_text()
    {
        ReportLogin? login = null;
        var (factory, manager, _) = await StartAsync(async cs =>
        {
            login = await sql.CreateServerLoginAsync(cs);
            return new SqlConnectionStringBuilder(login.ConnectionString) { Password = "Wrong!Passw0rd#1" }.ConnectionString;
        });
        await using var _f = factory;

        var status = await PostCheckAsync(manager);

        status.Enabled.ShouldBeFalse();
        status.State.ShouldBe("LoginFailed");
        status.Message.ShouldNotContain("Wrong!Passw0rd#1");
        status.Message.ShouldNotContain(login!.Name);
        status.Message.ShouldContain("SQL error");
    }

    [Fact]
    public async Task The_status_check_endpoint_needs_Report_Manage()
    {
        var (factory, _, _) = await StartAsync(_ => Task.FromResult<string?>(null));
        await using var _f = factory;
        var runner = await new TaskHarness(factory).UserWithAsync(@"KE\runner", "Report.Run", "Report.Assign");

        (await runner.PostAsync(Check, null)).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_report_login_itself_reads_business_data_and_nothing_else()
    {
        ReportLogin? login = null;
        var (factory, manager, appCs) = await StartAsync(async cs => (login = await sql.CreateServerLoginAsync(cs)).ConnectionString);
        await using var _f = factory;
        await SqlServerFixture.CreateDatabaseUserAsync(appCs, login!.Name, "mf_report_reader");
        (await PostCheckAsync(manager)).State.ShouldBe("Ready");
        var reader = login.ConnectionString;

        (await SqlServerFixture.ScalarAsync(reader, "SELECT COUNT(*) FROM dbo.AppUser")).ShouldNotBeNull();
        foreach (var denied in new[] { "SELECT COUNT(*) FROM dbo.AuditEvent", "SELECT COUNT(*) FROM dbo.UserIdentity", "SELECT COUNT(*) FROM dbo.ReportVersion",
                     "SELECT COUNT(*) FROM dbo.SeedMarker", "SELECT COUNT(*) FROM dbo.SchemaMigration" })
            (await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ScalarAsync(reader, denied))).Message.ShouldContain("permission was denied");
        foreach (var write in new[] { "DELETE dbo.Task", "UPDATE dbo.AppUser SET DisplayName = N'x'", "CREATE TABLE dbo.X (Id int)", "EXEC xp_cmdshell 'whoami'" })
            await Should.ThrowAsync<SqlException>(() => SqlServerFixture.ScalarAsync(reader, write));
    }
}
