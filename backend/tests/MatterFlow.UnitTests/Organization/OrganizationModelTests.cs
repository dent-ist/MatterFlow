using System.Reflection;
using MatterFlow.Data;
using MatterFlow.Organization.Application;
using MatterFlow.Organization.Contracts;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.ValueObjects;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Shouldly;

namespace MatterFlow.UnitTests.Organization;

public class OrganizationModelTests
{
    private static MatterFlowDbContext NewContext() =>
        new(new DbContextOptionsBuilder<MatterFlowDbContext>().UseSqlServer("Server=localhost;Database=unused;").Options);

    [Fact]
    public void Entities_map_to_the_script_tables_and_columns()
    {
        using var db = NewContext();

        var client = db.Model.FindEntityType(typeof(Client))!;
        client.GetTableName().ShouldBe("Client");
        client.FindProperty(nameof(Client.Id))!.GetColumnName().ShouldBe("ClientId");
        client.FindProperty(nameof(Client.ClientNumber))!.GetColumnType().ShouldBe("char(5)");
        client.GetIndexes().ShouldContain(i => i.GetDatabaseName() == "UQ_Client_Number" && i.IsUnique);

        var matter = db.Model.FindEntityType(typeof(Matter))!;
        matter.GetTableName().ShouldBe("Matter");
        matter.FindProperty(nameof(Matter.Id))!.GetColumnName().ShouldBe("MatterId");
        matter.FindProperty(nameof(Matter.MatterNumber))!.GetColumnType().ShouldBe("char(5)");
        matter.GetIndexes().ShouldContain(i => i.GetDatabaseName() == "UQ_Matter_ClientMatterNumber" && i.IsUnique && i.Properties.Count == 2);

        var project = db.Model.FindEntityType(typeof(Project))!;
        project.GetTableName().ShouldBe("Project");
        project.FindProperty(nameof(Project.Id))!.GetColumnName().ShouldBe("ProjectId");
        project.GetIndexes().ShouldContain(i => i.GetDatabaseName() == "UQ_Project_MatterName" && i.IsUnique);
    }

    [Fact]
    public void Combined_matter_reference_is_a_computed_column_that_is_never_written_or_audited_as_a_field()
    {
        using var db = NewContext();
        var reference = db.Model.FindEntityType(typeof(Matter))!.FindProperty(nameof(Matter.MatterRef))!;

        reference.ValueGenerated.ShouldBe(ValueGenerated.OnAddOrUpdate);
        reference.GetComputedColumnSql().ShouldNotBeNull();
        reference.GetIsStored().ShouldBe(true);
    }

    [Fact]
    public void Custom_field_values_are_a_nullable_json_extension_point_on_every_entity()
    {
        using var db = NewContext();

        foreach (var type in new[] { typeof(Client), typeof(Matter), typeof(Project) })
        {
            var property = db.Model.FindEntityType(type)!.FindProperty("CustomFieldsJson")!;
            property.IsNullable.ShouldBeTrue(type.Name);
            property.ClrType.ShouldBe(typeof(string));
            type.GetProperty("CustomFieldsJson")!.GetCustomAttribute<AuditJsonFieldsAttribute>().ShouldNotBeNull(type.Name);
        }
    }

    [Fact]
    public void Numbers_are_audited_through_explicit_events_not_generic_field_events()
    {
        typeof(Client).GetCustomAttribute<AuditedAttribute>().ShouldNotBeNull();
        typeof(Matter).GetCustomAttribute<AuditedAttribute>().ShouldNotBeNull();
        typeof(Project).GetCustomAttribute<AuditedAttribute>().ShouldNotBeNull();
        typeof(Client).GetProperty(nameof(Client.ClientNumber))!.GetCustomAttribute<AuditExplicitAttribute>().ShouldNotBeNull();
        typeof(Matter).GetProperty(nameof(Matter.MatterNumber))!.GetCustomAttribute<AuditExplicitAttribute>().ShouldNotBeNull();
    }

    [Theory]
    [InlineData("343-12", "00343", "00012")]
    [InlineData("00343-00012", "00343", "00012")]
    [InlineData(" 343 - 00012 ", "00343", "00012")]
    [InlineData("1-1", "00001", "00001")]
    public void Matter_reference_pairs_parse_padded_and_unpadded(string text, string client, string matter)
    {
        MatterService.TryParsePair(text, out var c, out var m).ShouldBeTrue();

        c.Value.ShouldBe(client);
        m.Value.ShouldBe(matter);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("343")]
    [InlineData("343-")]
    [InlineData("-12")]
    [InlineData("343-12-1")]
    [InlineData("0-12")]
    [InlineData("343-123456")]
    [InlineData("abc-def")]
    public void Matter_reference_pairs_reject_everything_else(string? text)
    {
        MatterService.TryParsePair(text, out _, out _).ShouldBeFalse();
    }

    [Fact]
    public void Number_errors_are_reported_against_the_given_field()
    {
        var result = OrganizationSupport.ParseNumber("123456", "clientNumber");

        result.IsFailure.ShouldBeTrue();
        result.Error!.Code.ShouldBe(ErrorCodes.InvalidNumberFormat);
        result.Error.FieldErrors!["clientNumber"].Single().Code.ShouldBe(ErrorCodes.InvalidNumberFormat);
        OrganizationSupport.ParseNumber("343", "clientNumber").Value.ShouldBe(BusinessNumber.Parse("00343").Value);
    }

    [Fact]
    public void Row_version_check_accepts_the_current_token_and_reports_it_on_a_mismatch()
    {
        byte[] current = [1, 2, 3, 4, 5, 6, 7, 8];

        OrganizationSupport.CheckRowVersion(current, Convert.ToBase64String(current)).IsSuccess.ShouldBeTrue();

        var stale = OrganizationSupport.CheckRowVersion(current, Convert.ToBase64String([9, 9]));
        stale.Error!.Type.ShouldBe(ErrorType.Conflict);
        stale.Error.Code.ShouldBe(ErrorCodes.ConcurrencyConflict);
        stale.Error.Meta!["currentRowVersion"].ShouldBe(Convert.ToBase64String(current));

        OrganizationSupport.CheckRowVersion(current, "***").Error!.Type.ShouldBe(ErrorType.Validation);
    }

    [Fact]
    public async Task Default_task_guard_reports_no_open_tasks()
    {
        IMatterTaskGuard guard = new NoTasksMatterTaskGuard();

        (await guard.CountOpenTasksAsync(42)).ShouldBe(0);
    }
}
