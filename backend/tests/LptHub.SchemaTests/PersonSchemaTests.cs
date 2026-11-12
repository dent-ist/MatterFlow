using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Scripts 71 and 72 (epic #1373, issue #1374): dbo.Person with its checks, and the one-time backfill of a person for every existing user.</summary>
[Collection(SqlServerCollection.Name)]
public class PersonSchemaTests(SqlServerFixture sql)
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

    private static string ScriptText(string name)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "db", "scripts", name)))
            dir = dir.Parent;
        return File.ReadAllText(Path.Combine(dir?.FullName ?? throw new FileNotFoundException(name), "db", "scripts", name));
    }

    [Fact]
    public async Task The_checks_keep_company_for_external_people_and_user_persons_internal_and_unique()
    {
        var cs = await MigratedAsync();
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Person")).ShouldBe(0); // a fresh database has no users, so script 72 adds nobody
        await ScalarAsync(cs, "INSERT dbo.AppUser (DisplayName) VALUES (N'Sam Lee')");
        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, LastName, PersonType, CompanyName) VALUES (N'Ext', N'Person', 'EXTERNAL', N'Acme')");

        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, CompanyName) VALUES (N'In', 'INTERNAL', N'Acme')"))).Message.ShouldContain("CK_Person_Company");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType) VALUES (N'Odd', 'ROBOT')"))).Message.ShouldContain("CK_Person_Type");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType) VALUES (N'   ', 'INTERNAL')"))).Message.ShouldContain("CK_Person_FirstName");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, UserId) SELECT N'Ext', 'EXTERNAL', UserId FROM dbo.AppUser"))).Message.ShouldContain("CK_Person_User");

        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, UserId) SELECT N'Sam', 'INTERNAL', UserId FROM dbo.AppUser");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType, UserId) SELECT N'Sam', 'INTERNAL', UserId FROM dbo.AppUser"))).Message.ShouldContain("UQ_Person_User");
        // Several hand-made people have no user: the unique index ignores NULL.
        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, PersonType) VALUES (N'A', 'INTERNAL'), (N'B', 'INTERNAL')");
    }

    [Fact]
    public async Task The_backfill_adds_one_internal_person_per_existing_user_with_the_application_name_rule_and_runs_once()
    {
        var cs = await MigratedAsync();
        await ScalarAsync(cs, "INSERT dbo.AppUser (DisplayName, Email, IsActive) VALUES (N'Mary Ann Smith', N' mary@firm.example ', 1), (N'Cher', NULL, 1), (N'  Pat   Lee ', N'', 0), (N'Linked Already', NULL, 1)");
        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, LastName, PersonType, UserId) SELECT N'Linked', N'Already', 'INTERNAL', UserId FROM dbo.AppUser WHERE DisplayName = N'Linked Already'");

        var script = ScriptText("72-person-for-existing-users.sql");
        foreach (var batch in script.Split("\nGO", StringSplitOptions.RemoveEmptyEntries))
            await ScalarAsync(cs, batch);
        foreach (var batch in script.Split("\nGO", StringSplitOptions.RemoveEmptyEntries))
            await ScalarAsync(cs, batch); // idempotent in effect: NOT EXISTS

        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Person")).ShouldBe(4);
        (await ScalarAsync(cs, "SELECT CONCAT(p.FirstName, '|', p.LastName, '|', p.PersonType, '|', ISNULL(p.Email, '-'), '|', p.IsActive) FROM dbo.Person p JOIN dbo.AppUser u ON u.UserId = p.UserId WHERE u.DisplayName = N'Mary Ann Smith'")).ShouldBe("Mary Ann|Smith|INTERNAL|mary@firm.example|1");
        (await ScalarAsync(cs, "SELECT CONCAT(p.FirstName, '|', p.LastName) FROM dbo.Person p JOIN dbo.AppUser u ON u.UserId = p.UserId WHERE u.DisplayName = N'Cher'")).ShouldBe("Cher|");
        (await ScalarAsync(cs, "SELECT CONCAT(p.FirstName, '|', p.LastName, '|', ISNULL(p.Email, '-'), '|', p.IsActive) FROM dbo.Person p JOIN dbo.AppUser u ON u.UserId = p.UserId WHERE u.IsActive = 0")).ShouldBe("Pat|Lee|-|1");
    }
}
