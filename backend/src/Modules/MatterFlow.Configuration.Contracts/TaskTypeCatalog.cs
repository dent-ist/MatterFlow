namespace MatterFlow.Configuration.Contracts;

/// <summary>A Task Type as the Tasks module needs it to create a Task.</summary>
/// <param name="Id">Task Type id (Task.TaskTypeId references it; immutable on a Task).</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IsActive">Inactive types stay on historical Tasks but are not offered for new Tasks.</param>
/// <param name="FormDefinitionId">The request form's definition, or null when it has not been provisioned.</param>
/// <param name="PublishedFormVersionId">The request form's current PUBLISHED version (what a new Task pins), or null when none is published.</param>
/// <param name="HasFormFields">True when any version of the request form has at least one field (a type with no fields needs no published form).</param>
/// <param name="EligibleWorkflowIds">Workflow definition ids a new Task of this type may choose from, ascending.</param>
/// <param name="DefaultWorkflowDefinitionId">The workflow pre-selected for new Tasks; always one of <paramref name="EligibleWorkflowIds"/>.</param>
/// <param name="IsUsable">
/// True when the type may be used for new Tasks: it is active, its request form is published (or it has no fields) and it has at least one
/// eligible workflow. Whether an eligible workflow has a published version is checked by the Tasks module when a workflow is chosen.
/// </param>
public sealed record TaskTypeInfo(
    int Id,
    string Name,
    string? Description,
    bool IsActive,
    int? FormDefinitionId,
    int? PublishedFormVersionId,
    bool HasFormFields,
    IReadOnlyList<int> EligibleWorkflowIds,
    int? DefaultWorkflowDefinitionId,
    bool IsUsable);

/// <summary>Read access to Task Types for other modules (Task creation, queue filters).</summary>
public interface ITaskTypeCatalog
{
    /// <summary>The Task Types usable for new Tasks (see <see cref="TaskTypeInfo.IsUsable"/>), ordered by name.</summary>
    Task<IReadOnlyList<TaskTypeInfo>> ListUsableAsync(CancellationToken cancellationToken = default);

    /// <summary>Every Task Type ordered by name, for filters and display of historical Tasks.</summary>
    Task<IReadOnlyList<TaskTypeInfo>> ListAsync(bool includeInactive, CancellationToken cancellationToken = default);

    /// <summary>One Task Type (usable or not) with its published form version and eligible workflows, or null when it does not exist.</summary>
    Task<TaskTypeInfo?> GetAsync(int taskTypeId, CancellationToken cancellationToken = default);
}
