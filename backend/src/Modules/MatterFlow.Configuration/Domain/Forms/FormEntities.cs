using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms.Rules;
using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;

namespace MatterFlow.Configuration.Domain.Forms;

/// <summary>The form of one owner (Task Type, Step Definition, Asset Type, or the Client/Matter/Project singleton). Exactly one owner key is set.</summary>
public class FormDefinition : AuditedEntity<int>
{
    public FormOwnerKind Scope { get; set; }

    public int? TaskTypeId { get; set; }

    public int? StepDefinitionId { get; set; }

    public int? AssetTypeId { get; set; }

    public bool IsActive { get; set; } = true;

    public List<FormVersion> Versions { get; set; } = [];

    /// <summary>The owner id for non-singleton scopes; null for Client, Matter and Project.</summary>
    public int? OwnerId => Scope switch
    {
        FormOwnerKind.TaskType => TaskTypeId,
        FormOwnerKind.Step => StepDefinitionId,
        FormOwnerKind.AssetType => AssetTypeId,
        _ => null,
    };

    /// <summary>Sets the owner key that matches <paramref name="kind"/> and clears the others.</summary>
    public void SetOwner(FormOwnerKind kind, int? ownerId)
    {
        Scope = kind;
        TaskTypeId = kind == FormOwnerKind.TaskType ? ownerId : null;
        StepDefinitionId = kind == FormOwnerKind.Step ? ownerId : null;
        AssetTypeId = kind == FormOwnerKind.AssetType ? ownerId : null;
    }
}

/// <summary>One version of a form. A DRAFT is editable; PUBLISHED and RETIRED versions are immutable (service guard and database triggers).</summary>
public class FormVersion : AuditedEntity<int>
{
    public int FormDefinitionId { get; set; }

    public FormDefinition Definition { get; set; } = null!;

    public int VersionNo { get; set; }

    public FormVersionStatus Status { get; set; }

    public int? ClonedFromVersionId { get; set; }

    public DateTime? PublishedAt { get; set; }

    public int? PublishedByUserId { get; set; }

    public string? Notes { get; set; }

    public List<FormField> Fields { get; set; } = [];
}

/// <summary>A field of a form version. Fields of non-draft versions never change.</summary>
public class FormField : Entity<int>
{
    public int FormVersionId { get; set; }

    public FormVersion Version { get; set; } = null!;

    /// <summary>Stable across versions; <c>^[a-z][a-z0-9_]{0,63}$</c>.</summary>
    public string FieldKey { get; set; } = string.Empty;

    public string Label { get; set; } = string.Empty;

    public FormControl ControlType { get; set; }

    public string? HelpText { get; set; }

    public int SortOrder { get; set; }

    public string? SectionKey { get; set; }

    public bool IsRequired { get; set; }

    public string? DefaultValueJson { get; set; }

    public string? ValidationJson { get; set; }

    public string? ShowWhenJson { get; set; }

    public string? RequiredWhenJson { get; set; }

    public bool IsFilterable { get; set; }

    public List<FormFieldOption> Options { get; set; } = [];
}

/// <summary>An option of a SELECT, RADIO or MULTISELECT field.</summary>
public class FormFieldOption : Entity<int>
{
    public int FormFieldId { get; set; }

    public FormField Field { get; set; } = null!;

    public string OptionKey { get; set; } = string.Empty;

    public string Label { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public string? AvailableWhenJson { get; set; }
}

/// <summary>The values submitted for one owner and the form version they were captured under. Per-key changes are audited as <c>form:&lt;key&gt;</c>.</summary>
[Audited]
public class FormValueSet : AuditedEntity<long>
{
    public FormValueOwnerKind OwnerKind { get; set; }

    public long OwnerId { get; set; }

    public int FormDefinitionId { get; set; }

    public int FormVersionId { get; set; }

    [AuditJsonFields("form")]
    public string ValuesJson { get; set; } = "{}";
}

/// <summary>Derived typed filter value of a filterable field (architecture 7.6); rebuildable from <see cref="FormValueSet"/>.</summary>
public class CustomFieldIndex : Entity<long>
{
    public FormValueOwnerKind OwnerKind { get; set; }

    public long OwnerId { get; set; }

    public int FormDefinitionId { get; set; }

    public string FieldKey { get; set; } = string.Empty;

    public string? ValueText { get; set; }

    public decimal? ValueNumber { get; set; }

    public DateOnly? ValueDate { get; set; }

    public DateTime? ValueDateTime { get; set; }

    public bool? ValueBool { get; set; }
}
