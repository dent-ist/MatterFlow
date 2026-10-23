using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkManagement.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkManagement.Api;

/// <summary>Changes to many tasks of one matter at once (epic #667, issue #685).</summary>
[ApiController]
[Route("api/v1/matters/{matterId:int}/tasks")]
public class MatterBulkTasksController(TaskBulkService bulk) : ControllerBase
{
    /// <summary>
    /// Re-assigns (<c>reassignTo</c>: a person, a pod or both) and/or re-prioritises (<c>priorityId</c>) up to 100 tasks of this matter. Each task follows the
    /// single-task rules and permissions (<c>Task.Assign</c> for the assignee, <c>Task.SetPriority</c> for the priority; a request that uses a field the
    /// caller may not change is a 403 and changes nothing). Only open tasks (New, In Progress, On Hold) of this matter can change; a closed task is <c>TASK_NOT_EDITABLE</c>; the answer lists every task with
    /// <c>ok</c>, a <c>code</c> and warnings (a person outside the pod is the warning <c>USER_NOT_IN_POD</c>, not an error), plus one <c>correlationId</c> that
    /// groups the audit entries of the batch. No undo: reverse it with another bulk change.
    /// </summary>
    [HttpPost("bulk", Name = "BulkChangeMatterTasks")]
    [Authorize(Policy = "Perm:" + Permissions.Task.Assign + "|" + Permissions.Task.SetPriority)]
    [ProducesResponseType<BulkTasksResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<BulkTasksResponse>> Bulk(int matterId, [FromBody] BulkTasksRequest request, CancellationToken cancellationToken) =>
        (await bulk.ChangeAsync(matterId, request, cancellationToken)).OrThrow();
}
