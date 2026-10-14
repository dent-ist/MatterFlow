using MatterFlow.Configuration.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MatterFlow.Configuration.Infrastructure;

internal sealed class TaskTypeConfiguration : IEntityTypeConfiguration<TaskType>
{
    public void Configure(EntityTypeBuilder<TaskType> b)
    {
        b.ToTable("TaskType");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.Property(x => x.Description).HasMaxLength(1000);
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName(TaskTypeConstraints.Name);
        b.HasMany(x => x.EligibleWorkflows).WithOne().HasForeignKey(x => x.TaskTypeId).HasConstraintName("FK_TaskTypeWorkflowEligibility_TaskType");
    }
}

internal sealed class TaskTypeWorkflowEligibilityConfiguration : IEntityTypeConfiguration<TaskTypeWorkflowEligibility>
{
    public void Configure(EntityTypeBuilder<TaskTypeWorkflowEligibility> b)
    {
        b.ToTable("TaskTypeWorkflowEligibility");
        b.HasKey(x => new { x.TaskTypeId, x.WorkflowDefinitionId });
        b.Property(x => x.TaskTypeId).ValueGeneratedNever();
        b.Property(x => x.WorkflowDefinitionId).ValueGeneratedNever();
    }
}

internal static class TaskTypeConstraints
{
    public const string Name = "UQ_TaskType_Name";
}
