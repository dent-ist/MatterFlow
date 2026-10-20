using MatterFlow.Configuration.Application.TaskTypes;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Authorization;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Configuration.Api;

/// <summary>
/// Task Types (UX S14): lookup for Task screens and admin maintenance. A Task Type is never deleted, only deactivated. Its request form is
/// designed through <c>/api/v1/forms</c> (owner kind TaskType); this API reports where that form stands and which workflows are eligible.
/// Failures surface as problem+json with a stable code.
/// </summary>
[ApiController]
[Route("api/v1/task-types")]
[Produces("application/json")]
public class TaskTypesController(TaskTypeService taskTypes) : ControllerBase
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
}
