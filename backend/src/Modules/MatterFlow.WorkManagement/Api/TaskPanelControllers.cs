using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkManagement.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkManagement.Api;

/// <summary>Permission policies of the comment, asset-link and activity endpoints.</summary>
internal static class TaskPanelPolicies
{
    private const string Prefix = "Perm:";

    public const string Comment = Prefix + Permissions.Task.Comment;
    public const string AssetLink = Prefix + Permissions.Asset.Link;
}

/// <summary>
/// Task comments: internal notes in basic rich text (bold, italic, underline, lists, links), sanitized on the server. Reading needs Task.View, writing
/// needs Task.Comment, and both work in every Task status. Authors edit and delete their own comments (soft delete: hidden, kept in the database);
/// the Cancel and On Hold reasons cannot be deleted (409 COMMENT_NOT_DELETABLE).
/// </summary>
[ApiController]
[Route("api/v1/tasks/{taskId:long}/comments")]
public class TaskCommentsController(TaskCommentService comments) : ControllerBase
{
    /// <summary>The comments of the Task, oldest first (<c>newestFirst=true</c> reverses), without deleted ones.</summary>
    [HttpGet(Name = "ListTaskComments")]
    [Authorize(Policy = TaskPolicies.View)]
    [ProducesResponseType<TaskCommentListResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskCommentListResponse>> List(long taskId, [FromQuery] bool newestFirst, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, ["newestFirst"]).OrThrow();
        return (await comments.ListAsync(taskId, newestFirst, cancellationToken)).OrThrow();
    }

    /// <summary>Posts a comment. The HTML is sanitized (400 REQUIRED when nothing is left, 400 TOO_LONG above 20000 characters).</summary>
    [HttpPost(Name = "AddTaskComment")]
    [Authorize(Policy = TaskPanelPolicies.Comment)]
    [ProducesResponseType<TaskCommentResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<TaskCommentResponse>> Add(long taskId, [FromBody] AddTaskCommentRequest request, CancellationToken cancellationToken)
    {
        var comment = (await comments.AddAsync(taskId, request, cancellationToken)).OrThrow();
        return CreatedAtRoute("ListTaskComments", new { taskId }, comment);
    }

    /// <summary>Edits one's own comment (403 for someone else's). The earlier body is kept in the edit history.</summary>
    [HttpPut("{commentId:long}", Name = "EditTaskComment")]
    [Authorize(Policy = TaskPanelPolicies.Comment)]
    [ProducesResponseType<TaskCommentResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskCommentResponse>> Edit(long taskId, long commentId, [FromBody] EditTaskCommentRequest request, CancellationToken cancellationToken) =>
        (await comments.EditAsync(taskId, commentId, request, cancellationToken)).OrThrow();

    /// <summary>Soft-deletes one's own comment: it disappears from the thread but stays in the database. 409 COMMENT_NOT_DELETABLE for a Cancel or On Hold reason.</summary>
    [HttpDelete("{commentId:long}", Name = "DeleteTaskComment")]
    [Authorize(Policy = TaskPanelPolicies.Comment)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(long taskId, long commentId, CancellationToken cancellationToken)
    {
        (await comments.DeleteAsync(taskId, commentId, cancellationToken)).OrThrow();
        return NoContent();
    }

    /// <summary>The earlier versions of a comment (before each edit), oldest first.</summary>
    [HttpGet("{commentId:long}/revisions", Name = "ListTaskCommentRevisions")]
    [Authorize(Policy = TaskPolicies.View)]
    [ProducesResponseType<TaskCommentRevisionListResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskCommentRevisionListResponse>> Revisions(long taskId, long commentId, CancellationToken cancellationToken) =>
        (await comments.ListRevisionsAsync(taskId, commentId, cancellationToken)).OrThrow();
}

/// <summary>
/// Assets linked to a Task, each with an optional relationship (Source, Destination, Subject, Result, ...). Reading needs Task.View; linking, changing
/// the relationship and unlinking need Asset.Link and Task.Edit and work only while the Task is New, In Progress or On Hold (409 TASK_NOT_EDITABLE).
/// </summary>
[ApiController]
[Route("api/v1/tasks/{taskId:long}/assets")]
public class TaskAssetsController(TaskAssetService links) : ControllerBase
{
    /// <summary>The linked Assets, newest link first, and whether the caller can change links now.</summary>
    [HttpGet(Name = "ListTaskAssets")]
    [Authorize(Policy = TaskPolicies.View)]
    [ProducesResponseType<TaskAssetLinkListResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskAssetLinkListResponse>> List(long taskId, CancellationToken cancellationToken) =>
        (await links.ListAsync(taskId, cancellationToken)).OrThrow();

    /// <summary>
    /// Links an Asset of the Task's Matter. 409 CROSS_MATTER_REFERENCE for another Matter's Asset, 409 ASSET_ALREADY_LINKED for a duplicate,
    /// 409 ASSET_INACTIVE for an inactive Asset.
    /// </summary>
    [HttpPost(Name = "LinkTaskAsset")]
    [Authorize(Policy = TaskPanelPolicies.AssetLink)]
    [ProducesResponseType<TaskAssetLinkResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<TaskAssetLinkResponse>> Link(long taskId, [FromBody] LinkTaskAssetRequest request, CancellationToken cancellationToken)
    {
        var link = (await links.LinkAsync(taskId, request, cancellationToken)).OrThrow();
        return CreatedAtRoute("ListTaskAssets", new { taskId }, link);
    }

    /// <summary>Changes or clears the relationship of a link.</summary>
    [HttpPut("{assetId:int}", Name = "ChangeTaskAssetRole")]
    [Authorize(Policy = TaskPanelPolicies.AssetLink)]
    [ProducesResponseType<TaskAssetLinkResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskAssetLinkResponse>> ChangeRole(long taskId, int assetId, [FromBody] ChangeTaskAssetRoleRequest request, CancellationToken cancellationToken) =>
        (await links.ChangeRoleAsync(taskId, assetId, request, cancellationToken)).OrThrow();

    /// <summary>Removes the link (the Asset itself is untouched).</summary>
    [HttpDelete("{assetId:int}", Name = "UnlinkTaskAsset")]
    [Authorize(Policy = TaskPanelPolicies.AssetLink)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Unlink(long taskId, int assetId, CancellationToken cancellationToken)
    {
        (await links.UnlinkAsync(taskId, assetId, cancellationToken)).OrThrow();
        return NoContent();
    }
}

/// <summary>The Task activity timeline, built from the audit trail.</summary>
[ApiController]
[Route("api/v1/tasks/{taskId:long}/activity")]
public class TaskActivityController(TaskActivityService activity) : ControllerBase
{
    /// <summary>
    /// Newest-first timeline of what happened to the Task, its comments, steps and asset links: actor, UTC time, event type, category and a readable
    /// sentence. Old and new values are included only with Audit.View. Page with <c>cursor</c> (the previous <c>nextCursor</c>) and <c>pageSize</c> (default 25, max 100).
    /// </summary>
    [HttpGet(Name = "GetTaskActivity")]
    [Authorize(Policy = TaskPolicies.View)]
    [ProducesResponseType<TaskActivityPage>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<TaskActivityPage>> Get(long taskId, [FromQuery] string? cursor, [FromQuery] int? pageSize, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, ["cursor", "pageSize"]).OrThrow();
        return (await activity.ListAsync(taskId, cursor, pageSize, cancellationToken)).OrThrow();
    }
}
