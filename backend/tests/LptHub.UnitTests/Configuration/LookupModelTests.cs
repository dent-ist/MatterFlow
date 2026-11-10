using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain;
using MatterFlow.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Shouldly;

namespace MatterFlow.UnitTests.Configuration;

public class LookupModelTests
{
    private static IModel BuildModel()
    {
        var options = new DbContextOptionsBuilder<MatterFlowDbContext>().UseSqlServer("Server=localhost;Database=unused;").Options;
        using var db = new MatterFlowDbContext(options);
        return db.GetService<IDesignTimeModel>().Model;
    }

    [Theory]
    [InlineData("critical", true)]
    [InlineData("neutral", true)]
    [InlineData("#B42318", true)]
    [InlineData("#b42318", true)]
    [InlineData("B42318", false)]
    [InlineData("#B4231", false)]
    [InlineData("#GGGGGG", false)]
    [InlineData("Critical", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Priority_color_is_a_known_token_or_a_hex_value(string? color, bool valid) =>
        PriorityColors.IsValid(color).ShouldBe(valid);

    [Fact]
    public void The_five_status_codes_are_fixed_and_in_lifecycle_order() =>
        TaskStatusCodes.All.ShouldBe(["NEW", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]);

    [Fact]
    public void Priority_maps_to_the_script_columns_with_a_filtered_unique_default_index()
    {
        var entity = BuildModel().FindEntityType(typeof(Priority))!;

        entity.GetTableName().ShouldBe("Priority");
        entity.FindProperty(nameof(Priority.Id))!.GetColumnName().ShouldBe("PriorityId");
        entity.FindProperty(nameof(Priority.RowVersion))!.IsConcurrencyToken.ShouldBeTrue();
        var defaultIndex = entity.GetIndexes().Single(i => i.GetDatabaseName() == "UQ_Priority_Default");
        defaultIndex.IsUnique.ShouldBeTrue();
        defaultIndex.GetFilter().ShouldBe("[IsDefault] = 1");
        entity.GetIndexes().Single(i => i.GetDatabaseName() == "UQ_Priority_Label").IsUnique.ShouldBeTrue();
    }

    [Fact]
    public void Status_label_is_keyed_by_its_immutable_code_and_declares_the_guard_trigger()
    {
        var entity = BuildModel().FindEntityType(typeof(TaskStatusLabel))!;

        entity.FindPrimaryKey()!.Properties.Select(p => p.Name).ShouldBe([nameof(TaskStatusLabel.StatusCode)]);
        entity.FindProperty(nameof(TaskStatusLabel.StatusCode))!.ValueGenerated.ShouldBe(ValueGenerated.Never);
        entity.GetDeclaredTriggers().Select(t => t.GetDatabaseName()).ShouldBe(["TR_TaskStatusLabel_FixedCodes"]);
        entity.FindProperty(nameof(TaskStatusLabel.CreatedAtUtc))!.GetColumnName().ShouldBe("CreatedAt");
    }

    [Fact]
    public void Asset_link_role_maps_to_its_table()
    {
        var entity = BuildModel().FindEntityType(typeof(AssetLinkRole))!;

        entity.GetTableName().ShouldBe("AssetLinkRole");
        entity.FindProperty(nameof(AssetLinkRole.Id))!.GetColumnName().ShouldBe("AssetLinkRoleId");
        entity.GetIndexes().Single(i => i.GetDatabaseName() == "UQ_AssetLinkRole_Name").IsUnique.ShouldBeTrue();
    }
}
