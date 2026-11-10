using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Scripts 52 to 55 (epic #1001): production specs, productions and comments, notes with tags and links, note templates, and the permission rows.</summary>
[Collection(SqlServerCollection.Name)]
public class ProductionsNotesSchemaTests(SqlServerFixture sql)
{
    private static Task RunAsync(string cs) =>
        new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();

    private static async Task<object?> ScalarAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task<(string Cs, int Matter, int Other, int User)> SeedAsync(SqlServerFixture sql)
    {
        var cs = await sql.CreateDatabaseAsync();
        await RunAsync(cs);
        var user = (int)(await ScalarAsync(cs, "INSERT dbo.AppUser (DisplayName, IsActive) VALUES (N'Notes User', 1); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        var client = (int)(await ScalarAsync(cs, "INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        var matter = (int)(await ScalarAsync(cs, $"INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES ({client}, '00001', '00001', N'Matter A'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        var other = (int)(await ScalarAsync(cs, $"INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES ({client}, '00001', '00002', N'Matter B'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        return (cs, matter, other, user);
    }

    [Fact]
    public async Task The_scripts_add_the_permission_rows_and_grant_them_to_no_role_in_an_empty_database()
    {
        var (cs, _, _, _) = await SeedAsync(sql);

        foreach (var code in new[] { "ProductionSpec.View", "ProductionSpec.Edit", "Production.View", "Production.Edit", "Production.Comment", "MatterNote.View", "MatterNote.Edit", "MatterNote.Delete" })
            (await ScalarAsync(cs, $"SELECT COUNT(*) FROM dbo.Permission WHERE Code = '{code}'")).ShouldBe(1, code);
        (await ScalarAsync(cs, "SELECT Description FROM dbo.Permission WHERE Code = 'MatterNote.View'")).ShouldBe("Matter Note Read");
    }

    [Fact]
    public async Task A_spec_name_is_unique_among_active_specs_only_and_the_matter_cannot_change()
    {
        var (cs, matter, other, _) = await SeedAsync(sql);
        await ScalarAsync(cs, $"INSERT dbo.ProductionSpec (MatterId, Name) VALUES ({matter}, N'ESI standard')");

        var duplicate = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.ProductionSpec (MatterId, Name) VALUES ({matter}, N'ESI standard')"));
        duplicate.Message.ShouldContain("UQ_ProductionSpec_ActiveName");

        await ScalarAsync(cs, $"INSERT dbo.ProductionSpec (MatterId, Name) VALUES ({other}, N'ESI standard')"); // another matter: fine
        await ScalarAsync(cs, $"UPDATE dbo.ProductionSpec SET StatusCode = 'Retired' WHERE MatterId = {matter}");
        await ScalarAsync(cs, $"INSERT dbo.ProductionSpec (MatterId, Name) VALUES ({matter}, N'ESI standard')"); // the retired name can be reused

        var move = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"UPDATE dbo.ProductionSpec SET MatterId = {other} WHERE MatterId = {matter} AND StatusCode = 'Retired'"));
        move.Message.ShouldContain("cannot move");

        var badStatus = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.ProductionSpec (MatterId, Name, StatusCode) VALUES ({matter}, N'X', 'Draft')"));
        badStatus.Message.ShouldContain("CK_ProductionSpec_Status");
        var badJson = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.ProductionSpec (MatterId, Name, MetadataFieldsJson) VALUES ({matter}, N'Y', N'not json')"));
        badJson.Message.ShouldContain("CK_ProductionSpec_Fields");
    }

    [Fact]
    public async Task A_production_uses_a_spec_of_its_own_matter_and_its_comments_go_with_it()
    {
        var (cs, matter, other, _) = await SeedAsync(sql);
        var spec = (int)(await ScalarAsync(cs, $"INSERT dbo.ProductionSpec (MatterId, Name) VALUES ({other}, N'Other matter spec'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;

        var foreign = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.Production (MatterId, Name, DirectionCode, ProductionSpecId) VALUES ({matter}, N'P1', 'OUT', {spec})"));
        foreign.Message.ShouldContain("FK_Production_Spec");

        var production = (int)(await ScalarAsync(cs, $"INSERT dbo.Production (MatterId, Name, DirectionCode, BatesBegin, BatesEnd, DocCount) VALUES ({matter}, N'P1', 'IN', 'ABC000001', 'ABC000100', 10); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        await ScalarAsync(cs, $"INSERT dbo.ProductionComment (ProductionId, MatterId, Body) VALUES ({production}, {matter}, N'First')");

        var wrongMatter = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.ProductionComment (ProductionId, MatterId, Body) VALUES ({production}, {other}, N'Wrong')"));
        wrongMatter.Message.ShouldContain("FK_ProductionComment_Production");
        var badDirection = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.Production (MatterId, Name, DirectionCode) VALUES ({matter}, N'P2', 'XYZ')"));
        badDirection.Message.ShouldContain("CK_Production_Direction");
        var negative = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.Production (MatterId, Name, DirectionCode, DocCount) VALUES ({matter}, N'P3', 'OUT', -1)"));
        negative.Message.ShouldContain("CK_Production_Counts");

        await ScalarAsync(cs, $"DELETE dbo.Production WHERE ProductionId = {production}");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.ProductionComment")).ShouldBe(0);
    }

    [Fact]
    public async Task A_note_lock_is_both_columns_or_neither_and_tags_and_links_follow_the_note()
    {
        var (cs, matter, _, user) = await SeedAsync(sql);
        var tag = (int)(await ScalarAsync(cs, "INSERT dbo.NoteTag (Name, ColourKey) VALUES (N'Privilege', 'red'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        var note = (int)(await ScalarAsync(cs, $"INSERT dbo.Note (MatterId, Title, BodyHtml, BodyText) VALUES ({matter}, N'T', N'<p>T</p>', N'T'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;

        var half = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"UPDATE dbo.Note SET LockedByUserId = {user} WHERE NoteId = {note}"));
        half.Message.ShouldContain("CK_Note_Lock");
        await ScalarAsync(cs, $"UPDATE dbo.Note SET LockedByUserId = {user}, LockedAt = SYSUTCDATETIME() WHERE NoteId = {note}");

        await ScalarAsync(cs, $"INSERT dbo.NoteTagLink (NoteId, NoteTagId) VALUES ({note}, {tag})");
        await ScalarAsync(cs, $"INSERT dbo.NoteLink (NoteId, TargetType, TargetId) VALUES ({note}, 'ASSET', 5)");
        var badTarget = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.NoteLink (NoteId, TargetType, TargetId) VALUES ({note}, 'TASK', 5)"));
        badTarget.Message.ShouldContain("CK_NoteLink_Type");

        var inUse = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"DELETE dbo.NoteTag WHERE NoteTagId = {tag}"));
        inUse.Message.ShouldContain("FK_NoteTagLink_Tag");
        var sameName = await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.NoteTag (Name) VALUES (N'Privilege')"));
        sameName.Message.ShouldContain("UQ_NoteTag_Name");

        await ScalarAsync(cs, $"DELETE dbo.Note WHERE NoteId = {note}");
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.NoteTagLink")).ShouldBe(0);
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.NoteLink")).ShouldBe(0);
    }

    [Fact]
    public async Task A_template_is_at_the_system_client_or_matter_level_and_names_are_unique_in_their_level()
    {
        var (cs, matter, other, _) = await SeedAsync(sql);
        var client = await ScalarAsync(cs, $"SELECT ClientId FROM dbo.Matter WHERE MatterId = {matter}");
        await ScalarAsync(cs, "INSERT dbo.NoteTemplate (ScopeCode, Name) VALUES ('SYSTEM', N'Custodian interview')");
        await ScalarAsync(cs, $"INSERT dbo.NoteTemplate (ScopeCode, ClientId, Name) VALUES ('CLIENT', {client}, N'Custodian interview')");
        await ScalarAsync(cs, $"INSERT dbo.NoteTemplate (ScopeCode, MatterId, Name) VALUES ('MATTER', {matter}, N'Custodian interview')");
        await ScalarAsync(cs, $"INSERT dbo.NoteTemplate (ScopeCode, MatterId, Name) VALUES ('MATTER', {other}, N'Custodian interview')");

        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.NoteTemplate (ScopeCode, Name) VALUES ('SYSTEM', N'Custodian interview')")))
            .Message.ShouldContain("UQ_NoteTemplate_SystemName");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.NoteTemplate (ScopeCode, ClientId, Name) VALUES ('CLIENT', {client}, N'Custodian interview')")))
            .Message.ShouldContain("UQ_NoteTemplate_ClientName");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.NoteTemplate (ScopeCode, MatterId, Name) VALUES ('MATTER', {matter}, N'Custodian interview')")))
            .Message.ShouldContain("UQ_NoteTemplate_MatterName");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, $"INSERT dbo.NoteTemplate (ScopeCode, MatterId, Name) VALUES ('SYSTEM', {matter}, N'Bad')")))
            .Message.ShouldContain("CK_NoteTemplate_Level");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.NoteTemplate (ScopeCode, Name) VALUES ('MATTER', N'Bad')")))
            .Message.ShouldContain("CK_NoteTemplate_Level");
        (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, "INSERT dbo.NoteTemplate (ScopeCode, Name) VALUES ('CLIENT', N'Bad')")))
            .Message.ShouldContain("CK_NoteTemplate_Level");
    }
}
