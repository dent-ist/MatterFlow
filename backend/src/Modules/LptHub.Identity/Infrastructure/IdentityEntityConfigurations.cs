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
        b.Property(x => x.LandingPage).HasMaxLength(40).IsUnicode(false);
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

internal sealed class UserAvailabilityConfiguration : IEntityTypeConfiguration<UserAvailability>
{
    public void Configure(EntityTypeBuilder<UserAvailability> b)
    {
        b.ToTable("UserAvailability");
        b.HasKey(x => x.UserId);
        b.Property(x => x.TimeZoneId).HasMaxLength(64).IsUnicode(false);
        b.Property(x => x.UpdatedAtUtc).HasColumnName("UpdatedAtUtc");
        b.Property(x => x.RowVersion).HasColumnName("RowVersion").IsRowVersion().IsRequired();
        b.HasOne<AppUser>().WithOne().HasForeignKey<UserAvailability>(x => x.UserId).HasConstraintName("FK_UserAvailability_User");
    }
}

internal sealed class UserAbsenceConfiguration : IEntityTypeConfiguration<UserAbsence>
{
    public void Configure(EntityTypeBuilder<UserAbsence> b)
    {
        b.ToTable("UserAbsence");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("AbsenceId");
        b.Property(x => x.AbsenceType).HasMaxLength(20).IsUnicode(false).IsRequired();
        b.Property(x => x.Note).HasMaxLength(200);
        b.Property(x => x.CreatedAtUtc).HasColumnType("datetime2(3)");
        b.Property(x => x.UpdatedAtUtc).HasColumnType("datetime2(3)");
        b.Property(x => x.RowVersion).IsRowVersion().IsRequired();
        b.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).HasConstraintName("FK_UserAbsence_User");
        b.HasIndex(x => new { x.UserId, x.StartDate }).HasDatabaseName("IX_UserAbsence_User");
    }
}

internal sealed class HolidayCalendarConfiguration : IEntityTypeConfiguration<HolidayCalendar>
{
    public void Configure(EntityTypeBuilder<HolidayCalendar> b)
    {
        b.ToTable("HolidayCalendar");
        b.Property(x => x.Id).HasColumnName("CalendarId");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.Property(x => x.ColourKey).HasMaxLength(20).IsUnicode(false).IsRequired();
        b.Property(x => x.RegionNote).HasMaxLength(200);
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName("UQ_HolidayCalendar_Name");
    }
}

internal sealed class HolidayConfiguration : IEntityTypeConfiguration<Holiday>
{
    public void Configure(EntityTypeBuilder<Holiday> b)
    {
        b.ToTable("Holiday");
        b.Property(x => x.Id).HasColumnName("HolidayId");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.Property(x => x.RuleKind).HasMaxLength(20).IsUnicode(false).IsRequired();
        b.Property(x => x.WeekendRule).HasMaxLength(10).IsUnicode(false).IsRequired();
        b.Property(x => x.RegionNote).HasMaxLength(200);
        b.Property(x => x.Month).HasColumnType("tinyint");
        b.Property(x => x.Day).HasColumnType("tinyint");
        b.Property(x => x.Weekday).HasColumnType("tinyint");
        b.Property(x => x.PlusDays).HasColumnType("tinyint");
        b.Property(x => x.RangeEndMonth).HasColumnType("tinyint");
        b.Property(x => x.RangeEndDay).HasColumnType("tinyint");
        b.Property(x => x.Nth).HasColumnType("smallint");
        b.Property(x => x.EasterOffset).HasColumnType("smallint");
        b.HasOne<HolidayCalendar>().WithMany().HasForeignKey(x => x.CalendarId).HasConstraintName("FK_Holiday_Calendar");
        b.HasIndex(x => new { x.CalendarId, x.Id }).HasDatabaseName("IX_Holiday_Calendar");
    }
}

internal sealed class UserWorkHourConfiguration : IEntityTypeConfiguration<UserWorkHour>
{
    public void Configure(EntityTypeBuilder<UserWorkHour> b)
    {
        b.ToTable("UserWorkHour");
        b.HasKey(x => new { x.UserId, x.DayOfWeek });
        b.Property(x => x.DayOfWeek).HasColumnType("tinyint").HasConversion<byte>();
        b.Property(x => x.StartTime).HasColumnType("time(0)");
        b.Property(x => x.EndTime).HasColumnType("time(0)");
        b.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).HasConstraintName("FK_UserWorkHour_User");
    }
}

internal sealed class UserViewConfiguration : IEntityTypeConfiguration<UserView>
{
    public void Configure(EntityTypeBuilder<UserView> b)
    {
        b.ToTable("UserView");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("UserViewId");
        b.Property(x => x.Surface).HasMaxLength(40).IsUnicode(false).IsRequired();
        b.Property(x => x.Name).HasMaxLength(80);
        b.Property(x => x.StateJson).HasMaxLength(4000).IsRequired();
        b.Property(x => x.CreatedAtUtc).HasColumnName("CreatedAt").HasColumnType("datetime2(3)");
        b.Property(x => x.ModifiedAtUtc).HasColumnName("ModifiedAt").HasColumnType("datetime2(3)");
        b.Property(x => x.RowVersion).IsRowVersion().IsRequired();
        b.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).HasConstraintName("FK_UserView_User");
        b.HasIndex(x => new { x.UserId, x.Surface, x.Name }).IsUnique().HasDatabaseName("UQ_UserView_Name");
    }
}
