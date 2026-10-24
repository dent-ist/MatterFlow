using MatterFlow.Audit.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MatterFlow.Audit.Infrastructure;

/// <summary>Maps <see cref="AuditEvent"/> to dbo.AuditEvent (03-audit.sql). The table has UPDATE/DELETE triggers, so EF is told about them.</summary>
public sealed class AuditEventConfiguration : IEntityTypeConfiguration<AuditEvent>
{
    public void Configure(EntityTypeBuilder<AuditEvent> b)
    {
        b.ToTable("AuditEvent", t => t.HasTrigger("TR_AuditEvent_AppendOnly"));
        b.Property(e => e.OccurredAtUtc).HasColumnType("datetime2(3)");
        b.Property(e => e.EventType).HasMaxLength(64).IsUnicode(false).IsRequired();
        b.Property(e => e.ObjectType).HasMaxLength(40).IsUnicode(false).IsRequired();
        b.Property(e => e.ObjectId).HasMaxLength(40).IsUnicode(false).IsRequired();
        b.Property(e => e.FieldKey).HasMaxLength(100).IsUnicode(false);
        b.Property(e => e.Summary).HasMaxLength(500);
        b.Property(e => e.IsSensitiveScope).HasDefaultValue(false);
    }
}
