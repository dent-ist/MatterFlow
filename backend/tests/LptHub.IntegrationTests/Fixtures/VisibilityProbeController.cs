using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Domain;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>Test-only window onto <see cref="IMatterVisibility"/> (epic #788): what the port lets the caller (or <c>forUser</c>) see. Not part of the API.</summary>
[ApiController]
[Route("api/v1/test/visibility")]
public class VisibilityProbeController(IMatterVisibility visibility, DbContext db) : ControllerBase
{
    [HttpGet]
    [RequirePermission(Permissions.Task.View)]
    public async Task<IActionResult> Probe([FromQuery] int? forUser, [FromQuery] int? matterId, [FromQuery] long? taskId, CancellationToken ct)
    {
        Viewer? viewer = forUser is { } user ? await visibility.ForAsync(user, ct) : null;
        var shown = viewer ?? visibility.Current;
        return Ok(new
        {
            enabled = visibility.Enabled,
            userId = shown.UserId,
            seeAll = shown.SeeAll,
            matters = await visibility.VisibleMatters(viewer).Select(m => m.MatterId).OrderBy(i => i).ToListAsync(ct),
            tasks = await visibility.VisibleTasks(viewer).Select(t => t.TaskId).OrderBy(i => i).ToListAsync(ct),
            tasksOfVisibleMatters = await visibility.WhereMatterVisible(db.Set<WorkTask>().AsNoTracking(), t => t.MatterId, viewer).Select(t => t.Id).OrderBy(i => i).ToListAsync(ct),
            tasksVisible = await visibility.WhereTaskVisible(db.Set<WorkTask>().AsNoTracking(), t => t.Id, viewer).Select(t => t.Id).OrderBy(i => i).ToListAsync(ct),
            canSeeMatter = matterId is { } m ? await visibility.CanSeeMatterAsync(m, ct) : (bool?)null,
            canSeeTask = taskId is { } t2 ? await visibility.CanSeeTaskAsync(t2, ct) : (bool?)null,
        });
    }
}
