using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using MatterFlow.Notifications.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notifications.Application;

/// <summary>The cheap part of the poll: enough to build the ETag without reading any item.</summary>
public sealed record NotificationPollState(int UnreadCount, long LatestId, string ETag);

/// <summary>
/// Reads and marks the caller's own notifications. Every query is scoped to the caller's id from the token (never a user id in the URL) and to
/// the objects the caller may view now. Statement counts do not depend on the number of rows or users.
/// </summary>
public sealed class NotificationService
{
    public const int UnreadCap = 100;
    public const int PollItemLimit = 20;
    private const string FilterAll = "all";
    private const string FilterUnread = "unread";

    private readonly DbContext _db;
    private readonly ICurrentUser _user;
    private readonly IClock _clock;
    private readonly NotificationVisibility _visibility;

    public NotificationService(DbContext db, ICurrentUser user, IClock clock, NotificationVisibility visibility)
    {
        _db = db;
        _user = user;
        _clock = clock;
        _visibility = visibility;
    }

    private IQueryable<Notification> Mine(int userId) =>
        _visibility.Visible(_db.Set<Notification>().AsNoTracking().Where(n => n.RecipientUserId == userId));

    private Error? NoUser() =>
        _user.UserId is null ? Error.Unauthenticated("Sign in to see your notifications.") : null;

    public async Task<Result<NotificationListResponse>> ListAsync(NotificationListQuery query, CancellationToken ct)
    {
        if (NoUser() is { } noUser)
            return noUser;

        var filter = (query.Filter ?? FilterAll).Trim().ToLowerInvariant();
        if (filter is not (FilterAll or FilterUnread))
            return Error.Validation("filter", "INVALID", "filter must be 'all' or 'unread'.");
        var paging = PageRequest.Create(query.Page, query.PageSize);
        if (paging.IsFailure)
            return paging.Error!;

        var userId = _user.UserId!.Value;
        var rows = Mine(userId);
        if (filter == FilterUnread)
            rows = rows.Where(n => n.ReadUtc == null);

        var total = await rows.CountAsync(ct);
        var page = await rows.OrderByDescending(n => n.Id)
            .Skip(paging.Value.Skip).Take(paging.Value.PageSize)
            .ToListAsync(ct);
        return new NotificationListResponse(page.Select(ToItem).ToList(), total, paging.Value.Page, paging.Value.PageSize);
    }

    /// <summary>Unread count (over the newest 100 visible unread rows), latest visible id and the ETag; three cheap statements.</summary>
    public async Task<Result<NotificationPollState>> PollStateAsync(CancellationToken ct)
    {
        if (NoUser() is { } noUser)
            return noUser;

        var userId = _user.UserId!.Value;
        var rows = Mine(userId);
        var latestId = await rows.MaxAsync(n => (long?)n.Id, ct) ?? 0;
        var unread = await rows.Where(n => n.ReadUtc == null).OrderByDescending(n => n.Id).Take(UnreadCap).CountAsync(ct);
        var prefs = await _db.Set<NotificationPreference>().AsNoTracking()
            .Where(p => p.UserId == userId)
            .GroupBy(_ => 1)
            .Select(g => new { Count = g.Count(), Latest = g.Max(p => p.UpdatedUtc) })
            .FirstOrDefaultAsync(ct);

        // The preferences version: the number of stored switches and the time of the latest change.
        var version = prefs is null ? "0" : string.Create(CultureInfo.InvariantCulture, $"{prefs.Count}.{prefs.Latest.Ticks}");
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(string.Create(CultureInfo.InvariantCulture, $"{latestId}|{unread}|{version}")));
        return new NotificationPollState(unread, latestId, "\"" + Convert.ToHexString(hash, 0, 8).ToLowerInvariant() + "\"");
    }

    /// <summary>The visible notifications newer than <paramref name="sinceId"/>, newest first, at most 20.</summary>
    public async Task<Result<NotificationPollResponse>> PollItemsAsync(NotificationPollState state, long sinceId, bool initial, CancellationToken ct)
    {
        if (NoUser() is { } noUser)
            return noUser;
        if (sinceId < 0)
            return Error.Validation("sinceId", "RANGE", "sinceId must be 0 or greater.");

        if (initial || state.LatestId <= sinceId)
            return new NotificationPollResponse(state.UnreadCount, state.LatestId, []);

        var rows = await Mine(_user.UserId!.Value).Where(n => n.Id > sinceId).OrderByDescending(n => n.Id).Take(PollItemLimit).ToListAsync(ct);
        return new NotificationPollResponse(state.UnreadCount, state.LatestId, rows.Select(ToItem).ToList());
    }

    /// <summary>Marks one notification read. Idempotent; 404 for an unknown id, another person's id, or an object the caller may no longer view.</summary>
    public async Task<Result> MarkReadAsync(long id, CancellationToken ct)
    {
        if (NoUser() is { } noUser)
            return noUser;

        var userId = _user.UserId!.Value;
        if (!await Mine(userId).AnyAsync(n => n.Id == id, ct))
            return Error.NotFound("Notification not found.");

        var now = Millis(_clock.UtcNow);
        await _db.Set<Notification>()
            .Where(n => n.Id == id && n.RecipientUserId == userId && n.ReadUtc == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadUtc, n => n.CreatedUtc > now ? n.CreatedUtc : now), ct);
        return Result.Success();
    }

    /// <summary>Marks every visible unread notification of the caller read; the count is of the rows newly marked.</summary>
    public async Task<Result<MarkAllReadResponse>> MarkAllReadAsync(CancellationToken ct)
    {
        if (NoUser() is { } noUser)
            return noUser;

        var userId = _user.UserId!.Value;
        var now = Millis(_clock.UtcNow);
        var marked = await _visibility.Visible(_db.Set<Notification>().Where(n => n.RecipientUserId == userId && n.ReadUtc == null))
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadUtc, n => n.CreatedUtc > now ? n.CreatedUtc : now), ct);
        return new MarkAllReadResponse(marked);
    }

    private static NotificationItem ToItem(Notification n) =>
        new(n.Id, n.EventType, n.ObjectKind, n.ObjectId, n.MatterId, n.Message, Utc(n.CreatedUtc), n.ReadUtc is null ? null : Utc(n.ReadUtc.Value), n.ReadUtc is not null);

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static DateTime Millis(DateTime utc) => new(utc.Ticks - (utc.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);
}
