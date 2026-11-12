using LptHub.Vendors.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LptHub.Vendors.Infrastructure;

internal sealed class VendorConfiguration : IEntityTypeConfiguration<Vendor>
{
    public void Configure(EntityTypeBuilder<Vendor> b)
    {
        b.ToTable("Vendor");
        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.Website).HasMaxLength(300);
        b.Property(x => x.CategoryCode).HasMaxLength(12).IsUnicode(false).IsRequired();
        b.Property(x => x.Note).HasMaxLength(2000);
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName("UQ_Vendor_Name");
        b.HasIndex(x => x.CategoryCode).HasDatabaseName("IX_Vendor_Category");

        // Rows that belong to a vendor (same module, no navigation properties): they go with it. A vendor with matter links is never deleted.
        b.HasMany<VendorServiceChoice>().WithOne().HasForeignKey(x => x.VendorId).OnDelete(DeleteBehavior.Cascade);
        b.HasMany<VendorAreaChoice>().WithOne().HasForeignKey(x => x.VendorId).OnDelete(DeleteBehavior.Cascade);
        b.HasMany<VendorTechAi>().WithOne().HasForeignKey(x => x.VendorId).OnDelete(DeleteBehavior.Cascade);
        b.HasMany<VendorContact>().WithOne().HasForeignKey(x => x.VendorId).OnDelete(DeleteBehavior.Cascade);
        b.HasMany<VendorMatter>().WithOne().HasForeignKey(x => x.VendorId).OnDelete(DeleteBehavior.Restrict);
    }
}

internal abstract class VendorOptionConfiguration<T>(string table, string uniqueName) : IEntityTypeConfiguration<T>
    where T : VendorOption
{
    public void Configure(EntityTypeBuilder<T> b)
    {
        b.ToTable(table);
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName(uniqueName);
    }
}

internal sealed class VendorServiceOptionConfiguration() : VendorOptionConfiguration<VendorServiceOption>("VendorServiceOption", "UQ_VendorServiceOption_Name");

internal sealed class VendorAreaOptionConfiguration() : VendorOptionConfiguration<VendorAreaOption>("VendorAreaOption", "UQ_VendorAreaOption_Name");

internal sealed class VendorServiceChoiceConfiguration : IEntityTypeConfiguration<VendorServiceChoice>
{
    public void Configure(EntityTypeBuilder<VendorServiceChoice> b)
    {
        b.ToTable("VendorServiceChoice");
        b.HasKey(x => new { x.VendorId, x.VendorServiceOptionId });
    }
}

internal sealed class VendorAreaChoiceConfiguration : IEntityTypeConfiguration<VendorAreaChoice>
{
    public void Configure(EntityTypeBuilder<VendorAreaChoice> b)
    {
        b.ToTable("VendorAreaChoice");
        b.HasKey(x => new { x.VendorId, x.VendorAreaOptionId });
    }
}

internal sealed class VendorTechAiConfiguration : IEntityTypeConfiguration<VendorTechAi>
{
    public void Configure(EntityTypeBuilder<VendorTechAi> b)
    {
        b.ToTable("VendorTechAi");
        b.HasKey(x => x.Id); // not an Entity<T>: the key convention does not reach it
        b.Property(x => x.Id).HasColumnName("VendorTechAiId");
        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.HasIndex(x => new { x.VendorId, x.Name }).IsUnique().HasDatabaseName("UQ_VendorTechAi_Name");
    }
}

internal sealed class VendorContactConfiguration : IEntityTypeConfiguration<VendorContact>
{
    public void Configure(EntityTypeBuilder<VendorContact> b)
    {
        b.ToTable("VendorContact");
        b.Property(x => x.FlagCode).HasMaxLength(12).IsUnicode(false).IsRequired();
        b.Property(x => x.ReportedOn).HasColumnType("date");
        b.Property(x => x.Note).HasMaxLength(2000);
        b.HasIndex(x => new { x.VendorId, x.PersonId }).IsUnique().HasDatabaseName("UQ_VendorContact_VendorPerson");
        b.HasIndex(x => x.PersonId).HasDatabaseName("IX_VendorContact_Person");
    }
}

internal sealed class VendorMatterConfiguration : IEntityTypeConfiguration<VendorMatter>
{
    public void Configure(EntityTypeBuilder<VendorMatter> b)
    {
        b.ToTable("VendorMatter");
        b.HasKey(x => new { x.VendorId, x.MatterId });
        b.Property(x => x.LinkedAtUtc).HasColumnName("LinkedAt");
        b.Ignore(x => x.AuditMatterId);
        b.Ignore(x => x.AuditTaskId);
        b.HasIndex(x => new { x.MatterId, x.VendorId }).HasDatabaseName("IX_VendorMatter_Matter");
    }
}
