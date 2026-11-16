using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Script 80 (epic #1389, issue #1395): the one Entra ID connection row, the integrations with their seeded Matter Lookup and Ethical Wall rows, their constraints, and who may read or change them.</summary>
[Collection(SqlServerCollection.Name)]
public class IntegrationsSchemaTests(SqlServerFixture sql)
{
    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        return cs;
    }

    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task<string> FailureAsync(string cs, string text) => (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, text), text)).Message;

    private static async Task<string> LoginInRoleAsync(string adminConnectionString, string role)
    {
        var name = "t_" + Guid.NewGuid().ToString("N")[..12];
        const string password = "Tr1cky!Passw0rd#2026";
        await ScalarAsync(adminConnectionString, $"CREATE LOGIN [{name}] WITH PASSWORD = '{password}', CHECK_POLICY = OFF");
        await ScalarAsync(adminConnectionString, $"CREATE USER [{name}] FOR LOGIN [{name}]; ALTER ROLE {role} ADD MEMBER [{name}];");
        return new SqlConnectionStringBuilder(adminConnectionString) { UserID = name, Password = password, IntegratedSecurity = false }.ConnectionString;
    }

    [Fact]
    public async Task The_script_seeds_one_empty_connection_and_the_two_fixed_integrations_not_set_up()
    {
        var cs = await MigratedAsync();

        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.EntraConnection WHERE EntraConnectionId = 1 AND TenantId IS NULL AND ClientId IS NULL AND ClientSecretProtected IS NULL")).ShouldBe(1);
        (await ScalarAsync(cs, "SELECT STRING_AGG(Name + ':' + TypeCode + ':' + CAST(IsEnabled AS VARCHAR(1)) + ':' + ISNULL(BaseUrl, '-') + ':' + ISNULL(Scope, '-'), '|') WITHIN GROUP (ORDER BY IntegrationId) FROM dbo.Integration"))
            .ShouldBe("Matter Lookup:MATTER_LOOKUP:1:-:-|Ethical Wall:ETHICAL_WALL:1:-:-");
    }

    [Fact]
    public async Task There_is_only_ever_one_connection_row()
    {
        var cs = await MigratedAsync();

        (await FailureAsync(cs, "INSERT dbo.EntraConnection (EntraConnectionId) VALUES (2)")).ShouldContain("CK_EntraConnection_Single");
        (await FailureAsync(cs, "INSERT dbo.EntraConnection (EntraConnectionId) VALUES (1)")).ShouldContain("PK_EntraConnection");
        (await FailureAsync(cs, "UPDATE dbo.EntraConnection SET LastTestOutcome = 'MAYBE'")).ShouldContain("CK_EntraConnection_Outcome");
    }

    [Fact]
    public async Task At_most_one_matter_lookup_and_one_ethical_wall_but_any_number_of_other()
    {
        var cs = await MigratedAsync();

        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode) VALUES (N'Second', 'MATTER_LOOKUP')")).ShouldContain("UQ_Integration_FixedType");
        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode) VALUES (N'Second', 'ETHICAL_WALL')")).ShouldContain("UQ_Integration_FixedType");
        await ScalarAsync(cs, "INSERT dbo.Integration (Name, TypeCode) VALUES (N'Billing', 'OTHER'), (N'Records', 'OTHER')");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Integration WHERE TypeCode = 'OTHER'")).ShouldBe(2);
        await ScalarAsync(cs, "DELETE dbo.Integration WHERE TypeCode = 'MATTER_LOOKUP'");
        await ScalarAsync(cs, "INSERT dbo.Integration (Name, TypeCode) VALUES (N'Matter Lookup again', 'MATTER_LOOKUP')"); // the type is free again once the row is deleted
    }

    [Fact]
    public async Task Names_are_unique_and_not_blank_the_type_is_checked_the_base_url_is_https_and_the_scope_has_a_sane_length()
    {
        var cs = await MigratedAsync();

        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode) VALUES (N'matter lookup', 'OTHER')")).ShouldContain("UQ_Integration_Name");
        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode) VALUES (N'  ', 'OTHER')")).ShouldContain("CK_Integration_Name");
        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode) VALUES (N'X', 'SOMETHING')")).ShouldContain("CK_Integration_Type");
        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode, BaseUrl) VALUES (N'X', 'OTHER', 'http://plain.example.test')")).ShouldContain("CK_Integration_BaseUrl");
        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode, BaseUrl) VALUES (N'X', 'OTHER', 'https://')")).ShouldContain("CK_Integration_BaseUrl");
        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode, BaseUrl) VALUES (N'X', 'OTHER', 'ftp://x.test')")).ShouldContain("CK_Integration_BaseUrl");
        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode, Scope) VALUES (N'X', 'OTHER', N'ab')")).ShouldContain("CK_Integration_Scope");
        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode, Scope) VALUES (N'X', 'OTHER', N'   ')")).ShouldContain("CK_Integration_Scope");
        (await FailureAsync(cs, "INSERT dbo.Integration (Name, TypeCode, LastTestOutcome) VALUES (N'X', 'OTHER', 'GREAT')")).ShouldContain("CK_Integration_Outcome");
        await ScalarAsync(cs, "INSERT dbo.Integration (Name, TypeCode, BaseUrl, Scope, LastTestOutcome) VALUES (N'Good', 'OTHER', 'https://good.example.test/api', N'api://00000000-0000-0000-0000-000000000000/.default', 'API_REFUSED')");
    }

    [Fact]
    public async Task The_application_reads_and_updates_the_connection_but_cannot_add_or_delete_its_row_and_cannot_change_the_schema()
    {
        var admin = await MigratedAsync();
        var app = await LoginInRoleAsync(admin, "lpt_app");

        await ScalarAsync(app, "UPDATE dbo.EntraConnection SET TenantId = N'contoso.example', ClientId = N'00000000-0000-0000-0000-000000000001'");
        (await ScalarAsync(app, "SELECT TenantId FROM dbo.EntraConnection")).ShouldBe("contoso.example");
        (await FailureAsync(app, "DELETE dbo.EntraConnection")).ShouldContain("permission was denied");
        (await FailureAsync(app, "INSERT dbo.EntraConnection (EntraConnectionId) VALUES (2)")).ShouldContain("permission was denied");
        (await FailureAsync(app, "ALTER TABLE dbo.EntraConnection ADD X INT")).ShouldContain("permission");

        await ScalarAsync(app, "INSERT dbo.Integration (Name, TypeCode) VALUES (N'Mine', 'OTHER')");
        await ScalarAsync(app, "UPDATE dbo.Integration SET IsEnabled = 0 WHERE Name = N'Mine'");
        await ScalarAsync(app, "DELETE dbo.Integration WHERE Name = N'Mine'");
        (await FailureAsync(app, "ALTER TABLE dbo.Integration ADD X INT")).ShouldContain("permission");
    }

    [Fact]
    public async Task The_report_login_cannot_read_the_encrypted_secret_or_the_integrations()
    {
        var admin = await MigratedAsync();
        await ScalarAsync(admin, "UPDATE dbo.EntraConnection SET ClientSecretProtected = N'CfDJ8-fake-protected-payload'");
        var reader = await LoginInRoleAsync(admin, "lpt_report_reader");

        (await FailureAsync(reader, "SELECT ClientSecretProtected FROM dbo.EntraConnection")).ShouldContain("permission was denied");
        (await FailureAsync(reader, "SELECT COUNT(*) FROM dbo.EntraConnection")).ShouldContain("permission was denied");
        (await FailureAsync(reader, "SELECT COUNT(*) FROM dbo.Integration")).ShouldContain("permission was denied");
        (await ScalarAsync(reader, "SELECT ISNULL(HAS_PERMS_BY_NAME('dbo.EntraConnection', 'OBJECT', 'VIEW DEFINITION'), 0)")).ShouldBe(0);
    }
}
