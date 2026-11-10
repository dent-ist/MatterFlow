using MatterFlow.Configuration.Domain.Settings;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MatterFlow.Configuration.Infrastructure;

/// <summary>Mapping of <c>dbo.AppSetting</c> (script 48); the key is text, so the shared <c>Entity</c> conventions do not apply.</summary>
internal sealed class AppSettingConfiguration : IEntityTypeConfiguration<AppSetting>
{
    public void Configure(EntityTypeBuilder<AppSetting> b)
    {
        b.ToTable("AppSetting");
        b.HasKey(x => x.SettingKey);
        b.Property(x => x.SettingKey).HasMaxLength(100).IsUnicode(false).ValueGeneratedNever();
        b.Property(x => x.ValueText).HasMaxLength(1000);
        b.Property(x => x.ValueBinary).HasColumnType("varbinary(max)");
        b.Property(x => x.ContentType).HasMaxLength(100).IsUnicode(false);
        b.Property(x => x.ContentSha256).HasColumnType("binary(32)");
        b.Property(x => x.UpdatedAtUtc).HasColumnType("datetime2(3)");
        b.Property(x => x.UpdatedByUserId);
        b.Property(x => x.RowVersion).IsRowVersion().IsRequired();
    }
}
