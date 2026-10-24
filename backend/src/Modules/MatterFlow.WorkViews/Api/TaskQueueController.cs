using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkViews.Application.Queries;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

/// <summary>
/// The shared Task Queue: every Task for anyone with Task.View (Phase 1 has no per-record visibility; addendum E). Filters are flat query
/// parameters (see <see cref="TaskQueueQuery"/>), unknown ones are a 400. Overdue is evaluated in the requester's time zone
/// (<c>X-Time-Zone</c>, addendum M). The default order is priority, then ASAP above explicit due dates, then due date ascending, then oldest first.
/// </summary>
[ApiController]
[Route("api/v1/task-queue")]
[MatterFlow.SharedKernel.Visibility.PreparesViewer]
public class TaskQueueController(TaskQueueService queue) : ControllerBase
{
    /// <summary>Lists Tasks with server-side filtering, sorting and paging (offset paging: page, pageSize, total).</summary>
    [HttpGet(Name = "GetTaskQueue")]
    [Authorize(Policy = "Perm:" + Permissions.Task.View)]
    [ProducesResponseType<TaskQueuePage>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskQueuePage>> Get([FromQuery] TaskQueueListQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, TaskQueueListQuery.ListKeys).OrThrow();
        return (await queue.QueueAsync(query, cancellationToken)).OrThrow();
    }
}

/// <summary>
/// My Work: Tasks assigned to the signed-in user across all their Pods, in four tabs (<c>view</c>): <c>active</c> (New, In Progress, On Hold),
/// <c>dueSoon</c> (explicit due date within 2 days or overdue; ASAP excluded), <c>completed</c> (Completed and Cancelled, newest first) and
/// <c>createdByMe</c> (any status, any assignee). Accepts the Task Queue filters; counts of all tabs come back with every page.
/// </summary>
[ApiController]
[Route("api/v1/my-work")]
[MatterFlow.SharedKernel.Visibility.PreparesViewer]
public class MyWorkController(TaskQueueService queue) : ControllerBase
{
    /// <summary>Gets one tab of My Work with the counts of every tab.</summary>
    [HttpGet(Name = "GetMyWork")]
    [Authorize(Policy = "Perm:" + Permissions.Task.View)]
    [ProducesResponseType<MyWorkPage>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MyWorkPage>> Get([FromQuery] MyWorkQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, MyWorkQuery.MyWorkKeys).OrThrow();
        return (await queue.MyWorkAsync(query, cancellationToken)).OrThrow();
    }
}

/// <summary>
/// Pod Work: the open Tasks of one Pod, a filtered view and not a security boundary (everyone with Task.View sees all Tasks). Tabs (<c>view</c>):
/// <c>queue</c> (assigned to the Pod but to no person), <c>members</c> (assigned to a person), <c>attention</c> (overdue or on hold) and <c>all</c>.
/// The Pod defaults to the user's primary Pod. Accepts the Task Queue filters except <c>pod</c>.
/// </summary>
[ApiController]
[Route("api/v1/pod-work")]
[MatterFlow.SharedKernel.Visibility.PreparesViewer]
public class PodWorkController(TaskQueueService queue) : ControllerBase
{
    /// <summary>Gets one tab of Pod Work with the Pod summary, the selectable Pods and the workload per person.</summary>
    [HttpGet(Name = "GetPodWork")]
    [Authorize(Policy = "Perm:" + Permissions.Task.View)]
    [Authorize(Policy = "Perm:" + Permissions.Pod.View)]
    [ProducesResponseType<PodWorkPage>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<PodWorkPage>> Get([FromQuery] PodWorkQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, PodWorkQuery.PodWorkKeys).OrThrow();
        return (await queue.PodWorkAsync(query, cancellationToken)).OrThrow();
    }
}
