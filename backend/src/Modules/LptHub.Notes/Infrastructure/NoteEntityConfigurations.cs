using LptHub.Notes.Application;
using LptHub.Notes.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LptHub.Notes.Infrastructure;

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
        b.HasIndex(x => new { x.MatterId, x.FolderId }).HasDatabaseName("IX_Note_Folder");
    }
}

internal sealed class NoteFolderConfiguration : IEntityTypeConfiguration<NoteFolder>
{
    public void Configure(EntityTypeBuilder<NoteFolder> b)
    {
        b.ToTable("NoteFolder");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.HasIndex(x => new { x.MatterId, x.ParentFolderId, x.Name }).IsUnique().HasDatabaseName(NoteSupport.FolderNameUnique);
        b.HasIndex(x => new { x.MatterId, x.ParentFolderId }).HasDatabaseName("IX_NoteFolder_Parent");
    }
}

internal sealed class NoteImageConfiguration : IEntityTypeConfiguration<NoteImage>
{
    public void Configure(EntityTypeBuilder<NoteImage> b)
    {
        b.ToTable("NoteImage");
        b.Property(x => x.ContentType).HasMaxLength(20).IsUnicode(false).IsRequired();
        b.Property(x => x.Width).HasColumnType("smallint");
        b.Property(x => x.Height).HasColumnType("smallint");
        b.Property(x => x.ContentSha256).HasColumnType("binary(32)").IsRequired();
        b.Property(x => x.Content).HasColumnType("varbinary(max)").IsRequired();
        b.Property(x => x.UploadedAtUtc).HasColumnName("UploadedAt");
        b.HasIndex(x => x.MatterId).HasDatabaseName("IX_NoteImage_Matter");
        b.HasIndex(x => x.UploadedAtUtc).HasDatabaseName("IX_NoteImage_Uploaded");
        b.HasIndex(x => x.UploadedByUserId).HasDatabaseName("IX_NoteImage_UploadedBy");
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
        b.HasIndex(x => x.Name).IsUnique().HasFilter("[ScopeCode] = 'SYSTEM'").HasDatabaseName(NoteSupport.SystemTemplateNameUnique);
        b.HasIndex(x => new { x.ClientId, x.Name }).IsUnique().HasFilter("[ClientId] IS NOT NULL").HasDatabaseName(NoteSupport.ClientTemplateNameUnique);
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
