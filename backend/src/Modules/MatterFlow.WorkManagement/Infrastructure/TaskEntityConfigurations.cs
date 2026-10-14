using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace MatterFlow.WorkManagement.Infrastructure;

internal sealed class WorkTaskConfiguration : IEntityTypeConfiguration<WorkTask>
{
    private static readonly ValueConverter<TaskStatusCode, string> StatusConverter = new(
        v => v.ToCode(),
        s => ParseStatus(s));

    private static TaskStatusCode ParseStatus(string code) =>
        TaskStatusCodeExtensions.TryParse(code, out var status) ? status : throw new InvalidOperationException($"Unknown task status code '{code}'.");

    public void Configure(EntityTypeBuilder<WorkTask> b)
    {
        // The table has triggers (immutability, no delete), so EF must not use the OUTPUT clause.
        b.ToTable("Task", t =>
        {
            t.HasTrigger("TR_Task_Immutable");
            t.HasTrigger("TR_Task_NoDelete");
        });
        b.Property(x => x.Id).HasColumnName("TaskId");
        b.Property(x => x.Number).HasColumnName("TaskNumber").HasMaxLength(20).IsUnicode(false).IsRequired();
        b.Property(x => x.Title).HasMaxLength(300).IsRequired();
        b.Property(x => x.Description).HasColumnType("nvarchar(max)");
        b.Property(x => x.Status).HasColumnName("StatusCode").HasMaxLength(20).IsUnicode(false).HasConversion(StatusConverter);
        b.Property(x => x.RequestorName).HasMaxLength(200).IsRequired();
        b.Property(x => x.RequestorEmail).HasMaxLength(320);
        b.Property(x => x.RequestedAtUtc).HasColumnName("RequestedAt").HasColumnType("datetime2(3)");
        b.Property(x => x.DueDate).HasColumnType("date");
        b.Property(x => x.DueAtUtc).HasColumnType("datetime2(3)");
        b.Property(x => x.DueSortKey).HasColumnType("datetime2(3)");
        b.Property(x => x.StatusChangedAtUtc).HasColumnName("StatusChangedAt").HasColumnType("datetime2(3)");
        b.Property(x => x.CompletedAtUtc).HasColumnName("CompletedAt").HasColumnType("datetime2(3)");
        b.HasIndex(x => x.Number).IsUnique().HasDatabaseName("UQ_Task_Number");
        b.HasIndex(x => x.WorkflowInstanceId).IsUnique().HasDatabaseName("UQ_Task_WorkflowInstance");
        b.HasIndex(x => new { x.MatterId, x.Status }).HasDatabaseName("IX_Task_Matter");
    }
}

internal sealed class TaskCommentConfiguration : IEntityTypeConfiguration<TaskComment>
{
    private static readonly ValueConverter<TaskCommentPurpose, string> PurposeConverter = new(
        v => v.ToCode(),
        s => s == "CANCEL" ? TaskCommentPurpose.Cancel : s == "ON_HOLD" ? TaskCommentPurpose.OnHold : TaskCommentPurpose.Normal);

    public void Configure(EntityTypeBuilder<TaskComment> b)
    {
        b.ToTable("TaskComment", t =>
        {
            t.HasTrigger("TR_TaskComment_Guard");
            t.HasTrigger("TR_TaskComment_NoDelete");
        });
        b.Property(x => x.Purpose).HasMaxLength(12).IsUnicode(false).HasConversion(PurposeConverter);
        b.Property(x => x.BodyHtml).HasColumnType("nvarchar(max)").IsRequired();
        b.Property(x => x.EditedAtUtc).HasColumnName("EditedAt").HasColumnType("datetime2(3)");
        b.Property(x => x.DeletedAtUtc).HasColumnName("DeletedAt").HasColumnType("datetime2(3)");
        b.HasIndex(x => new { x.TaskId, x.CreatedAtUtc }).HasDatabaseName("IX_TaskComment_Task");
    }
}
