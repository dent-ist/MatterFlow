using LptHub.Integrations.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LptHub.Integrations.Infrastructure;

internal sealed class EntraConnectionConfiguration : IEntityTypeConfiguration<EntraConnection>
{
    public void Configure(EntityTypeBuilder<EntraConnection> b)
    {
        b.ToTable("EntraConnection");
        b.Property(x => x.Id).ValueGeneratedNever();
        b.Property(x => x.TenantId).HasMaxLength(100);
        b.Property(x => x.ClientId).HasMaxLength(100);
        b.Property(x => x.ClientSecretProtected).HasMaxLength(4000);
        b.Property(x => x.LastTestOutcome).HasMaxLength(30).IsUnicode(false);
    }
}

internal sealed class IntegrationConfiguration : IEntityTypeConfiguration<Integration>
{
    public void Configure(EntityTypeBuilder<Integration> b)
    {
        b.ToTable("Integration");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.Property(x => x.TypeCode).HasMaxLength(20).IsUnicode(false).IsRequired();
        b.Property(x => x.BaseUrl).HasMaxLength(500);
        b.Property(x => x.Scope).HasMaxLength(300);
        b.Property(x => x.LastTestOutcome).HasMaxLength(30).IsUnicode(false);
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName("UQ_Integration_Name");
        b.HasIndex(x => x.TypeCode).IsUnique().HasFilter("[TypeCode] <> 'OTHER'").HasDatabaseName("UQ_Integration_FixedType");
    }
}
