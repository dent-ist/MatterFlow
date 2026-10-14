using MatterFlow.Identity.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MatterFlow.Identity.Infrastructure;

internal sealed class AppUserConfiguration : IEntityTypeConfiguration<AppUser>
{
    public void Configure(EntityTypeBuilder<AppUser> b)
    {
        b.ToTable("AppUser");
        b.Property(x => x.Id).HasColumnName("UserId");
        b.Property(x => x.DisplayName).HasMaxLength(200).IsRequired();
        b.Property(x => x.Email).HasMaxLength(320);
        b.Property(x => x.BootstrapAppliedAt).HasColumnName("BootstrapAppliedAt");
        b.HasMany(x => x.Identities).WithOne(x => x.User).HasForeignKey(x => x.UserId).HasConstraintName("FK_UserIdentity_User");
        b.HasMany(x => x.Roles).WithOne(x => x.User).HasForeignKey(x => x.UserId).HasConstraintName("FK_UserRole_User");
    }
}

internal sealed class UserIdentityConfiguration : IEntityTypeConfiguration<UserIdentity>
{
    public void Configure(EntityTypeBuilder<UserIdentity> b)
    {
        b.ToTable("UserIdentity");
        b.Property(x => x.Provider).HasMaxLength(20).IsUnicode(false).IsRequired();
        b.Property(x => x.TenantId).HasMaxLength(64).IsUnicode(false).IsRequired();
        b.Property(x => x.ProviderSubject).HasMaxLength(200).IsRequired();
        b.Property(x => x.Username).HasMaxLength(256).IsRequired();
        b.HasIndex(x => new { x.Provider, x.TenantId, x.ProviderSubject }).IsUnique().HasDatabaseName("UQ_UserIdentity_Provider");
    }
}

internal sealed class RoleConfiguration : IEntityTypeConfiguration<Role>
{
    public void Configure(EntityTypeBuilder<Role> b)
    {
        b.ToTable("Role");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.Property(x => x.Description).HasMaxLength(500);
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName("UQ_Role_Name");
        b.HasMany(x => x.Permissions).WithOne(x => x.Role).HasForeignKey(x => x.RoleId).HasConstraintName("FK_RolePermission_Role");
    }
}

internal sealed class PermissionConfiguration : IEntityTypeConfiguration<Permission>
{
    public void Configure(EntityTypeBuilder<Permission> b)
    {
        b.ToTable("Permission");
        b.Property(x => x.Code).HasMaxLength(64).IsUnicode(false).IsRequired();
        b.Property(x => x.GroupName).HasMaxLength(40).IsUnicode(false).IsRequired();
        b.Property(x => x.Description).HasMaxLength(300).IsRequired();
        b.HasIndex(x => x.Code).IsUnique().HasDatabaseName("UQ_Permission_Code");
    }
}

internal sealed class RolePermissionConfiguration : IEntityTypeConfiguration<RolePermission>
{
    public void Configure(EntityTypeBuilder<RolePermission> b)
    {
        b.ToTable("RolePermission");
        b.HasKey(x => new { x.RoleId, x.PermissionId });
        b.HasOne(x => x.Permission).WithMany().HasForeignKey(x => x.PermissionId).HasConstraintName("FK_RolePermission_Permission");
    }
}

internal sealed class UserRoleConfiguration : IEntityTypeConfiguration<UserRole>
{
    public void Configure(EntityTypeBuilder<UserRole> b)
    {
        b.ToTable("UserRole");
        b.HasKey(x => new { x.UserId, x.RoleId });
        b.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId).HasConstraintName("FK_UserRole_Role");
    }
}
