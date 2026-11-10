using MatterFlow.Identity.Contracts;
using MatterFlow.Notifications.Application;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace MatterFlow.Notifications.Api;

/// <summary>
/// Permission policy for the notification endpoints. There is no notification permission (decision AH-6): the bell belongs to everyone who may
/// view Tasks, and every row is additionally re-checked against the object's own view rule on each read.
/// </summary>
internal static class NotificationPolicies
{
    public const string View = "Perm:" + Permissions.Task.View;
}

/// <summary>
/// The caller's own in-app notifications under <c>/me/notifications</c> (never a user id in the URL). Only notifications for objects the caller may
/// view now are returned or counted; another person's id is a 404.
/// </summary>
[ApiController]
[Route("api/v1/me/notifications")]
[Produces("application/json")]
public class NotificationsController(NotificationService notifications) : ControllerBase
{
    /// <summary>Lists the caller's notifications, newest first. <c>filter</c> is <c>all</c> (default) or <c>unread</c>; paging as everywhere (default 25, max 100).</summary>
    [HttpGet(Name = "ListNotifications")]
    [Authorize(Policy = NotificationPolicies.View)]
    [ProducesResponseType<NotificationListResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<NotificationListResponse>> List([FromQuery] NotificationListQuery query, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, NotificationListQuery.Keys).OrThrow();
        return (await notifications.ListAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>
    /// The 30-second poll: <c>unreadCount</c> (over the newest 100 visible unread rows), <c>latestId</c> and the visible items newer than <c>sinceId</c>
    /// (newest first, at most 20; none for <c>initial=true</c>). The response carries an <c>ETag</c> built from the latest id, the unread count and the
    /// preferences version; <c>If-None-Match</c> with the same value gives 304 without a body. <c>Cache-Control: private, no-cache</c>.
    /// </summary>
    [HttpGet("poll", Name = "PollNotifications")]
    [Authorize(Policy = NotificationPolicies.View)]
    [ProducesResponseType<NotificationPollResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    public async Task<ActionResult<NotificationPollResponse>> Poll([FromQuery] long? sinceId, [FromQuery] bool? initial, CancellationToken cancellationToken)
    {
        FilterParsing.EnsureKnown(Request.Query.Keys, ["sinceId", "initial"]).OrThrow();
        var state = (await notifications.PollStateAsync(cancellationToken)).OrThrow();
        Response.Headers[HeaderNames.CacheControl] = "private, no-cache";
        Response.Headers[HeaderNames.ETag] = state.ETag;
        if (Request.Headers.IfNoneMatch.Any(v => v is not null && v.Split(',', StringSplitOptions.TrimEntries).Contains(state.ETag, StringComparer.Ordinal)))
            return StatusCode(StatusCodes.Status304NotModified);

        return (await notifications.PollItemsAsync(state, sinceId ?? 0, initial ?? false, cancellationToken)).OrThrow();
    }

    /// <summary>Marks one notification read. Idempotent (204 again on a second call); 404 for an unknown id, another person's id or an object the caller may no longer view.</summary>
    [HttpPost("{id:long}/read", Name = "MarkNotificationRead")]
    [Authorize(Policy = NotificationPolicies.View)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> MarkRead(long id, CancellationToken cancellationToken)
    {
        (await notifications.MarkReadAsync(id, cancellationToken)).OrThrow();
        return NoContent();
    }

    /// <summary>Marks every visible unread notification of the caller read. Idempotent; returns how many were newly marked.</summary>
    [HttpPost("read-all", Name = "MarkAllNotificationsRead")]
    [Authorize(Policy = NotificationPolicies.View)]
    [ProducesResponseType<MarkAllReadResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<MarkAllReadResponse>> MarkAllRead(CancellationToken cancellationToken) =>
        (await notifications.MarkAllReadAsync(cancellationToken)).OrThrow();
}

/// <summary>
/// The caller's notification switches (My profile). One per event type, all on by default; a switch is applied when a notification is created
/// (off stops future items, on does not backfill).
/// </summary>
[ApiController]
[Route("api/v1/me/notification-preferences")]
[Produces("application/json")]
public class NotificationPreferencesController(NotificationPreferenceService preferences) : ControllerBase
{
    /// <summary>The caller's switches, one entry per event type in display order.</summary>
    [HttpGet(Name = "GetNotificationPreferences")]
    [Authorize(Policy = NotificationPolicies.View)]
    [ProducesResponseType<NotificationPreferencesResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<NotificationPreferencesResponse>> Get(CancellationToken cancellationToken) =>
        (await preferences.GetAsync(cancellationToken)).OrThrow();

    /// <summary>Sets switches (the full list; types left out keep their value). An unknown or duplicate event type is a 400. Returns the resulting switches.</summary>
    [HttpPut(Name = "UpdateNotificationPreferences")]
    [Authorize(Policy = NotificationPolicies.View)]
    [ProducesResponseType<NotificationPreferencesResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<NotificationPreferencesResponse>> Update([FromBody] UpdateNotificationPreferencesRequest request, CancellationToken cancellationToken) =>
        (await preferences.UpdateAsync(request, cancellationToken)).OrThrow();
}
