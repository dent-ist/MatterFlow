using MatterFlow.WorkflowEngine.Contracts;
using MatterFlow.WorkflowEngine.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace MatterFlow.WorkflowEngine.Infrastructure;

/// <summary>Names of the unique indexes in <c>09-workflow-config.sql</c>, used to map duplicate-key errors to friendly conflicts.</summary>
internal static class WorkflowConstraints
{
    public const string StepTitle = "UQ_StepDefinition_Title";
    public const string WorkflowName = "UQ_WorkflowDefinition_Name";
    public const string VersionPublished = "UQ_WorkflowVersion_Published";
    public const string VersionDraft = "UQ_WorkflowVersion_Draft";
    public const string VersionNo = "UQ_WorkflowVersion_No";
}

internal sealed class StepDefinitionConfiguration : IEntityTypeConfiguration<StepDefinition>
{
    public void Configure(EntityTypeBuilder<StepDefinition> b)
    {
        b.ToTable("StepDefinition");
        b.Property(x => x.Title).HasMaxLength(200).IsRequired();
        b.Property(x => x.Description).HasMaxLength(1000);
        b.Property(x => x.Instructions).HasColumnType("nvarchar(max)");
        b.Property(x => x.DocumentationUrl).HasMaxLength(1000);
        b.HasIndex(x => x.Title).IsUnique().HasFilter("[IsActive] = 1").HasDatabaseName(WorkflowConstraints.StepTitle);
    }
}

internal sealed class WorkflowDefinitionConfiguration : IEntityTypeConfiguration<WorkflowDefinition>
{
    public void Configure(EntityTypeBuilder<WorkflowDefinition> b)
    {
        b.ToTable("WorkflowDefinition");
        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.Description).HasMaxLength(1000);
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName(WorkflowConstraints.WorkflowName);
    }
}

internal sealed class WorkflowVersionConfiguration : IEntityTypeConfiguration<WorkflowVersion>
{
    private static readonly ValueConverter<WorkflowVersionStatus, string> StatusConverter = new(
        v => v == WorkflowVersionStatus.Draft ? "DRAFT" : v == WorkflowVersionStatus.Published ? "PUBLISHED" : "RETIRED",
        s => s == "DRAFT" ? WorkflowVersionStatus.Draft : s == "PUBLISHED" ? WorkflowVersionStatus.Published : WorkflowVersionStatus.Retired);

    public void Configure(EntityTypeBuilder<WorkflowVersion> b)
    {
        // The table has an immutability trigger, so EF must not use the OUTPUT clause.
        b.ToTable("WorkflowVersion", t => t.HasTrigger("TR_WorkflowVersion_Immutable"));
        b.Property(x => x.Status).HasMaxLength(12).IsUnicode(false).HasConversion(StatusConverter);
        b.HasIndex(x => new { x.WorkflowDefinitionId, x.VersionNo }).IsUnique().HasDatabaseName(WorkflowConstraints.VersionNo);
        b.HasIndex(x => x.WorkflowDefinitionId).IsUnique().HasFilter("[Status] = 'PUBLISHED'").HasDatabaseName(WorkflowConstraints.VersionPublished);
        b.HasIndex(x => x.WorkflowDefinitionId).IsUnique().HasFilter("[Status] = 'DRAFT'").HasDatabaseName(WorkflowConstraints.VersionDraft);
        b.HasMany(x => x.Steps).WithOne().HasForeignKey(x => x.WorkflowVersionId).HasConstraintName("FK_WVS_Version");
    }
}

internal sealed class WorkflowVersionStepConfiguration : IEntityTypeConfiguration<WorkflowVersionStep>
{
    public void Configure(EntityTypeBuilder<WorkflowVersionStep> b)
    {
        b.ToTable("WorkflowVersionStep", t => t.HasTrigger("TR_WorkflowVersionStep_Immutable"));
        b.Property(x => x.Title).HasMaxLength(200).IsRequired();
        b.Property(x => x.Description).HasMaxLength(1000);
        b.Property(x => x.Instructions).HasColumnType("nvarchar(max)");
        b.Property(x => x.DocumentationUrl).HasMaxLength(1000);
        b.HasIndex(x => new { x.WorkflowVersionId, x.SequenceNo }).IsUnique().HasDatabaseName("UQ_WVS_Sequence");
        b.HasIndex(x => new { x.WorkflowVersionId, x.SourceStepDefinitionId }).IsUnique().HasDatabaseName("UQ_WVS_Source");
    }
}
