using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Scripts 73 to 75 (epic #1373, issue #1377): vendors, the Services and Areas lists with their starter rows, vendor contacts and the vendor-to-matter link.</summary>
[Collection(SqlServerCollection.Name)]
public class VendorSchemaTests(SqlServerFixture sql)
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

    private static async Task<string> FailureAsync(string cs, string text) => (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, text))).Message;

    [Fact]
    public async Task Services_and_areas_start_with_the_owner_values_and_script_75_never_touches_an_administrators_list()
    {
        var cs = await MigratedAsync();
        (await ScalarAsync(cs, "SELECT STRING_AGG(Name, ', ') WITHIN GROUP (ORDER BY SortOrder) FROM dbo.VendorServiceOption")).ShouldBe("eDiscovery, Forensic, Review, Custom development, Forensic accounting, ITAR");
        (await ScalarAsync(cs, "SELECT STRING_AGG(Name, ', ') WITHIN GROUP (ORDER BY SortOrder) FROM dbo.VendorAreaOption")).ShouldBe("US, EU, Asia");

        var own = await sql.CreateDatabaseAsync();
        var all = new EmbeddedMigrationScriptSource().ReadAll();
        await new SchemaMigrationRunner(own, new InMemoryMigrationScriptSource(all.Where(s => int.Parse(s.Name[..s.Name.IndexOf('-')], System.Globalization.CultureInfo.InvariantCulture) < 75) /* every script before 75: later scripts (76 and up) may not run ahead of it */), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        await ScalarAsync(own, "INSERT dbo.VendorServiceOption (Name, SortOrder) VALUES (N'Mine', 1)");
        await new SchemaMigrationRunner(own, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        (await ScalarAsync(own, "SELECT STRING_AGG(Name, ', ') FROM dbo.VendorServiceOption")).ShouldBe("Mine");
        (await ScalarAsync(own, "SELECT STRING_AGG(Name, ', ') WITHIN GROUP (ORDER BY SortOrder) FROM dbo.VendorAreaOption")).ShouldBe("US, EU, Asia"); // the empty list was seeded
    }

    [Fact]
    public async Task Names_are_unique_and_not_blank_and_the_category_and_flag_codes_are_checked()
    {
        var cs = await MigratedAsync();
        (await FailureAsync(cs, "INSERT dbo.VendorServiceOption (Name, SortOrder) VALUES (N'ITAR', 9)")).ShouldContain("UQ_VendorServiceOption_Name");
        (await FailureAsync(cs, "INSERT dbo.VendorAreaOption (Name, SortOrder) VALUES (N'   ', 9)")).ShouldContain("CK_VendorAreaOption_Name");

        await ScalarAsync(cs, "INSERT dbo.Vendor (Name, CategoryCode) VALUES (N'Acme', 'PREFERRED')");
        (await FailureAsync(cs, "INSERT dbo.Vendor (Name, CategoryCode) VALUES (N'ACME', 'PREFERRED')")).ShouldContain("UQ_Vendor_Name");
        (await FailureAsync(cs, "INSERT dbo.Vendor (Name, CategoryCode) VALUES (N'Other', 'GOOD')")).ShouldContain("CK_Vendor_Category");
        await ScalarAsync(cs, "INSERT dbo.Vendor (Name, CategoryCode) VALUES (N'Plain', 'NEUTRAL')"); // script 77
        await ScalarAsync(cs, "INSERT dbo.Vendor (Name) VALUES (N'Unspecified')");
        (await ScalarAsync(cs, "SELECT CategoryCode FROM dbo.Vendor WHERE Name = N'Unspecified'")).ShouldBe("NEUTRAL");
        await ScalarAsync(cs, "DELETE dbo.Vendor WHERE Name IN (N'Plain', N'Unspecified')"); // the contact checks below read the one vendor 'Acme'
        (await FailureAsync(cs, "INSERT dbo.Vendor (Name, CategoryCode) VALUES (N' ', 'PREFERRED')")).ShouldContain("CK_Vendor_Name");

        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, LastName, PersonType) VALUES (N'Pat', N'Lee', 'EXTERNAL')");
        var ids = "(SELECT VendorId FROM dbo.Vendor), (SELECT PersonId FROM dbo.Person)";
        (await FailureAsync(cs, $"INSERT dbo.VendorContact (VendorId, PersonId, FlagCode) VALUES ({ids}, 'MAYBE')")).ShouldContain("CK_VendorContact_Flag");
        (await FailureAsync(cs, $"INSERT dbo.VendorContact (VendorId, PersonId, FlagCode, Note) VALUES ({ids}, 'NONE', N'a note without a flag')")).ShouldContain("CK_VendorContact_Report");
        await ScalarAsync(cs, $"INSERT dbo.VendorContact (VendorId, PersonId, FlagCode, ReportedOn) VALUES ({ids}, 'DO_NOT_HIRE', '2026-03-18')");
        (await FailureAsync(cs, $"INSERT dbo.VendorContact (VendorId, PersonId) VALUES ({ids})")).ShouldContain("UQ_VendorContact_VendorPerson");
    }

    [Fact]
    public async Task A_vendor_with_a_matter_link_or_a_used_option_cannot_be_deleted_and_contacts_go_with_the_vendor()
    {
        var cs = await MigratedAsync();
        await ScalarAsync(cs, "INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client')");
        await ScalarAsync(cs, "INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) SELECT ClientId, ClientNumber, '00001', N'M' FROM dbo.Client");
        await ScalarAsync(cs, "INSERT dbo.Vendor (Name, CategoryCode) VALUES (N'Linked', 'PREFERRED')");
        await ScalarAsync(cs, "INSERT dbo.VendorMatter (VendorId, MatterId) SELECT VendorId, (SELECT MatterId FROM dbo.Matter) FROM dbo.Vendor");
        (await FailureAsync(cs, "DELETE dbo.Vendor")).ShouldContain("FK_VendorMatter_Vendor");
        (await FailureAsync(cs, "INSERT dbo.VendorMatter (VendorId, MatterId) SELECT VendorId, (SELECT MatterId FROM dbo.Matter) FROM dbo.Vendor")).ShouldContain("PK_VendorMatter");
        await ScalarAsync(cs, "DELETE dbo.VendorMatter");

        await ScalarAsync(cs, "INSERT dbo.Person (FirstName, LastName, PersonType) VALUES (N'Pat', N'Lee', 'EXTERNAL')");
        await ScalarAsync(cs, "INSERT dbo.VendorContact (VendorId, PersonId) SELECT VendorId, (SELECT PersonId FROM dbo.Person) FROM dbo.Vendor");
        await ScalarAsync(cs, "INSERT dbo.VendorTechAi (VendorId, Name, SortOrder) SELECT VendorId, N'Model', 1 FROM dbo.Vendor");
        await ScalarAsync(cs, "INSERT dbo.VendorServiceChoice (VendorId, VendorServiceOptionId) SELECT VendorId, (SELECT TOP 1 VendorServiceOptionId FROM dbo.VendorServiceOption) FROM dbo.Vendor");
        (await FailureAsync(cs, "DELETE dbo.VendorServiceOption")).ShouldContain("FK_VendorServiceChoice_Option");

        await ScalarAsync(cs, "DELETE dbo.Vendor");
        (await ScalarAsync(cs, "SELECT (SELECT COUNT(*) FROM dbo.VendorContact) + (SELECT COUNT(*) FROM dbo.VendorTechAi) + (SELECT COUNT(*) FROM dbo.VendorServiceChoice)")).ShouldBe(0);
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.Person")).ShouldBe(1); // the person stays
    }

    [Fact]
    public async Task Script_77_allows_neutral_and_keeps_the_category_of_existing_vendors()
    {
        var own = await sql.CreateDatabaseAsync();
        var all = new EmbeddedMigrationScriptSource().ReadAll();
        await new SchemaMigrationRunner(own, new InMemoryMigrationScriptSource(all.Where(s => int.Parse(s.Name[..s.Name.IndexOf('-')], System.Globalization.CultureInfo.InvariantCulture) < 77)), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        await ScalarAsync(own, "INSERT dbo.Vendor (Name, CategoryCode) VALUES (N'Kept Preferred', 'PREFERRED'), (N'Kept Blacklisted', 'BLACKLISTED')");
        (await FailureAsync(own, "INSERT dbo.Vendor (Name, CategoryCode) VALUES (N'Early', 'NEUTRAL')")).ShouldContain("CK_Vendor_Category");

        await new SchemaMigrationRunner(own, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        (await ScalarAsync(own, "SELECT STRING_AGG(CategoryCode, ',') WITHIN GROUP (ORDER BY Name) FROM dbo.Vendor")).ShouldBe("BLACKLISTED,PREFERRED");
        await ScalarAsync(own, "INSERT dbo.Vendor (Name, CategoryCode) VALUES (N'Now Neutral', 'NEUTRAL')");
        (await FailureAsync(own, "INSERT dbo.Vendor (Name, CategoryCode) VALUES (N'Other', 'GOOD')")).ShouldContain("CK_Vendor_Category");
    }
}
