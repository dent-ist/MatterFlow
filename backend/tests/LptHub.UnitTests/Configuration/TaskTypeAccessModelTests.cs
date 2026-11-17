using LptHub.Configuration.Domain;
using LptHub.Data;
using LptHub.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.Configuration;
using Shouldly;

namespace LptHub.UnitTests.Configuration;

/// <summary>Task Type access by role (epic #1397, #1399): the EF model matches script 81 and the go-live switch is off unless configured.</summary>
public class TaskTypeAccessModelTests
{
    private static IModel BuildModel()
    {
        var options = new DbContextOptionsBuilder<LptHubDbContext>().UseSqlServer("Server=localhost;Database=unused;").Options;
        using var db = new LptHubDbContext(options);
        return db.GetService<IDesignTimeModel>().Model;
    }

    [Fact]
    public void The_access_table_is_keyed_by_type_and_role_and_points_at_the_task_type()
    {
        var entity = BuildModel().FindEntityType(typeof(TaskTypeRoleAccess)).ShouldNotBeNull();

        entity.GetTableName().ShouldBe("TaskTypeRoleAccess");
        entity.FindPrimaryKey()!.Properties.Select(p => p.Name).ShouldBe([nameof(TaskTypeRoleAccess.TaskTypeId), nameof(TaskTypeRoleAccess.RoleId)]);
        entity.GetForeignKeys().Single().GetConstraintName().ShouldBe("FK_TaskTypeRoleAccess_TaskType");
        entity.GetForeignKeys().Single().PrincipalEntityType.ClrType.ShouldBe(typeof(TaskType));
    }

    [Fact]
    public void The_restriction_flag_is_a_plain_column_written_by_explicit_events_only()
    {
        var property = BuildModel().FindEntityType(typeof(TaskType))!.FindProperty(nameof(TaskType.IsRestricted)).ShouldNotBeNull();

        property.GetColumnName().ShouldBe("IsRestricted");
        property.ClrType.ShouldBe(typeof(bool));
        property.IsNullable.ShouldBeFalse();
        typeof(TaskType).GetProperty(nameof(TaskType.IsRestricted))!.GetCustomAttributes(typeof(LptHub.SharedKernel.Audit.AuditExplicitAttribute), false).ShouldNotBeEmpty();
    }

    [Fact]
    public void The_go_live_switch_is_off_by_default()
    {
        new TaskTypeAccessOptions().TaskTypeAccess.ShouldBeFalse();

        var empty = new ConfigurationBuilder().AddInMemoryCollection().Build();
        empty.GetSection(TaskTypeAccessOptions.Section).Get<TaskTypeAccessOptions>().ShouldBeNull();
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    public void The_switch_binds_from_Features_TaskTypeAccess(string value, bool expected)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Features:TaskTypeAccess"] = value }).Build();

        configuration.GetSection(TaskTypeAccessOptions.Section).Get<TaskTypeAccessOptions>()!.TaskTypeAccess.ShouldBe(expected);
    }

    [Fact]
    public void The_shipped_appsettings_keep_the_switch_off()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
            dir = dir.Parent;

        dir.ShouldNotBeNull();
        var configuration = new ConfigurationBuilder().AddJsonFile(Path.Combine(dir.FullName, "backend", "src", "LptHub.Api", "appsettings.json")).Build();

        configuration.GetSection(TaskTypeAccessOptions.Section).Get<TaskTypeAccessOptions>().ShouldNotBeNull().TaskTypeAccess.ShouldBeFalse();
        configuration.GetSection("Features:TaskTypeAccess").Value.ShouldBe("False", StringCompareShould.IgnoreCase);
    }
}
