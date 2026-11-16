using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Script 79 (epic #1389, issue #1394): dbo.Office, dbo.EmploymentStatus and the Office, Employment Status and Industry Join Date columns of dbo.Person.</summary>
[Collection(SqlServerCollection.Name)]
public class PersonProfileFieldsSchemaTests(SqlServerFixture sql)
{
    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        return cs;
    }

    [Fact]
    public async Task The_status_list_is_seeded_in_order_there_are_starter_offices_and_names_are_unique_and_not_blank()
    {
        var cs = await MigratedAsync();
        (await ScalarAsync(cs, "SELECT STRING_AGG(Name, ', ') WITHIN GROUP (ORDER BY SortOrder) FROM dbo.EmploymentStatus")).ShouldBe("Active, On Leave, Departed");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Office")).ShouldBe(3);

        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Office (Name, SortOrder) VALUES (N'HEAD OFFICE', 9)"))).Message.ShouldContain("UQ_Office_Name");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Office (Name, SortOrder) VALUES (N'  ', 9)"))).Message.ShouldContain("CK_Office_Name");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.EmploymentStatus (Name, SortOrder) VALUES (N'active', 9)"))).Message.ShouldContain("UQ_EmploymentStatus_Name");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.EmploymentStatus (Name, SortOrder) VALUES (N'', 9)"))).Message.ShouldContain("CK_EmploymentStatus_Name");
    }

    [Fact]
    public async Task The_join_date_is_a_first_of_month_from_1950_and_only_internal_people_carry_the_three_fields()
    {
        var cs = await MigratedAsync();
        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, IndustryJoinDate, OfficeId, EmploymentStatusId) SELECT N'Ina', 'INTERNAL', '2018-03-01', (SELECT TOP 1 OfficeId FROM dbo.Office), (SELECT TOP 1 EmploymentStatusId FROM dbo.EmploymentStatus)");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, IndustryJoinDate) VALUES (N'Day', 'INTERNAL', '2018-03-15')"))).Message.ShouldContain("CK_Person_IndustryJoinDate");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, IndustryJoinDate) VALUES (N'Old', 'INTERNAL', '1949-12-01')"))).Message.ShouldContain("CK_Person_IndustryJoinDate");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, IndustryJoinDate) VALUES (N'Ext', 'EXTERNAL', '2018-03-01')"))).Message.ShouldContain("CK_Person_ProfileInternal");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, OfficeId) SELECT N'Ext', 'EXTERNAL', OfficeId FROM dbo.Office"))).Message.ShouldContain("CK_Person_ProfileInternal");
        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType) VALUES (N'Plain', 'EXTERNAL')"); // the three fields stay empty
    }

    [Fact]
    public async Task An_office_or_status_a_person_uses_cannot_be_deleted()
    {
        var cs = await MigratedAsync();
        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, OfficeId) SELECT N'Ina', 'INTERNAL', OfficeId FROM dbo.Office WHERE Name = N'Remote'");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "DELETE dbo.Office WHERE Name = N'Remote'"))).Message.ShouldContain("FK_Person_Office");
        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, EmploymentStatusId) SELECT N'Ben', 'INTERNAL', EmploymentStatusId FROM dbo.EmploymentStatus WHERE Name = N'Departed'");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "DELETE dbo.EmploymentStatus WHERE Name = N'Departed'"))).Message.ShouldContain("FK_Person_EmploymentStatus");
    }
}
