using MatterFlow.Data.SchemaMigrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace MatterFlow.SchemaTests;

/// <summary>Constraints, indexes and triggers of 06-forms.sql (docs/erd.md section 6).</summary>
[Collection(SqlServerCollection.Name)]
public class FormsSchemaTests(SqlServerFixture sql)
{
    private async Task<string> MigratedAsync()
    {
        var cs = await sql.CreateDatabaseAsync();
        await new SchemaMigrationRunner(cs, new EmbeddedMigrationScriptSource(), new MigrationsOptions { LockTimeoutSeconds = 60 }, NullLogger<SchemaMigrationRunner>.Instance).RunAsync();
        return cs;
    }

    private static async Task<int> ExecAsync(string cs, string sqlText)
    {
        await using var c = new SqlConnection(cs);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sqlText;
        return Convert.ToInt32(await cmd.ExecuteScalarAsync() ?? 0);
    }

    private static async Task ShouldRejectAsync(string cs, string sqlText, string expected)
    {
        var ex = await Should.ThrowAsync<SqlException>(() => ExecAsync(cs, sqlText));
        ex.Message.ShouldContain(expected, Case.Insensitive, sqlText);
    }

    [Fact]
    public async Task Forms_objects_exist()
    {
        var cs = await MigratedAsync();

        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.tables WHERE name IN ('FormDefinition','FormVersion','FormField','FormFieldOption','FormValueSet','CustomFieldIndex')")).ShouldBe(6);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.triggers WHERE name IN ('TR_FormVersion_Immutable','TR_FormField_Immutable','TR_FormFieldOption_Immutable') AND is_disabled = 0")).ShouldBe(3);
        (await ExecAsync(cs, "SELECT COUNT(*) FROM sys.indexes WHERE is_unique = 1 AND has_filter = 1 AND name IN ('UQ_FormVersion_Published','UQ_FormVersion_Draft','UQ_FormDef_TaskType','UQ_FormDef_Step','UQ_FormDef_AssetType','UQ_FormDef_Singleton')")).ShouldBe(6);
    }

    [Fact]
    public async Task Definition_owner_shape_and_uniqueness_are_enforced()
    {
        var cs = await MigratedAsync();

        await ShouldRejectAsync(cs, "INSERT dbo.FormDefinition (Scope) VALUES ('TASK_TYPE')", "CK_FormDefinition_Owner");
        await ShouldRejectAsync(cs, "INSERT dbo.FormDefinition (Scope, TaskTypeId, AssetTypeId) VALUES ('TASK_TYPE', 1, 2)", "CK_FormDefinition_Owner");
        await ShouldRejectAsync(cs, "INSERT dbo.FormDefinition (Scope, TaskTypeId) VALUES ('CLIENT', 1)", "CK_FormDefinition_Owner");
        await ShouldRejectAsync(cs, "INSERT dbo.FormDefinition (Scope) VALUES ('GLOBAL_TASK')", "CK_FormDefinition_Scope");

        await ExecAsync(cs, "INSERT dbo.FormDefinition (Scope, TaskTypeId) VALUES ('TASK_TYPE', 1); INSERT dbo.FormDefinition (Scope) VALUES ('CLIENT')");
        await ShouldRejectAsync(cs, "INSERT dbo.FormDefinition (Scope, TaskTypeId) VALUES ('TASK_TYPE', 1)", "UQ_FormDef_TaskType");
        await ShouldRejectAsync(cs, "INSERT dbo.FormDefinition (Scope) VALUES ('CLIENT')", "UQ_FormDef_Singleton");
    }

    [Fact]
    public async Task One_draft_and_one_published_version_per_definition_and_field_checks()
    {
        var cs = await MigratedAsync();
        await ExecAsync(cs, "INSERT dbo.FormDefinition (Scope) VALUES ('MATTER')");
        await ExecAsync(cs, "INSERT dbo.FormVersion (FormDefinitionId, VersionNo, Status) VALUES (1, 1, 'DRAFT')");

        await ShouldRejectAsync(cs, "INSERT dbo.FormVersion (FormDefinitionId, VersionNo, Status) VALUES (1, 2, 'DRAFT')", "UQ_FormVersion_Draft");
        await ShouldRejectAsync(cs, "INSERT dbo.FormVersion (FormDefinitionId, VersionNo, Status) VALUES (1, 1, 'RETIRED')", "UQ_FormVersion_No");
        await ShouldRejectAsync(cs, "INSERT dbo.FormVersion (FormDefinitionId, VersionNo, Status) VALUES (1, 3, 'PUBLISHED')", "CK_FormVersion_PublishedAt");
        await ShouldRejectAsync(cs, "INSERT dbo.FormVersion (FormDefinitionId, VersionNo, Status) VALUES (1, 3, 'ARCHIVED')", "CK_FormVersion_Status");

        await ShouldRejectAsync(cs, "INSERT dbo.FormField (FormVersionId, FieldKey, Label, ControlType, SortOrder) VALUES (1, 'Upper', N'x', 'TEXT', 1)", "CK_FormField_Key");
        await ShouldRejectAsync(cs, "INSERT dbo.FormField (FormVersionId, FieldKey, Label, ControlType, SortOrder) VALUES (1, '1abc', N'x', 'TEXT', 1)", "CK_FormField_Key");
        await ShouldRejectAsync(cs, "INSERT dbo.FormField (FormVersionId, FieldKey, Label, ControlType, SortOrder) VALUES (1, 'has-dash', N'x', 'TEXT', 1)", "CK_FormField_Key");
        await ShouldRejectAsync(cs, "INSERT dbo.FormField (FormVersionId, FieldKey, Label, ControlType, SortOrder) VALUES (1, 'file', N'x', 'FILE_UPLOAD', 1)", "CK_FormField_Control");
        await ShouldRejectAsync(cs, "INSERT dbo.FormField (FormVersionId, FieldKey, Label, ControlType, SortOrder, ShowWhenJson) VALUES (1, 'a', N'x', 'TEXT', 1, N'not json')", "CK_FormField_ShowWhenJson");

        await ExecAsync(cs, "INSERT dbo.FormField (FormVersionId, FieldKey, Label, ControlType, SortOrder, DefaultValueJson) VALUES (1, 'a', N'x', 'TEXT', 1, N'\"bare string\"')");
        await ShouldRejectAsync(cs, "INSERT dbo.FormField (FormVersionId, FieldKey, Label, ControlType, SortOrder) VALUES (1, 'a', N'x', 'TEXT', 2)", "UQ_FormField_Key");
        await ShouldRejectAsync(cs, "INSERT dbo.FormField (FormVersionId, FieldKey, Label, ControlType, SortOrder) VALUES (1, 'b', N'x', 'TEXT', 1)", "UQ_FormField_Order");
    }

    [Fact]
    public async Task Filter_index_rows_hold_exactly_one_typed_value()
    {
        var cs = await MigratedAsync();
        await ExecAsync(cs, "INSERT dbo.FormDefinition (Scope) VALUES ('CLIENT')");

        await ShouldRejectAsync(cs, "INSERT dbo.CustomFieldIndex (OwnerKind, OwnerId, FormDefinitionId, FieldKey) VALUES ('CLIENT', 1, 1, 'a')", "CK_CFI_OneValue");
        await ShouldRejectAsync(cs, "INSERT dbo.CustomFieldIndex (OwnerKind, OwnerId, FormDefinitionId, FieldKey, ValueText, ValueBool) VALUES ('CLIENT', 1, 1, 'a', N'x', 1)", "CK_CFI_OneValue");
        await ShouldRejectAsync(cs, "INSERT dbo.CustomFieldIndex (OwnerKind, OwnerId, FormDefinitionId, FieldKey, ValueBool) VALUES ('USER', 1, 1, 'a', 1)", "CK_CFI_OwnerKind");
        await ExecAsync(cs, "INSERT dbo.CustomFieldIndex (OwnerKind, OwnerId, FormDefinitionId, FieldKey, ValueBool) VALUES ('CLIENT', 1, 1, 'a', 0)");
    }
}
