using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Script 76 (epic #1373, issue #1376): a matter's team rows point at the People list (dbo.Person); the typed-in name and e-mail are gone.</summary>
[Collection(SqlServerCollection.Name)]
public class MatterTeamPersonSchemaTests(SqlServerFixture sql)
{
    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    private static MigrationsOptions Options => new() { LockTimeoutSeconds = 60 };

    [Fact]
    public async Task Existing_team_rows_keep_working_each_email_becomes_one_person_and_the_old_columns_and_rule_are_gone()
    {
        var cs = await sql.CreateDatabaseAsync();
        var all = new EmbeddedMigrationScriptSource().ReadAll();
        await new SchemaMigrationRunner(cs, new InMemoryMigrationScriptSource(all.Where(s => string.CompareOrdinal(s.Name, "76-") < 0)), Options, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

        await ScalarAsync(cs, "INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client')");
        await ScalarAsync(cs, "INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) SELECT ClientId, ClientNumber, '00001', N'First' FROM dbo.Client");
        await ScalarAsync(cs, "INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) SELECT ClientId, ClientNumber, '00002', N'Second' FROM dbo.Client");
        await ScalarAsync(cs, "INSERT dbo.TeamTitle (Name, SortOrder) VALUES (N'Attorney', 1)");
        // A person that already has the address (other letter case): the row points at that person, no second person is made.
        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, LastName, PersonType, Email) VALUES (N'Ann', N'Lee', 'INTERNAL', N'ann.lee@firm.example')");
        await ScalarAsync(cs, @"
            INSERT dbo.MatterTeamMember (MatterId, Name, Email, TeamTitleId, SortOrder)
            SELECT m.MatterId, v.Name, v.Email, (SELECT TeamTitleId FROM dbo.TeamTitle), v.SortOrder
            FROM dbo.Matter m JOIN (VALUES
              ('00001', N'Ann Q. Lee', N'ANN.LEE@firm.example', 1),
              ('00001', N'Dev Patel', N'dev.patel@outside.example', 2),
              ('00002', N'D. Patel', N'Dev.Patel@outside.example', 1),
              ('00002', N'Cher', N'cher@outside.example', 2)) v (Number, Name, Email, SortOrder) ON v.Number = m.MatterNumber");

        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), Options, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

        // Ann points at the existing person; Dev Patel (two matters, two spellings) is ONE new External person named from the first row; the single word stays a first name.
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Person")).ShouldBe(3);
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.MatterTeamMember")).ShouldBe(4);
        (await ScalarAsync(cs, "SELECT COUNT(DISTINCT PersonId) FROM dbo.MatterTeamMember")).ShouldBe(3);
        (await ScalarAsync(cs, "SELECT CONCAT(p.FirstName, '|', p.LastName) FROM dbo.MatterTeamMember t JOIN dbo.Person p ON p.PersonId = t.PersonId JOIN dbo.Matter m ON m.MatterId = t.MatterId WHERE m.MatterNumber = '00001' AND t.SortOrder = 1")).ShouldBe("Ann|Lee");
        (await ScalarAsync(cs, "SELECT CONCAT(p.FirstName, '|', p.LastName, '|', p.PersonType, '|', p.Email, '|', p.IsActive) FROM dbo.Person p WHERE p.Email = N'dev.patel@outside.example'")).ShouldBe("Dev|Patel|EXTERNAL|dev.patel@outside.example|1");
        (await ScalarAsync(cs, "SELECT CONCAT(p.FirstName, '|', p.LastName) FROM dbo.Person p WHERE p.Email = N'cher@outside.example'")).ShouldBe("Cher|");

        // The typed-in columns and the per-matter e-mail rule are gone; the person is required, on a matter once, and a person in use cannot be deleted.
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MatterTeamMember') AND name IN ('Name', 'Email')")).ShouldBe(0);
        (await ScalarAsync(cs, "SELECT is_nullable FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MatterTeamMember') AND name = 'PersonId'")).ShouldBe(false);
        var twice = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.MatterTeamMember (MatterId, PersonId, TeamTitleId, SortOrder) SELECT TOP 1 MatterId, PersonId, TeamTitleId, 9 FROM dbo.MatterTeamMember"));
        twice.Message.ShouldContain("UQ_MatterTeamMember_MatterPerson");
        var missing = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.MatterTeamMember (MatterId, PersonId, TeamTitleId, SortOrder) SELECT TOP 1 MatterId, 999999, TeamTitleId, 9 FROM dbo.MatterTeamMember"));
        missing.Message.ShouldContain("FK_MatterTeamMember_Person");
        var inUse = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "DELETE dbo.Person WHERE Email = N'cher@outside.example'"));
        inUse.Message.ShouldContain("FK_MatterTeamMember_Person");
    }
}
