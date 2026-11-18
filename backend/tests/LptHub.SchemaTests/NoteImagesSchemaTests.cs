using LptHub.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace LptHub.SchemaTests;

/// <summary>Script 84 (epic #1405, issue #1409): note images. Only PNG and JPEG up to 2 MB and 8,000 px, the size column matches the bytes, a link may point to an image, and the report login cannot read the table.</summary>
[Collection(SqlServerCollection.Name)]
public class NoteImagesSchemaTests(SqlServerFixture sql)
{
    private static async Task<object?> ScalarAsync(string cs, string text)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = text;
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task<string> FailureAsync(string cs, string text) => (await Should.ThrowAsync<SqlException>(() => ScalarAsync(cs, text), text)).Message;

    private async Task<(string Cs, int Matter)> SeedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        var client = (int)(await ScalarAsync(cs, "INSERT dbo.Client (ClientNumber, Name) VALUES ('00001', N'Client'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        var matter = (int)(await ScalarAsync(cs, $"INSERT dbo.Matter (ClientId, ClientNumber, MatterNumber, Name) VALUES ({client}, '00001', '00001', N'Matter'); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;
        return (cs, matter);
    }

    private static string Insert(int matter, string type = "image/png", int width = 10, int height = 10, int size = 3, string content = "0x010203") =>
        $"INSERT dbo.NoteImage (MatterId, ContentType, Width, Height, ByteSize, ContentSha256, Content) VALUES ({matter}, '{type}', {width}, {height}, {size}, 0x{new string('A', 64)}, {content}); SELECT CAST(SCOPE_IDENTITY() AS INT);";

    [Fact]
    public async Task A_png_and_a_jpeg_are_stored_and_the_upload_time_defaults()
    {
        var (cs, matter) = await SeedAsync();

        await ScalarAsync(cs, Insert(matter));
        await ScalarAsync(cs, Insert(matter, "image/jpeg", 8000, 8000));
        (await ScalarAsync(cs, "SELECT COUNT(*) FROM dbo.NoteImage WHERE UploadedAt IS NOT NULL")).ShouldBe(2);
    }

    [Theory]
    [InlineData("image/gif", 10, 10, 3, "0x010203", "CK_NoteImage_Type")]
    [InlineData("image/svg+xml", 10, 10, 3, "0x010203", "CK_NoteImage_Type")]
    [InlineData("image/png", 0, 10, 3, "0x010203", "CK_NoteImage_Dimensions")]
    [InlineData("image/png", 10, 8001, 3, "0x010203", "CK_NoteImage_Dimensions")]
    [InlineData("image/png", 10, 10, 0, "0x", "CK_NoteImage_Size")]
    [InlineData("image/png", 10, 10, 4, "0x010203", "CK_NoteImage_Size")] // the size column must match the bytes
    [InlineData("image/png", 10, 10, 2097153, "0x010203", "CK_NoteImage_Size")]
    public async Task The_database_refuses_what_the_service_would_refuse(string type, int width, int height, int size, string content, string constraint)
    {
        var (cs, matter) = await SeedAsync();

        (await FailureAsync(cs, Insert(matter, type, width, height, size, content))).ShouldContain(constraint);
    }

    [Fact]
    public async Task An_image_belongs_to_an_existing_matter_and_a_note_link_may_point_to_an_image()
    {
        var (cs, matter) = await SeedAsync();
        var image = (int)(await ScalarAsync(cs, Insert(matter)))!;
        var note = (int)(await ScalarAsync(cs, $"INSERT dbo.Note (MatterId) VALUES ({matter}); SELECT CAST(SCOPE_IDENTITY() AS INT);"))!;

        (await FailureAsync(cs, Insert(matter + 999))).ShouldContain("FK_NoteImage_Matter");
        await ScalarAsync(cs, $"INSERT dbo.NoteLink (NoteId, TargetType, TargetId) VALUES ({note}, 'IMAGE', {image}); SELECT 1;");
        (await FailureAsync(cs, $"INSERT dbo.NoteLink (NoteId, TargetType, TargetId) VALUES ({note}, 'FILE', {image})")).ShouldContain("CK_NoteLink_Type");
        await ScalarAsync(cs, $"INSERT dbo.NoteLink (NoteId, TargetType, TargetId) VALUES ({note}, 'USER', 1); SELECT 1;"); // the old types still work
    }
}
