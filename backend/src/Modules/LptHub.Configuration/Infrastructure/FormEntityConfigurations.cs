using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.Configuration.Domain.Forms.Rules;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace MatterFlow.Configuration.Infrastructure;

internal static class FormConverters
{
    public static ValueConverter<T, string> Wire<T>()
        where T : struct, Enum =>
        new(v => WireNames.ToWire(v), s => WireNames.Parse<T>(s));

    public static readonly ValueConverter<FormControl, string> Control =
        new(v => v.ToWireName(), s => ParseControl(s));

    private static FormControl ParseControl(string wire) =>
        FormControlExtensions.TryParseWireName(wire, out var control) ? control : FormControl.Unknown;
}

internal sealed class FormDefinitionConfiguration : IEntityTypeConfiguration<FormDefinition>
{
    public void Configure(EntityTypeBuilder<FormDefinition> b)
    {
        b.ToTable("FormDefinition");
        b.Property(x => x.Scope).HasColumnName("Scope").HasMaxLength(20).IsUnicode(false).HasConversion(FormConverters.Wire<FormOwnerKind>());
        b.Ignore(x => x.OwnerId);
        b.HasMany(x => x.Versions).WithOne(x => x.Definition).HasForeignKey(x => x.FormDefinitionId).HasConstraintName("FK_FormVersion_Definition");
        b.HasIndex(x => x.TaskTypeId).IsUnique().HasFilter("[TaskTypeId] IS NOT NULL").HasDatabaseName("UQ_FormDef_TaskType");
        b.HasIndex(x => x.StepDefinitionId).IsUnique().HasFilter("[StepDefinitionId] IS NOT NULL").HasDatabaseName("UQ_FormDef_Step");
        b.HasIndex(x => x.AssetTypeId).IsUnique().HasFilter("[AssetTypeId] IS NOT NULL").HasDatabaseName("UQ_FormDef_AssetType");
    }
}

internal sealed class FormVersionConfiguration : IEntityTypeConfiguration<FormVersion>
{
    public void Configure(EntityTypeBuilder<FormVersion> b)
    {
        b.ToTable("FormVersion", t => t.HasTrigger("TR_FormVersion_Immutable"));
        b.Property(x => x.Status).HasMaxLength(12).IsUnicode(false).HasConversion(FormConverters.Wire<FormVersionStatus>());
        b.Property(x => x.Notes).HasMaxLength(500);
        b.HasIndex(x => new { x.FormDefinitionId, x.VersionNo }).IsUnique().HasDatabaseName("UQ_FormVersion_No");
        b.HasMany(x => x.Fields).WithOne(x => x.Version).HasForeignKey(x => x.FormVersionId).HasConstraintName("FK_FormField_Version");
    }
}

internal sealed class FormFieldConfiguration : IEntityTypeConfiguration<FormField>
{
    public void Configure(EntityTypeBuilder<FormField> b)
    {
        b.ToTable("FormField", t => t.HasTrigger("TR_FormField_Immutable"));
        b.Property(x => x.FieldKey).HasMaxLength(64).IsUnicode(false).IsRequired();
        b.Property(x => x.Label).HasMaxLength(200).IsRequired();
        b.Property(x => x.ControlType).HasMaxLength(20).IsUnicode(false).HasConversion(FormConverters.Control);
        b.Property(x => x.HelpText).HasMaxLength(1000);
        b.Property(x => x.SectionKey).HasMaxLength(64).IsUnicode(false);
        b.Property(x => x.DefaultValueJson).HasColumnType("nvarchar(max)");
        b.Property(x => x.ValidationJson).HasColumnType("nvarchar(max)");
        b.Property(x => x.ShowWhenJson).HasColumnType("nvarchar(max)");
        b.Property(x => x.RequiredWhenJson).HasColumnType("nvarchar(max)");
        b.HasIndex(x => new { x.FormVersionId, x.FieldKey }).IsUnique().HasDatabaseName("UQ_FormField_Key");
        b.HasIndex(x => new { x.FormVersionId, x.SortOrder }).IsUnique().HasDatabaseName("UQ_FormField_Order");
        b.HasMany(x => x.Options).WithOne(x => x.Field).HasForeignKey(x => x.FormFieldId).HasConstraintName("FK_FormFieldOption_Field");
    }
}

internal sealed class FormFieldOptionConfiguration : IEntityTypeConfiguration<FormFieldOption>
{
    public void Configure(EntityTypeBuilder<FormFieldOption> b)
    {
        b.ToTable("FormFieldOption", t => t.HasTrigger("TR_FormFieldOption_Immutable"));
        b.Property(x => x.OptionKey).HasMaxLength(64).IsUnicode(false).IsRequired();
        b.Property(x => x.Label).HasMaxLength(200).IsRequired();
        b.Property(x => x.AvailableWhenJson).HasColumnType("nvarchar(max)");
        b.HasIndex(x => new { x.FormFieldId, x.OptionKey }).IsUnique().HasDatabaseName("UQ_FormFieldOption_Key");
        b.HasIndex(x => new { x.FormFieldId, x.SortOrder }).IsUnique().HasDatabaseName("UQ_FormFieldOption_Order");
    }
}

internal sealed class FormValueSetConfiguration : IEntityTypeConfiguration<FormValueSet>
{
    public void Configure(EntityTypeBuilder<FormValueSet> b)
    {
        b.ToTable("FormValueSet");
        b.Property(x => x.OwnerKind).HasMaxLength(16).IsUnicode(false).HasConversion(FormConverters.Wire<FormValueOwnerKind>());
        b.Property(x => x.ValuesJson).HasColumnType("nvarchar(max)").IsRequired();
        b.HasIndex(x => new { x.OwnerKind, x.OwnerId, x.FormDefinitionId }).IsUnique().HasDatabaseName("UQ_FormValueSet_Owner");
        b.HasOne<FormDefinition>().WithMany().HasForeignKey(x => x.FormDefinitionId).OnDelete(DeleteBehavior.NoAction).HasConstraintName("FK_FormValueSet_Definition");
        b.HasOne<FormVersion>().WithMany().HasForeignKey(x => x.FormVersionId).OnDelete(DeleteBehavior.NoAction).HasConstraintName("FK_FormValueSet_Version");
    }
}

internal sealed class CustomFieldIndexConfiguration : IEntityTypeConfiguration<CustomFieldIndex>
{
    public void Configure(EntityTypeBuilder<CustomFieldIndex> b)
    {
        b.ToTable("CustomFieldIndex");
        b.Property(x => x.OwnerKind).HasMaxLength(12).IsUnicode(false).HasConversion(FormConverters.Wire<FormValueOwnerKind>());
        b.Property(x => x.FieldKey).HasMaxLength(64).IsUnicode(false).IsRequired();
        b.Property(x => x.ValueText).HasMaxLength(450);
        b.Property(x => x.ValueNumber).HasColumnType("decimal(19,4)");
        b.Property(x => x.ValueDate).HasColumnType("date");
        b.Property(x => x.ValueDateTime).HasColumnType("datetime2");
        b.HasOne<FormDefinition>().WithMany().HasForeignKey(x => x.FormDefinitionId).OnDelete(DeleteBehavior.NoAction).HasConstraintName("FK_CFI_Definition");
    }
}
