using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;
using MatterFlow.SharedKernel.ValueObjects;

namespace MatterFlow.Organization.Domain;

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

    /// <summary>Display-only sensitivity flag (addendum O); does not restrict access.</summary>
    public bool IsSensitive { get; set; }

    [AuditJsonFields("custom")]
    public string? CustomFieldsJson { get; set; }

    int? IAuditScoped.AuditMatterId => Id;

    long? IAuditScoped.AuditTaskId => null;
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
