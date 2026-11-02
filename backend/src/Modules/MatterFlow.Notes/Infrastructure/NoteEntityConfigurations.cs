using MatterFlow.Notes.Application;
using MatterFlow.Notes.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MatterFlow.Notes.Infrastructure;

internal sealed class NoteConfiguration : IEntityTypeConfiguration<Note>
{
    public void Configure(EntityTypeBuilder<Note> b)
    {
        b.ToTable("Note");
        b.Ignore(x => x.IsLocked);
        b.Property(x => x.Title).HasMaxLength(300).IsRequired();
        b.Property(x => x.Snippet).HasMaxLength(300).IsRequired();
        b.Property(x => x.BodyHtml).IsRequired();
        b.Property(x => x.BodyText).IsRequired();
        b.Property(x => x.LockedAtUtc).HasColumnName("LockedAt");
        b.Property(x => x.ContentUpdatedAtUtc).HasColumnName("ContentUpdatedAt");
        b.HasIndex(x => x.MatterId).HasDatabaseName("IX_Note_Matter");
    }
}

internal sealed class NoteTagConfiguration : IEntityTypeConfiguration<NoteTag>
{
    public void Configure(EntityTypeBuilder<NoteTag> b)
    {
        b.ToTable("NoteTag");
        b.Property(x => x.Name).HasMaxLength(60).IsRequired();
        b.Property(x => x.ColourKey).HasMaxLength(20).IsUnicode(false);
        b.HasIndex(x => x.Name).IsUnique().HasDatabaseName(NoteSupport.TagNameUnique);
    }
}

internal sealed class NoteTagLinkConfiguration : IEntityTypeConfiguration<NoteTagLink>
{
    public void Configure(EntityTypeBuilder<NoteTagLink> b)
    {
        b.ToTable("NoteTagLink");
        b.HasKey(x => new { x.NoteId, x.NoteTagId });
    }
}

internal sealed class NoteLinkConfiguration : IEntityTypeConfiguration<NoteLink>
{
    public void Configure(EntityTypeBuilder<NoteLink> b)
    {
        b.ToTable("NoteLink");
        b.HasKey(x => new { x.NoteId, x.TargetType, x.TargetId });
        b.Property(x => x.TargetType).HasMaxLength(10).IsUnicode(false).IsRequired();
    }
}

internal sealed class NoteTemplateConfiguration : IEntityTypeConfiguration<NoteTemplate>
{
    public void Configure(EntityTypeBuilder<NoteTemplate> b)
    {
        b.ToTable("NoteTemplate");
        b.Property(x => x.ScopeCode).HasMaxLength(6).IsUnicode(false).IsRequired();
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.Property(x => x.Description).HasMaxLength(160);
        b.Property(x => x.TitleTemplate).HasMaxLength(300);
        b.Property(x => x.BodyHtml).IsRequired();
        b.HasIndex(x => new { x.MatterId, x.Name }).IsUnique().HasFilter("[MatterId] IS NOT NULL").HasDatabaseName(NoteSupport.MatterTemplateNameUnique);
        b.HasIndex(x => x.Name).IsUnique().HasFilter("[ScopeCode] = 'FIRM'").HasDatabaseName(NoteSupport.FirmTemplateNameUnique);
    }
}

internal sealed class NoteTemplateTagConfiguration : IEntityTypeConfiguration<NoteTemplateTag>
{
    public void Configure(EntityTypeBuilder<NoteTemplateTag> b)
    {
        b.ToTable("NoteTemplateTag");
        b.HasKey(x => new { x.NoteTemplateId, x.NoteTagId });
    }
}
