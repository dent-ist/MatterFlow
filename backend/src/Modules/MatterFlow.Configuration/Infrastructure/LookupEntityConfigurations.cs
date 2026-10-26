using MatterFlow.Configuration.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MatterFlow.Configuration.Infrastructure;

internal sealed class PriorityConfiguration : IEntityTypeConfiguration<Priority>
{
    public void Configure(EntityTypeBuilder<Priority> b)
    {
        b.ToTable("Priority");
        b.Property(x => x.Label).HasMaxLength(50).IsRequired();
        b.Property(x => x.Color).HasMaxLength(20).IsUnicode(false).IsRequired();
        b.HasIndex(x => x.Label).IsUnique().HasDatabaseName(LookupConstraints.PriorityLabel);
        b.HasIndex(x => x.IsDefault).IsUnique().HasFilter("[IsDefault] = 1").HasDatabaseName(LookupConstraints.PriorityDefault);
    }
}

internal sealed class TaskStatusLabelConfiguration : IEntityTypeConfiguration<TaskStatusLabel>
{
    public void Configure(EntityTypeBuilder<TaskStatusLabel> b)
    {
        // The table has a trigger freezing the code set, so EF must not use the OUTPUT clause.
        b.ToTable("TaskStatusLabel", t => t.HasTrigger("TR_TaskStatusLabel_FixedCodes"));
        b.HasKey(x => x.StatusCode);
        b.Property(x => x.StatusCode).HasMaxLength(20).IsUnicode(false).ValueGeneratedNever();
        b.Property(x => x.DisplayLabel).HasMaxLength(50).IsRequired();
        b.Property(x => x.CreatedAtUtc).HasColumnName("CreatedAt").IsRequired();
        b.Property(x => x.CreatedByUserId).HasColumnName("CreatedByUserId");
        b.Property(x => x.ModifiedAtUtc).HasColumnName("ModifiedAt");
        b.Property(x => x.ModifiedByUserId).HasColumnName("ModifiedByUserId");
        b.Property(x => x.RowVersion).HasColumnName("RowVersion").IsRowVersion().IsRequired();
        b.HasIndex(x => x.DisplayLabel).IsUnique().HasDatabaseName(LookupConstraints.StatusLabel);
    }
}

internal sealed class AssetLinkRoleConfiguration : IEntityTypeConfiguration<AssetLinkRole>
{
    public void Configure(EntityTypeBuilder<AssetLinkRole> b)
    {
        b.ToTable("AssetLinkRole");
        b.Property(x => x.Name).HasMaxLength(50).IsRequired();
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName(LookupConstraints.AssetLinkRoleName);
    }
}

internal sealed class OnHoldReasonConfiguration : IEntityTypeConfiguration<OnHoldReason>
{
    public void Configure(EntityTypeBuilder<OnHoldReason> b)
    {
        b.ToTable("OnHoldReason");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName(LookupConstraints.OnHoldReasonName);
    }
}

/// <summary>Names of the unique indexes in <c>07-configuration-basics.sql</c>, used to map duplicate-key errors to friendly conflicts.</summary>
internal static class LookupConstraints
{
    public const string PriorityLabel = "UQ_Priority_Label";
    public const string PriorityDefault = "UQ_Priority_Default";
    public const string StatusLabel = "UQ_TaskStatusLabel_Label";
    public const string AssetLinkRoleName = "UQ_AssetLinkRole_Name";
    public const string OnHoldReasonName = "UQ_OnHoldReason_Name";
}
