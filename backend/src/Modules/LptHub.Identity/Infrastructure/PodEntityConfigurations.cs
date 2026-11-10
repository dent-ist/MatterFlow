using MatterFlow.Identity.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MatterFlow.Identity.Infrastructure;

internal sealed class PodConfiguration : IEntityTypeConfiguration<Pod>
{
    public void Configure(EntityTypeBuilder<Pod> b)
    {
        b.ToTable("Pod");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.Property(x => x.Description).HasMaxLength(500);
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName("UQ_Pod_Name");
        b.HasMany(x => x.Members).WithOne(x => x.Pod).HasForeignKey(x => x.PodId).HasConstraintName("FK_PodMember_Pod");
    }
}

internal sealed class PodMemberConfiguration : IEntityTypeConfiguration<PodMember>
{
    public void Configure(EntityTypeBuilder<PodMember> b)
    {
        b.ToTable("PodMember");
        b.HasKey(x => new { x.PodId, x.UserId });
        b.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).HasConstraintName("FK_PodMember_User");
        b.HasIndex(x => x.UserId).HasDatabaseName("IX_PodMember_User");
        b.HasIndex(x => x.UserId).IsUnique().HasFilter("[IsPrimary] = 1").HasDatabaseName("UQ_PodMember_Primary");
    }
}
