using MatterFlow.Assets.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MatterFlow.Assets.Infrastructure;

internal sealed class AssetTypeConfiguration : IEntityTypeConfiguration<AssetType>
{
    public void Configure(EntityTypeBuilder<AssetType> b)
    {
        b.ToTable("AssetType");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.Property(x => x.Description).HasMaxLength(500);
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName("UQ_AssetType_Name");
        b.HasIndex(x => new { x.SortOrder, x.Name }).HasDatabaseName("IX_AssetType_Sort");
        b.Property(x => x.SizeFieldKey).HasMaxLength(64).IsUnicode(false);
        b.Property(x => x.SizeUnit).HasMaxLength(10).IsUnicode(false);
    }
}

internal sealed class AssetConfiguration : IEntityTypeConfiguration<Asset>
{
    public void Configure(EntityTypeBuilder<Asset> b)
    {
        b.ToTable("Asset", t => t.HasTrigger("TR_Asset_Guard"));
        b.Property(x => x.DisplayName).HasMaxLength(300).IsRequired();
        b.Property(x => x.ExternalReference).HasMaxLength(1000);
        b.Property(x => x.Description).HasMaxLength(2000);
        b.HasIndex(x => new { x.Id, x.MatterId }).IsUnique().HasDatabaseName("UQ_Asset_IdMatter");
        b.HasIndex(x => new { x.MatterId, x.AssetTypeId }).HasDatabaseName("IX_Asset_Matter");
        b.HasIndex(x => x.DisplayName).HasDatabaseName("IX_Asset_Name");
        b.HasIndex(x => x.AssetTypeId).HasDatabaseName("IX_Asset_Type");
        b.Property(x => x.DispositionCode).HasMaxLength(20).IsUnicode(false).IsRequired().HasDefaultValue(AssetDisposition.Active);
        b.Property(x => x.DispositionChangedAtUtc).HasColumnName("DispositionChangedAt");
        b.Property(x => x.DispositionNote).HasMaxLength(500);
        b.HasIndex(x => new { x.MatterId, x.AssetTypeId, x.DispositionCode }).HasDatabaseName("IX_Asset_Matter_Disposition");
    }
}

internal sealed class AssetReportConfiguration : IEntityTypeConfiguration<AssetReport>
{
    public void Configure(EntityTypeBuilder<AssetReport> b)
    {
        b.ToTable("AssetReport");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.Property(x => x.DefinitionJson).HasMaxLength(4000).IsRequired();
        b.HasIndex(x => new { x.OwnerUserId, x.Name }).IsUnique().HasDatabaseName("UQ_AssetReport_OwnerName");
    }
}
