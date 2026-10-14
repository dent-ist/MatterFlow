using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;

namespace MatterFlow.Configuration.Domain;

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

    /// <summary>One of the eligible workflow definitions, pre-selected for new Tasks. No foreign key until the workflow tables exist.</summary>
    public int? DefaultWorkflowDefinitionId { get; set; }

    public List<TaskTypeWorkflowEligibility> EligibleWorkflows { get; set; } = [];
}

/// <summary>A Workflow definition a Task Type may use for new Tasks. Changes are written as explicit TASK_TYPE_WORKFLOWS_CHANGED events.</summary>
public class TaskTypeWorkflowEligibility
{
    public int TaskTypeId { get; set; }

    /// <summary>Workflow definition id (plain value: the workflow tables arrive in a later script, which adds the foreign key).</summary>
    public int WorkflowDefinitionId { get; set; }

    public int? CreatedByUserId { get; set; }
}
