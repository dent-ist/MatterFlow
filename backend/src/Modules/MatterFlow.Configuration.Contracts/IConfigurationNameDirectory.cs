using MatterFlow.Configuration.Contracts.Forms;

namespace MatterFlow.Configuration.Contracts;

/// <summary>The owner of a form definition, as the audit browser words it ("Matter custom fields", "Relativity Workspace fields").</summary>
/// <param name="Scope">What owns the form.</param>
/// <param name="OwnerId">The owner's id for a Task Type, Step or Asset Type; null for the Client, Matter and Project singletons.</param>
/// <param name="OwnerName">The Task Type's name when the owner is a Task Type and it exists; otherwise null.</param>
public sealed record FormOwnerInfo(FormOwnerKind Scope, int? OwnerId, string? OwnerName);

/// <summary>
/// Read-only names of configuration records for other modules (the audit browser's object labels). Rows that no longer exist are absent: a
/// caller keeps the name stored in the audit events.
/// </summary>
public interface IConfigurationNameDirectory
{
    /// <summary>Labels of the priorities that exist (inactive ones too), keyed by priority id.</summary>
    Task<IReadOnlyDictionary<int, string>> PriorityLabelsAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default);

    /// <summary>Display labels of the status labels that exist, keyed by status code.</summary>
    Task<IReadOnlyDictionary<string, string>> StatusLabelNamesAsync(IReadOnlyCollection<string> codes, CancellationToken cancellationToken = default);

    /// <summary>Names of the asset link roles that exist (inactive ones too), keyed by role id.</summary>
    Task<IReadOnlyDictionary<int, string>> AssetLinkRoleNamesAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default);

    /// <summary>The owners of the form definitions that exist, keyed by form definition id.</summary>
    Task<IReadOnlyDictionary<int, FormOwnerInfo>> FormOwnersAsync(IReadOnlyCollection<int> definitionIds, CancellationToken cancellationToken = default);
}
