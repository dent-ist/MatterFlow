using LptHub.Configuration.Application.TaskTypes;
using LptHub.Identity.Contracts;
using LptHub.SharedKernel.Authorization;
using LptHub.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace LptHub.Configuration.Api;

/// <summary>
/// Task Types (UX S14): lookup for Task screens and admin maintenance. A Task Type is never deleted, only deactivated. Its request form is
/// designed through <c>/api/v1/forms</c> (owner kind TaskType); this API reports where that form stands and which workflows are eligible.
/// Failures surface as problem+json with a stable code.
/// </summary>
[ApiController]
[Route("api/v1/task-types")]
[Produces("application/json")]
public class TaskTypesController(TaskTypeService taskTypes, TaskTypeAccessService access) : ControllerBase
{
    /// <summary>
    /// Lists all Task Types by name, including inactive ones (historical Tasks still display them; pickers use <c>isUsable</c>). With
    /// <c>workflowId</c> only the types for which that workflow is eligible (the Workflows tab links to it). Every type carries <c>openTaskCount</c>
    /// (New, In Progress and On Hold Tasks of the type, the Task Queue definition; null without <c>Task.View</c>). <c>sort</c>: <c>name</c> (default),
    /// <c>-name</c>, <c>openTaskCount</c> or <c>-openTaskCount</c> (equal counts keep the name order); the list is not paged.
    /// </summary>
    [HttpGet(Name = "ListTaskTypes")]
    [Authorize(Policy = ConfigurationPolicies.TaskTypeRead)]
    [ProducesResponseType<IReadOnlyList<TaskTypeView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<TaskTypeView>>> List([FromQuery] int? workflowId, [FromQuery] string? sort, CancellationToken cancellationToken) =>
        Ok((await taskTypes.ListViewsAsync(workflowId, sort, cancellationToken)).OrThrow());

    /// <summary>One Task Type with its form status, eligible workflows and open Task count (null without <c>Task.View</c>).</summary>
    [HttpGet("{id:int}", Name = "GetTaskType")]
    [Authorize(Policy = ConfigurationPolicies.TaskTypeRead)]
    [ProducesResponseType<TaskTypeView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskTypeView>> Get(int id, CancellationToken cancellationToken) =>
        (await taskTypes.GetViewAsync(id, cancellationToken)).OrThrow();

    /// <summary>Creates a Task Type together with its (empty, unpublished) request form.</summary>
    [HttpPost(Name = "CreateTaskType")]
    [Authorize(Policy = ConfigurationPolicies.TaskTypeManage)]
    [ProducesResponseType<TaskTypeView>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<TaskTypeView>> Create([FromBody] CreateTaskTypeRequest request, CancellationToken cancellationToken)
    {
        var created = (await taskTypes.CreateAsync(request, cancellationToken)).OrThrow();
        return Created($"/api/v1/task-types/{created.Id}", created);
    }

    /// <summary>
    /// Renames, activates or deactivates a Task Type and replaces its eligible workflow set and default workflow. 400 <c>NOT_ELIGIBLE</c>
    /// on <c>defaultWorkflowDefinitionId</c> when the default is not among the eligible workflows.
    /// </summary>
    [HttpPut("{id:int}", Name = "UpdateTaskType")]
    [Authorize(Policy = ConfigurationPolicies.TaskTypeManage)]
    [ProducesResponseType<TaskTypeView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskTypeView>> Update(int id, [FromBody] UpdateTaskTypeRequest request, CancellationToken cancellationToken) =>
        (await taskTypes.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>
    /// The role lists of a Task Type (Can View, Can Edit, Can Be Assigned) with the names of the roles in them, whether the go-live switch
    /// <c>Features:TaskTypeAccess</c> enforces them (<c>enforced</c>) and the version to send back. Needs <c>TaskType.Manage</c>.
    /// </summary>
    [HttpGet("{id:int}/access", Name = "GetTaskTypeAccess")]
    [Authorize(Policy = ConfigurationPolicies.TaskTypeManage)]
    [ProducesResponseType<TaskTypeAccessView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskTypeAccessView>> GetAccess(int id, CancellationToken cancellationToken) =>
        (await access.GetAsync(id, cancellationToken)).OrThrow();

    /// <summary>
    /// Replaces the three role lists as a set. Roles in Can Edit or Can Be Assigned are added to Can View when missing; no roles at all opens the type to everyone. 400 on the list field:
    /// <c>ROLE_NOT_FOUND</c> (unknown role, or a deactivated role that is not in a list yet), <c>DUPLICATE_ROLE</c>, <c>INVALID</c>. 409 <c>CONCURRENCY_CONFLICT</c> when the Task Type changed
    /// in the meantime. The lists are stored whether or not the go-live switch is on; the switch decides only whether they are enforced.
    /// </summary>
    [HttpPut("{id:int}/access", Name = "ReplaceTaskTypeAccess")]
    [Authorize(Policy = ConfigurationPolicies.TaskTypeManage)]
    [ProducesResponseType<TaskTypeAccessView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskTypeAccessView>> ReplaceAccess(int id, [FromBody] ReplaceTaskTypeAccessRequest request, CancellationToken cancellationToken) =>
        (await access.ReplaceAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>
    /// What saving the proposed lists would do: how many open tasks become hidden, for how many people, how many of those tasks are assigned to them, and whether the type becomes open
    /// to everyone or the caller loses sight of it. Counts only, over every task of the type. Changes nothing; saving does not require it.
    /// </summary>
    [HttpPost("{id:int}/access/preview", Name = "PreviewTaskTypeAccess")]
    [Authorize(Policy = ConfigurationPolicies.TaskTypeManage)]
    [ProducesResponseType<TaskTypeAccessPreview>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskTypeAccessPreview>> PreviewAccess(int id, [FromBody] PreviewTaskTypeAccessRequest request, CancellationToken cancellationToken) =>
        (await access.PreviewAsync(id, request, cancellationToken)).OrThrow();
}
