using MatterFlow.Identity.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkViews.Api;

/// <summary>
/// My Matters, the landing page of project managers (epic #667): what needs attention across the matters a person manages. Everything here is a
/// default view, not access control: nothing restricts who may look at a matter's tasks. Needs <c>Task.View</c> and <c>Matter.BeManager</c> or
/// <c>Matter.AssignManagers</c>; <c>scope=all</c> and <c>managerId</c> need <c>Matter.AssignManagers</c> (403). Common parameters: <c>scope</c>
/// (<c>mine</c> default, <c>all</c>), <c>role</c> (<c>both</c>, <c>primary</c>, <c>secondary</c>), <c>clientId</c>, <c>from</c>/<c>to</c> (a due-date
/// range) and, with <c>scope=all</c>, <c>managerId</c>. A matter with no manager is normal: it is in nobody's "mine" scope and never an item or a flag.
/// Overdue and "due in N days" are decided in the viewer's time zone (<c>X-Time-Zone</c>), exactly as in My Work.
/// </summary>
[ApiController]
[Route("api/v1/my-matters")]
[Authorize(Policy = "Perm:" + Permissions.Task.View)]
[Authorize(Policy = "Perm:" + Permissions.Matter.BeManager + "|" + Permissions.Matter.AssignManagers)]
[MatterFlow.SharedKernel.Visibility.PreparesViewer(Stamp = true)]
public partial class MyMattersController : ControllerBase
{
}
