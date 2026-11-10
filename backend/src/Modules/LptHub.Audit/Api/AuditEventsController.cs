using System.ComponentModel.DataAnnotations;
using MatterFlow.Audit.Application;
using MatterFlow.Audit.Domain;
using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Audit.Api;

/// <summary>Permission-scoped read access to the audit trail. Requires the <c>Audit.View</c> policy.</summary>
[ApiController]
[Route("api/v1/audit")]
[Authorize(Policy = PolicyNames.AuditView)]
public class AuditEventsController(DbContext db, AuditVisibility visibility) : ControllerBase
{
    private const int DefaultPageSize = 50;
    private const int MaxPageSize = 100;

    /// <summary>Lists the audit events of one object in chronological order (keyset paging by <c>afterId</c>).</summary>
    /// <param name="objectType">Object type, e.g. <c>Task</c>.</param>
    /// <param name="objectId">Object id (string form).</param>
    /// <param name="afterId">Return only events with an id greater than this (the <c>nextAfterId</c> of the previous page).</param>
    /// <param name="pageSize">Items per page (default 50, max 100).</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("events", Name = "ListAuditEvents")]
    [ProducesResponseType<AuditEventPage>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<AuditEventPage>> List(
        [FromQuery, Required, StringLength(40, MinimumLength = 1)] string objectType,
        [FromQuery, Required, StringLength(40, MinimumLength = 1)] string objectId,
        [FromQuery, Range(0, long.MaxValue)] long? afterId,
        [FromQuery, Range(1, MaxPageSize)] int pageSize = DefaultPageSize,
        CancellationToken cancellationToken = default)
    {
        var after = afterId ?? 0;
        var rows = await visibility.Apply(db.Set<AuditEvent>().AsNoTracking())
            .Where(e => e.ObjectType == objectType && e.ObjectId == objectId && e.Id > after)
            .OrderBy(e => e.Id)
            .Take(pageSize + 1)
            .ToListAsync(cancellationToken);

        var hasMore = rows.Count > pageSize;
        var items = rows.Take(pageSize).Select(AuditEventDto.From).ToList();
        return new AuditEventPage(items, hasMore ? items[^1].AuditEventId : null);
    }
}

/// <summary>A page of audit events.</summary>
/// <param name="Items">Events in chronological order.</param>
/// <param name="NextAfterId">Pass as <c>afterId</c> to fetch the next page; null on the last page.</param>
public sealed record AuditEventPage(IReadOnlyList<AuditEventDto> Items, long? NextAfterId);

/// <summary>One audit event. Old/new values are truncated to 4000 characters for display; the flags say when that happened.</summary>
public sealed record AuditEventDto(
    long AuditEventId,
    DateTime OccurredAtUtc,
    int? ActorUserId,
    string EventType,
    string ObjectType,
    string ObjectId,
    int? MatterId,
    long? TaskId,
    string? FieldKey,
    string? OldValue,
    string? NewValue,
    bool OldValueTruncated,
    bool NewValueTruncated,
    string? Summary,
    Guid CorrelationId)
{
    internal static AuditEventDto From(AuditEvent e)
    {
        var sensitive = AuditValueGuard.IsSensitiveKey(e.FieldKey);
        var oldValue = AuditValueGuard.Guard(e.OldValue, sensitive, out var oldTruncated, out _);
        var newValue = AuditValueGuard.Guard(e.NewValue, sensitive, out var newTruncated, out _);
        return new AuditEventDto(
            e.Id,
            DateTime.SpecifyKind(e.OccurredAtUtc, DateTimeKind.Utc),
            e.ActorUserId,
            e.EventType,
            e.ObjectType,
            e.ObjectId,
            e.MatterId,
            e.TaskId,
            e.FieldKey,
            oldValue,
            newValue,
            oldTruncated,
            newTruncated,
            AuditValueGuard.LooksLikeSecret(e.Summary) ? null : e.Summary,
            e.CorrelationId);
    }
}
