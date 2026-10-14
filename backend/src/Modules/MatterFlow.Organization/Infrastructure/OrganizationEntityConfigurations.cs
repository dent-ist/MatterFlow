using MatterFlow.Organization.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MatterFlow.Organization.Infrastructure;

internal sealed class ClientConfiguration : IEntityTypeConfiguration<Client>
{
    public void Configure(EntityTypeBuilder<Client> b)
    {
        b.ToTable("Client");
        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.CustomFieldsJson);
        b.HasIndex(x => x.ClientNumber).IsUnique().HasDatabaseName("UQ_Client_Number");
    }
}

internal sealed class MatterConfiguration : IEntityTypeConfiguration<Matter>
{
    public void Configure(EntityTypeBuilder<Matter> b)
    {
        b.ToTable("Matter");
        b.Property(x => x.Name).HasMaxLength(300).IsRequired();
        b.Property(x => x.MatterRef)
            .HasMaxLength(11)
            .IsUnicode(false)
            .IsFixedLength()
            .HasComputedColumnSql("CONVERT(CHAR(11), [ClientNumber] + '-' + [MatterNumber])", stored: true);
        b.HasIndex(x => new { x.ClientId, x.MatterNumber }).IsUnique().HasDatabaseName("UQ_Matter_ClientMatterNumber");
        b.HasIndex(x => x.MatterRef).IsUnique().HasDatabaseName("UQ_Matter_Ref");
    }
}

internal sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> b)
    {
        b.ToTable("Project");
        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.Description).HasMaxLength(2000);
        b.HasIndex(x => new { x.MatterId, x.Name }).IsUnique().HasDatabaseName("UQ_Project_MatterName");
    }
}
