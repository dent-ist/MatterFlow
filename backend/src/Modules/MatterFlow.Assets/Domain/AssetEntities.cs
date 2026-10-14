using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;

namespace MatterFlow.Assets.Domain;

/// <summary>
/// A kind of Asset (Document Set, Data Room, Source System, ...). Its own fields are the form definition of kind AssetType that is
/// created with it and edited in the form designer. Types are deactivated, not deleted.
/// </summary>
[Audited]
public class AssetType : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public int SortOrder { get; set; }

    /// <summary>False hides the type from new Assets; existing Assets keep it.</summary>
    public bool IsActive { get; set; } = true;
}

/// <summary>
/// A thing a Matter's Tasks work on. Owned by exactly one Matter, which cannot change after create (database trigger and API rule),
/// and never hard-deleted: <see cref="IsActive"/> false is the only way to retire it, so its change history stays readable.
/// The values of the Asset Type's fields live in the forms value store under the form version captured at save time.
/// </summary>
[Audited]
public class Asset : AuditedEntity<int>, IAuditScoped
{
    public int MatterId { get; set; }

    public int AssetTypeId { get; set; }

    public string DisplayName { get; set; } = string.Empty;

    /// <summary>URL, workspace id or media label identifying the asset outside MatterFlow.</summary>
    public string? ExternalReference { get; set; }

    public string? Description { get; set; }

    public bool IsActive { get; set; } = true;

    int? IAuditScoped.AuditMatterId => MatterId;

    long? IAuditScoped.AuditTaskId => null;
}
