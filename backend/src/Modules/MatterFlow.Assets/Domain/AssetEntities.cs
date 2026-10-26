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

    /// <summary>
    /// Always equals <c>DispositionCode == Active</c> (database check <c>CK_Asset_IsActive_Disposition</c>): use <see cref="SetDisposition"/>
    /// instead of assigning it, so both columns change together.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>Retention state of the record, one of the <see cref="AssetDisposition"/> codes.</summary>
    public string DispositionCode { get; set; } = AssetDisposition.Active;

    public DateTime? DispositionChangedAtUtc { get; set; }

    public int? DispositionChangedByUserId { get; set; }

    public string? DispositionNote { get; set; }

    /// <summary>Sets the disposition and keeps <see cref="IsActive"/> in step (active only when the disposition is Active).</summary>
    public void SetDisposition(string code, DateTime? changedAtUtc = null, int? changedByUserId = null, string? note = null)
    {
        DispositionCode = code;
        IsActive = code == AssetDisposition.Active;
        DispositionChangedAtUtc = changedAtUtc;
        DispositionChangedByUserId = changedByUserId;
        DispositionNote = note;
    }

    int? IAuditScoped.AuditMatterId => MatterId;

    long? IAuditScoped.AuditTaskId => null;
}

/// <summary>The four disposition codes stored in <c>dbo.Asset.DispositionCode</c> (the database CHECK lists the same values).</summary>
public static class AssetDisposition
{
    public const string Active = "ACTIVE";
    public const string Inactive = "INACTIVE";
    public const string PendingDisposition = "PENDING_DISPOSITION";
    public const string Disposed = "DISPOSED";

    public static readonly IReadOnlyList<string> All = [Active, Inactive, PendingDisposition, Disposed];

    public static bool IsValid(string? code) => code is not null && All.Contains(code);
}
