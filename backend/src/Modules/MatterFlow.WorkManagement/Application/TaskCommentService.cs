using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Text;
using MatterFlow.SharedKernel.Time;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

/// <summary>
/// Task comments (ticket 43): basic rich text sanitized on the server, allowed in every Task status (also closed Tasks and inactive Matters),
/// authors edit and soft-delete their own, every edit keeps the earlier body in <c>TaskCommentRevision</c>, and the Cancel / On Hold reasons
/// can never be deleted. Writes are audited (COMMENT_ADDED, COMMENT_EDITED, COMMENT_DELETED) in the same transaction.
/// </summary>
public sealed class TaskCommentService(
    DbContext db,
    TaskTransactions tx,
    IAuditWriter audit,
    IPermissionChecker permissions,
    ICurrentUser currentUser,
    IClock clock,
    IUserDirectory users,
    TaskNotifier notifier)
{
    /// <summary>Stable validation code for comment markup beyond the structural caps (SEC2-01).</summary>
    public const string TooComplexCode = "TOO_COMPLEX";

    /// <summary>Most comments returned by one list call (SEC2-10); page with skip/take for more.</summary>
    public const int MaxPageSize = 200;

    /// <summary>Most comments (deleted ones included) one Task can hold.</summary>
    public const int MaxCommentsPerTask = 2000;

    /// <summary>Most edits one comment accepts; every edit keeps a full earlier body.</summary>
    public const int MaxEditsPerComment = 50;

    public const string CommentLimitCode = "COMMENT_LIMIT"; // 409

    public async Task<Result<TaskCommentListResponse>> ListAsync(long taskId, bool newestFirst, int? skip, int? take, CancellationToken ct)
    {
        if (skip is < 0)
            return Error.Validation("skip", "RANGE", "skip must be 0 or more.");
        if (take is < 1 or > MaxPageSize)
            return Error.Validation("take", "RANGE", $"take must be between 1 and {MaxPageSize}.");

        if (!await db.Set<WorkTask>().AnyAsync(t => t.Id == taskId, ct))
            return TaskSupport.NotFound();

        var query = db.Set<TaskComment>().AsNoTracking().Where(c => c.TaskId == taskId && !c.IsDeleted);
        var total = await query.CountAsync(ct);
        var ordered = newestFirst
            ? query.OrderByDescending(c => c.CreatedAtUtc).ThenByDescending(c => c.Id)
            : query.OrderBy(c => c.CreatedAtUtc).ThenBy(c => c.Id);
        var rows = await ordered.Skip(skip ?? 0).Take(take ?? MaxPageSize).ToListAsync(ct);
        var authors = await users.FindManyAsync([.. rows.Select(r => r.AuthorUserId).Distinct()], ct);
        return new TaskCommentListResponse([.. rows.Select(r => ToResponse(r, authors))], total);
    }

    public async Task<Result<TaskCommentRevisionListResponse>> ListRevisionsAsync(long taskId, long commentId, CancellationToken ct)
    {
        var comment = await FindVisibleAsync(taskId, commentId, ct);
        if (comment is null)
            return CommentNotFound();

        var rows = await db.Set<TaskCommentRevision>().AsNoTracking()
            .Where(r => r.TaskCommentId == commentId)
            .OrderBy(r => r.RevisedAtUtc).ThenBy(r => r.Id)
            .ToListAsync(ct);
        var people = await users.FindManyAsync([.. rows.Select(r => r.RevisedByUserId).OfType<int>().Distinct()], ct);
        return new TaskCommentRevisionListResponse(
            [.. rows.Select(r => new TaskCommentRevisionResponse(r.Id, r.BodyHtml, r.Reason, TaskSupport.Utc(r.RevisedAtUtc), r.RevisedByUserId is { } id ? Ref(id, people) : null))]);
    }

    public async Task<Result<TaskCommentResponse>> AddAsync(long taskId, AddTaskCommentRequest request, CancellationToken ct)
    {
        var allowed = permissions.Require(Permissions.Task.Comment);
        if (allowed.IsFailure)
            return Result<TaskCommentResponse>.Failure(allowed.Error!);
        if (currentUser.UserId is not { } authorId)
            return Error.Unauthenticated("A signed-in user is required to comment.");

        var body = CleanBody(request.BodyHtml);
        if (body.IsFailure)
            return Result<TaskCommentResponse>.Failure(body.Error!);

        var created = await tx.RunAsync<long>(
            async token =>
            {
                var task = await db.Set<WorkTask>().AsNoTracking().SingleOrDefaultAsync(t => t.Id == taskId, token);
                if (task is null)
                    return TaskSupport.NotFound();

                if (await db.Set<TaskComment>().CountAsync(c => c.TaskId == taskId, token) >= MaxCommentsPerTask)
                    return Error.Conflict(CommentLimitCode, $"A task can have at most {MaxCommentsPerTask} comments.");

                var comment = new TaskComment { TaskId = taskId, AuthorUserId = authorId, Purpose = TaskCommentPurpose.Normal, BodyHtml = body.Value };
                db.Set<TaskComment>().Add(comment);
                await db.SaveChangesAsync(token);
                TaskAudit.CommentAdded(audit, task, comment);
                await notifier.CommentAddedAsync(task, comment, token); // event 3: same transaction as the comment
                await db.SaveChangesAsync(token);
                return comment.Id;
            },
            ct);
        return created.IsFailure ? Result<TaskCommentResponse>.Failure(created.Error!) : await GetAsync(created.Value, ct);
    }

    public async Task<Result<TaskCommentResponse>> EditAsync(long taskId, long commentId, EditTaskCommentRequest request, CancellationToken ct)
    {
        var allowed = permissions.Require(Permissions.Task.Comment);
        if (allowed.IsFailure)
            return Result<TaskCommentResponse>.Failure(allowed.Error!);

        var body = CleanBody(request.BodyHtml);
        if (body.IsFailure)
            return Result<TaskCommentResponse>.Failure(body.Error!);

        var done = await tx.RunAsync<long>(
            async token =>
            {
                var task = await db.Set<WorkTask>().AsNoTracking().SingleOrDefaultAsync(t => t.Id == taskId, token);
                var comment = task is null ? null : await db.Set<TaskComment>().SingleOrDefaultAsync(c => c.Id == commentId && c.TaskId == taskId && !c.IsDeleted, token);
                if (task is null || comment is null)
                    return CommentNotFound();
                if (comment.AuthorUserId != currentUser.UserId)
                    return Error.Forbidden("You can only edit your own comments.");
                if (!comment.Purpose.IsDeletable())
                    return Error.Conflict(TaskSupport.CommentNotEditableCode, "The reason given for cancelling or putting a task on hold is part of the record and can't be edited.");

                var version = CheckVersion(comment.RowVersion, request.RowVersion);
                if (version.IsFailure)
                    return Result<long>.Failure(version.Error!);

                if (string.Equals(comment.BodyHtml, body.Value, StringComparison.Ordinal))
                    return comment.Id;

                if (await db.Set<TaskCommentRevision>().CountAsync(r => r.TaskCommentId == comment.Id, token) >= MaxEditsPerComment)
                    return Error.Conflict(CommentLimitCode, $"A comment can be edited at most {MaxEditsPerComment} times.");

                var now = clock.UtcNow;
                db.Set<TaskCommentRevision>().Add(new TaskCommentRevision
                {
                    TaskCommentId = comment.Id,
                    BodyHtml = comment.BodyHtml,
                    Reason = CommentRevisionReasons.Edit,
                    RevisedAtUtc = now,
                    RevisedByUserId = currentUser.UserId,
                });
                comment.BodyHtml = body.Value;
                comment.EditedAtUtc = now;
                TaskSupport.TrackOriginalRowVersion(db, comment, request.RowVersion);
                TaskAudit.CommentEdited(audit, task, comment);
                await db.SaveChangesAsync(token);
                return comment.Id;
            },
            ct);
        return done.IsFailure ? Result<TaskCommentResponse>.Failure(done.Error!) : await GetAsync(done.Value, ct);
    }

    public async Task<Result> DeleteAsync(long taskId, long commentId, CancellationToken ct)
    {
        var allowed = permissions.Require(Permissions.Task.Comment);
        if (allowed.IsFailure)
            return allowed;

        var done = await tx.RunAsync<bool>(
            async token =>
            {
                var task = await db.Set<WorkTask>().AsNoTracking().SingleOrDefaultAsync(t => t.Id == taskId, token);
                var comment = task is null ? null : await db.Set<TaskComment>().SingleOrDefaultAsync(c => c.Id == commentId && c.TaskId == taskId && !c.IsDeleted, token);
                if (task is null || comment is null)
                    return CommentNotFound();
                if (comment.AuthorUserId != currentUser.UserId)
                    return Error.Forbidden("You can only delete your own comments.");
                if (!comment.Purpose.IsDeletable())
                    return Error.Conflict(TaskSupport.CommentNotDeletableCode, "The reason given for cancelling or putting a task on hold is part of the record and can't be deleted.");

                var now = clock.UtcNow;
                db.Set<TaskCommentRevision>().Add(new TaskCommentRevision
                {
                    TaskCommentId = comment.Id,
                    BodyHtml = comment.BodyHtml,
                    Reason = CommentRevisionReasons.Delete,
                    RevisedAtUtc = now,
                    RevisedByUserId = currentUser.UserId,
                });
                comment.IsDeleted = true;
                comment.DeletedAtUtc = now;
                comment.DeletedByUserId = currentUser.UserId;
                TaskAudit.CommentDeleted(audit, task, comment);
                await db.SaveChangesAsync(token);
                return true;
            },
            ct);
        return done.IsFailure ? Result.Failure(done.Error!) : Result.Success();
    }

    private async Task<Result<TaskCommentResponse>> GetAsync(long commentId, CancellationToken ct)
    {
        var row = await db.Set<TaskComment>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == commentId, ct);
        if (row is null)
            return CommentNotFound();

        return ToResponse(row, await users.FindManyAsync([row.AuthorUserId], ct));
    }

    private Task<TaskComment?> FindVisibleAsync(long taskId, long commentId, CancellationToken ct) =>
        db.Set<TaskComment>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == commentId && c.TaskId == taskId && !c.IsDeleted, ct);

    private TaskCommentResponse ToResponse(TaskComment c, IReadOnlyDictionary<int, UserInfo> authors)
    {
        var own = currentUser.UserId == c.AuthorUserId && permissions.Has(Permissions.Task.Comment);
        return new TaskCommentResponse(
            c.Id,
            c.TaskId,
            c.Purpose.ToCode(),
            CommentLabels.PurposeLabel(c.Purpose),
            c.BodyHtml,
            Ref(c.AuthorUserId, authors),
            TaskSupport.Utc(c.CreatedAtUtc),
            TaskSupport.Utc(c.EditedAtUtc),
            c.EditedAtUtc is not null,
            own && c.Purpose.IsDeletable(),
            own && c.Purpose.IsDeletable(),
            TaskSupport.Encode(c.RowVersion));
    }

    private static TaskUserRef Ref(int userId, IReadOnlyDictionary<int, UserInfo> map) =>
        map.TryGetValue(userId, out var u) ? new TaskUserRef(u.UserId, u.DisplayName, u.IsActive) : new TaskUserRef(userId, "Unknown user", false);

    private static Error CommentNotFound() => Error.NotFound("Comment not found.");

    private static Result CheckVersion(byte[] current, string supplied)
    {
        var checkedVersion = TaskSupport.CheckRowVersion(current, supplied);
        return checkedVersion.IsFailure
            ? checkedVersion.Error!.Code == ErrorCodes.ConcurrencyConflict
                ? Error.Conflict(ErrorCodes.ConcurrencyConflict, "The comment was changed by someone else. Reload and try again.", checkedVersion.Error.Meta)
                : checkedVersion
            : Result.Success();
    }

    /// <summary>Sanitizes the body and applies the rules: not empty after sanitizing, at most 20000 characters before and after.</summary>
    internal static Result<string> CleanBody(string? html)
    {
        if (html is { Length: > CommentHtml.MaxLength })
            return Error.Validation("bodyHtml", "TOO_LONG", $"A comment can have at most {CommentHtml.MaxLength} characters.");

        var problem = RichHtml.TrySanitize(html, RichHtmlLimits.Comment, out var clean);
        switch (problem)
        {
            case RichHtmlProblem.TooComplex or RichHtmlProblem.Unstable:
                return Error.Validation("bodyHtml", TooComplexCode, "The comment has too many tags or is nested too deeply. Simplify the formatting and try again.");
            case RichHtmlProblem.TooManyCells:
                return Error.Validation("bodyHtml", "TABLE_TOO_LARGE", $"A table can have at most {RichHtmlLimits.Comment.MaxTableCells} cells.");
            case RichHtmlProblem.TooLarge:
                return Error.Validation("bodyHtml", "TOO_LONG", $"A comment can have at most {CommentHtml.MaxLength} characters.");
        }

        if (clean.Length == 0)
            return Error.Validation("bodyHtml", "REQUIRED", "Write a comment before posting.");

        return clean;
    }
}
