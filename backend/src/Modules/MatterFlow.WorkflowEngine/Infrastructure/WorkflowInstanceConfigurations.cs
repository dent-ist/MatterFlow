using MatterFlow.WorkflowEngine.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace MatterFlow.WorkflowEngine.Infrastructure;

internal sealed class WorkflowInstanceRecordConfiguration : IEntityTypeConfiguration<WorkflowInstanceRecord>
{
    public void Configure(EntityTypeBuilder<WorkflowInstanceRecord> b)
    {
        // The table has an immutability trigger, so EF must not use the OUTPUT clause.
        b.ToTable("WorkflowInstance", t => t.HasTrigger("TR_WorkflowInstance_Immutable"));
        b.Property(x => x.Id).HasColumnName("WorkflowInstanceId");
        b.HasIndex(x => x.WorkflowVersionId).HasDatabaseName("IX_WorkflowInstance_Version");
        b.HasMany(x => x.Steps).WithOne().HasForeignKey(x => x.WorkflowInstanceId).HasConstraintName("FK_StepInstance_Workflow");
    }
}

internal sealed class StepInstanceRecordConfiguration : IEntityTypeConfiguration<StepInstanceRecord>
{
    private static readonly ValueConverter<StepStatus, string> StatusConverter = new(
        v => v == StepStatus.Pending ? "PENDING" : v == StepStatus.InProgress ? "IN_PROGRESS" : v == StepStatus.Completed ? "COMPLETED" : "SKIPPED",
        s => s == "PENDING" ? StepStatus.Pending : s == "IN_PROGRESS" ? StepStatus.InProgress : s == "COMPLETED" ? StepStatus.Completed : StepStatus.Skipped);

    public void Configure(EntityTypeBuilder<StepInstanceRecord> b)
    {
        b.ToTable("StepInstance", t => t.HasTrigger("TR_StepInstance_Immutable"));
        b.Property(x => x.Id).HasColumnName("StepInstanceId");
        b.Property(x => x.Title).HasMaxLength(200).IsRequired();
        b.Property(x => x.Description).HasMaxLength(1000);
        b.Property(x => x.Instructions).HasColumnType("nvarchar(max)");
        b.Property(x => x.DocumentationUrl).HasMaxLength(1000);
        b.Property(x => x.SkipComment).HasMaxLength(2000);
        b.Property(x => x.Status).HasMaxLength(12).IsUnicode(false).HasConversion(StatusConverter);
        b.HasIndex(x => new { x.WorkflowInstanceId, x.SequenceNo }).IsUnique().HasDatabaseName("UQ_StepInstance_Sequence");
        b.HasIndex(x => new { x.WorkflowInstanceId, x.WorkflowVersionStepId }).IsUnique().HasDatabaseName("UQ_StepInstance_VersionStep");
    }
}
