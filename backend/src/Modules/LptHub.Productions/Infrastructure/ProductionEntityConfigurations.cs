using LptHub.Productions.Application;
using LptHub.Productions.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LptHub.Productions.Infrastructure;

internal sealed class ProductionSpecConfiguration : IEntityTypeConfiguration<ProductionSpec>
{
    public void Configure(EntityTypeBuilder<ProductionSpec> b)
    {
        b.ToTable("ProductionSpec", t => t.HasTrigger("TR_ProductionSpec_Guard"));
        b.Ignore(x => x.IsRetired);
        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.StatusCode).HasMaxLength(10).IsUnicode(false).IsRequired().HasDefaultValue(SpecStatus.Active);
        b.Property(x => x.SourceOfAgreement).HasMaxLength(300);
        b.Property(x => x.Description).HasMaxLength(1000);
        b.Property(x => x.ImageFormat).HasMaxLength(100);
        b.Property(x => x.ColourMode).HasMaxLength(100);
        b.Property(x => x.TextMode).HasMaxLength(100);
        b.Property(x => x.NativesRule).HasMaxLength(300);
        b.Property(x => x.LoadFile).HasMaxLength(100);
        b.Property(x => x.MetadataFieldsJson).HasMaxLength(4000);
        b.Property(x => x.RedactionRule).HasMaxLength(300);
        b.Property(x => x.PrivilegeRule).HasMaxLength(300);
        b.Property(x => x.DedupRule).HasMaxLength(200);
        b.Property(x => x.DateTimeRule).HasMaxLength(200);
        b.Property(x => x.NumberingRule).HasMaxLength(200);
        b.Property(x => x.DeliveryRule).HasMaxLength(300);
        b.Property(x => x.Notes).HasMaxLength(2000);
        b.HasIndex(x => new { x.MatterId, x.Name }).IsUnique().HasFilter("[StatusCode] = 'Active'").HasDatabaseName(ProductionSupport.ActiveSpecNameUnique);
        b.HasIndex(x => new { x.MatterId, x.StatusCode }).HasDatabaseName("IX_ProductionSpec_Matter");
    }
}

internal sealed class ProductionConfiguration : IEntityTypeConfiguration<Production>
{
    public void Configure(EntityTypeBuilder<Production> b)
    {
        b.ToTable("Production");
        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.VolumeNo).HasMaxLength(50);
        b.Property(x => x.DirectionCode).HasMaxLength(3).IsUnicode(false).IsRequired();
        b.Property(x => x.PartyName).HasMaxLength(200);
        b.Property(x => x.BatesBegin).HasMaxLength(50);
        b.Property(x => x.BatesEnd).HasMaxLength(50);
        b.Property(x => x.DeliveredOrDueOn).HasColumnType("date");
        b.Property(x => x.Notes).HasMaxLength(4000);
        b.HasIndex(x => new { x.MatterId, x.DirectionCode }).HasDatabaseName("IX_Production_Matter");
    }
}

internal sealed class ProductionCommentConfiguration : IEntityTypeConfiguration<ProductionComment>
{
    public void Configure(EntityTypeBuilder<ProductionComment> b)
    {
        b.ToTable("ProductionComment");
        b.Property(x => x.Body).HasMaxLength(4000).IsRequired();
        b.HasIndex(x => new { x.ProductionId, x.Id }).HasDatabaseName("IX_ProductionComment_Production");
    }
}
