using MatterFlow.Notifications.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MatterFlow.Notifications.Infrastructure;

internal sealed class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> b)
    {
        b.ToTable("Notification");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("Id").ValueGeneratedOnAdd();
        b.Property(x => x.EventType).HasMaxLength(40).IsUnicode(false).IsRequired();
        b.Property(x => x.ObjectKind).HasMaxLength(20).IsUnicode(false).IsRequired();
        b.Property(x => x.Message).HasMaxLength(300).IsRequired();
        b.Property(x => x.DedupeKey).HasMaxLength(80).IsRequired();
        b.Property(x => x.CreatedUtc).HasColumnType("datetime2(3)");
        b.Property(x => x.ReadUtc).HasColumnType("datetime2(3)");
        b.HasIndex(x => new { x.RecipientUserId, x.EventType, x.ObjectId, x.DedupeKey }).IsUnique().HasDatabaseName("UX_Notification_Dedupe");
        b.HasIndex(x => new { x.RecipientUserId, x.Id }).IsDescending(false, true).HasDatabaseName("IX_Notification_Recipient");
    }
}

internal sealed class NotificationPreferenceConfiguration : IEntityTypeConfiguration<NotificationPreference>
{
    public void Configure(EntityTypeBuilder<NotificationPreference> b)
    {
        b.ToTable("NotificationPreference");
        b.HasKey(x => new { x.UserId, x.EventType });
        b.Property(x => x.EventType).HasMaxLength(40).IsUnicode(false).IsRequired();
        b.Property(x => x.UpdatedUtc).HasColumnType("datetime2(3)");
    }
}
