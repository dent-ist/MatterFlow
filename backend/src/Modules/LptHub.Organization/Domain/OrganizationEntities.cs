using LptHub.Organization.Contracts;
using LptHub.SharedKernel.Audit;
using LptHub.SharedKernel.Entities;
using LptHub.SharedKernel.ValueObjects;

namespace LptHub.Organization.Domain;

/// <summary>
/// A firm client. <see cref="ClientNumber"/> is the zero-padded number the firm's main system issued (<c>343</c> is stored as <c>00343</c>);
/// the internal <see cref="Entity{TKey}.Id"/> never changes. Number changes are audited explicitly (CLIENT_NUMBER_CHANGED).
/// </summary>
[Audited]
public class Client : AuditedEntity<int>
{
    [AuditExplicit]
    public BusinessNumber ClientNumber { get; set; }

    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    /// <summary>Extension point for custom-field values; the forms engine owns the contents.</summary>
    [AuditJsonFields("custom")]
    public string? CustomFieldsJson { get; set; }
}

/// <summary>
/// A Matter under one Client. The number is unique only within the Client. <see cref="MatterRef"/> (<c>00343-00012</c>) is a database
/// computed column and never entered or stored independently.
/// </summary>
[Audited]
public class Matter : AuditedEntity<int>, IAuditScoped
{
    public int ClientId { get; set; }

    /// <summary>Denormalized copy of the Client's number; the database keeps it equal to the Client's (composite FK, ON UPDATE CASCADE).</summary>
    [AuditExplicit]
    public BusinessNumber ClientNumber { get; set; }

    [AuditExplicit]
    public BusinessNumber MatterNumber { get; set; }

    /// <summary>Combined display reference computed by the database; empty until the row has been saved.</summary>
    public string MatterRef { get; private set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Sensitivity flag. A warning banner (addendum O) and, once the go-live switch <c>Features:SensitiveMatterAccess</c> is on, the access rule of epic #788
    /// (only its managers, holders of <c>Matter.ViewSensitive</c> and people assigned a task on it see the matter). Changes are audited by a dedicated
    /// <c>MATTER_SENSITIVITY_CHANGED</c> event, not as a generic field change.
    /// </summary>
    [AuditExplicit]
    public bool IsSensitive { get; set; }

    /// <summary>
    /// Optional Primary project manager (epic #667). A matter without a manager is normal. Changes are audited by <c>MATTER_MANAGER_CHANGED</c> events
    /// (with the people's names), not as generic field changes.
    /// </summary>
    [AuditExplicit]
    public int? PrimaryManagerId { get; set; }

    /// <summary>Optional Secondary project manager, with the same rights as the Primary. Allowed without a Primary; never the same person as the Primary.</summary>
    [AuditExplicit]
    public int? SecondaryManagerId { get; set; }

    /// <summary>Which AI tools may be used on this Matter's content (MD-02, #1003): No (default), On-prem only or Company-approved. Changes are audited as a field change.</summary>
    public MatterAiAllowed AiAllowed { get; set; }

    // The Matter Types of a matter (epic #1368, issue #1370: zero, one or several) are the rows of MatterMatterType, not a column of this entity. The old single column
    // The old MatterTypeId column of the Matter table is kept in the database until a later script drops it; nothing maps or reads it any more.

    /// <summary>Optional Matter Category (admin list, epic #1368; a single choice). Changes are audited by <c>MATTER_CATEGORY_CHANGED</c> events with the names, not as generic field changes.</summary>
    [AuditExplicit]
    public int? MatterCategoryId { get; set; }

    /// <summary>Optional Current State (admin list, epic #1298): the current value only. Each change is audited by a <c>MATTER_STATE_CHANGED</c> event with the names.</summary>
    [AuditExplicit]
    public int? CurrentStateId { get; set; }

    /// <summary>Optional DMS location: a UNC path (<c>\\server\share\...</c>) or an http/https address; trimmed, at most 1000 characters. Changes are audited as a field change.</summary>
    public string? DmsPath { get; set; }

    /// <summary>Optional DFS location, same rules as <see cref="DmsPath"/>.</summary>
    public string? DfsPath { get; set; }

    [AuditJsonFields("custom")]
    public string? CustomFieldsJson { get; set; }

    int? IAuditScoped.AuditMatterId => Id;

    long? IAuditScoped.AuditTaskId => null;
}

/// <summary>
/// One Matter Type chosen on a matter (epic #1368, issue #1370): the matter and the type are the key. Changes are audited by <c>MATTER_TYPE_CHANGED</c> events with the
/// type names (one event per save that changes the set), so the row itself is not field-audited. Shown in the order of the Matter Types list.
/// </summary>
public class MatterMatterType
{
    public int MatterId { get; set; }

    /// <summary>The Matter Type (admin list in the Configuration module); a type that is later deactivated stays on the matters that use it.</summary>
    public int MatterTypeId { get; set; }
}

/// <summary>A flat container of Tasks within a Matter (no nesting). A Task's Project must belong to the Task's Matter.</summary>
[Audited]
public class Project : AuditedEntity<int>, IAuditScoped
{
    public int MatterId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    /// <summary>False means archived: existing Tasks keep the Project, new Tasks cannot select it.</summary>
    public bool IsActive { get; set; } = true;

    [AuditJsonFields("custom")]
    public string? CustomFieldsJson { get; set; }

    int? IAuditScoped.AuditMatterId => MatterId;

    long? IAuditScoped.AuditTaskId => null;
}

/// <summary>
/// One person on a matter's team (epic #1298): a typed-in contact (name, e-mail, title), not a user account, so the Team never affects visibility,
/// My Matters or permissions. The e-mail is unique within the matter without regard to case. Changes are audited by explicit
/// <c>MATTER_TEAM_MEMBER_*</c> events, so the entity itself is not field-audited.
/// </summary>
public class MatterTeamMember : AuditedEntity<int>
{
    public int MatterId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    /// <summary>The Team Title (admin list in the Configuration module); a title that is later deactivated stays on the rows that use it.</summary>
    public int TeamTitleId { get; set; }

    public int SortOrder { get; set; }
}
