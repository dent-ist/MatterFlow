using LptHub.Configuration.Contracts;
using LptHub.SharedKernel.Audit;
using LptHub.SharedKernel.Entities;

namespace LptHub.Configuration.Domain;

/// <summary>
/// A kind of request (Data Processing, Collection, ...). Never deleted: deactivating hides it from new Tasks while historical Tasks keep it.
/// Its request form is the FormDefinition with Scope TASK_TYPE owned by this id; its eligible workflows are <see cref="TaskTypeWorkflowEligibility"/> rows.
/// </summary>
[Audited(ObjectType = "TaskType")]
public class TaskType : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>Key of this type's icon in the icon library (<c>contracts/task-type-icons.json</c>). Required; neutral colour, never uploaded.</summary>
    public string IconKey { get; set; } = TaskTypeIcons.DefaultKey;

    /// <summary>Name of this type's colour in the palette (<c>contracts/task-type-colours.json</c>); null = the neutral default. Never a free hex value.</summary>
    public string? ColourKey { get; set; }

    /// <summary>Expected turnaround in calendar days (1 to 365); null = no target. Drives the At risk badge.</summary>
    public int? TargetDays { get; set; }

    /// <summary>One of the eligible workflow definitions, pre-selected for new Tasks. No foreign key until the workflow tables exist.</summary>
    public int? DefaultWorkflowDefinitionId { get; set; }

    /// <summary>
    /// True exactly when at least one <see cref="TaskTypeRoleAccess"/> row of this type has <c>CanView</c> (epic #1397: no View role = open to everyone). A plain column, kept in the same
    /// transaction as the access rows by <c>TaskTypeAccessService</c> only. Written as the explicit events TASK_TYPE_RESTRICTED and TASK_TYPE_UNRESTRICTED, not as a field change.
    /// </summary>
    [AuditExplicit]
    public bool IsRestricted { get; set; }

    public List<TaskTypeWorkflowEligibility> EligibleWorkflows { get; set; } = [];
}

/// <summary>
/// One role in the access lists of a Task Type (epic #1397): three flags, Can View, Can Edit and Can Be Assigned. Edit and Assign imply View (the database refuses anything else,
/// <c>CK_TaskTypeRoleAccess_Implies</c>). A role that is in no list has no row. The lists are replaced as a set by <c>TaskTypeAccessService</c>, which writes the audit events.
/// </summary>
public class TaskTypeRoleAccess
{
    public int TaskTypeId { get; set; }

    /// <summary>Role id (plain value: the Role table belongs to the Identity module, which this module may not reference; the database holds the foreign key).</summary>
    public int RoleId { get; set; }

    public bool CanView { get; set; }

    public bool CanEdit { get; set; }

    public bool CanAssign { get; set; }

    public int? CreatedByUserId { get; set; }
}

/// <summary>A Workflow definition a Task Type may use for new Tasks. Changes are written as explicit TASK_TYPE_WORKFLOWS_CHANGED events.</summary>
public class TaskTypeWorkflowEligibility
{
    public int TaskTypeId { get; set; }

    /// <summary>Workflow definition id (plain value: the workflow tables arrive in a later script, which adds the foreign key).</summary>
    public int WorkflowDefinitionId { get; set; }

    public int? CreatedByUserId { get; set; }
}
