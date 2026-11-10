using System.ComponentModel.DataAnnotations;
using LptHub.Configuration.Domain;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Tasks;
using LptHub.SharedKernel.Time;
using LptHub.SharedKernel.Visibility;
using LptHub.WorkManagement.Domain;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LptHub.WorkViews.Application.Queries;

/// <summary>Request of the person history (Dashboard Users drawer, issue #1092).</summary>
public class UserHistoryQuery
{
    public static readonly IReadOnlyList<string> Keys = ["months", "podScope"];

    /// <summary>The window of the per task type figures, in months back from now: <c>3</c> or <c>12</c> (default). Anything else is 400 <c>UNKNOWN_WINDOW</c>. The month series always covers the last 12 months.</summary>
    [FromQuery(Name = "months")]
    public int? Months { get; init; }

    /// <summary>The page-wide scope: <c>all</c> (default), <c>mine</c> or a Pod id. With a Pod scope the person must be a member of a Pod of the scope, otherwise 404 (the same as an unknown person). The figures themselves are never narrowed by Pod.</summary>
    [FromQuery(Name = "podScope"), StringLength(20)]
    public string? PodScope { get; init; }
}

/// <summary>One task type the person completed Tasks of in the window.</summary>
/// <param name="Completed">Tasks of the type the person completed in the window (Cancelled never counts), over the Tasks the caller may see.</param>
/// <param name="SampleSize">How many of them have a known start and so a duration; the median needs <c>MinSampleSize</c> of them.</param>
/// <param name="MedianMinutes">The person's median duration (Started to Completed) in <c>DurationUnit</c>; null while <c>SampleSize</c> is below <c>MinSampleSize</c>.</param>
/// <param name="FirmSampleSize">The same sample size over everybody's completed Tasks of the type in the same window.</param>
/// <param name="FirmMedianMinutes">The firm's median duration for the type in the same window; null while <c>FirmSampleSize</c> is below <c>MinSampleSize</c>.</param>
/// <param name="Ratio">The person's median over the firm median (1.0 = the same), two decimals; null unless both medians are set (and the firm median is above zero).</param>
public sealed record UserHistoryType(
    [property: Required] int TaskTypeId,
    [property: Required] string Name,
    [property: Required] string IconKey,
    [property: Required] bool IsActive,
    [property: Required] int Completed,
    [property: Required] int SampleSize,
    double? MedianMinutes,
    [property: Required] int FirmSampleSize,
    double? FirmMedianMinutes,
    double? Ratio);

/// <summary>Tasks the person completed in one calendar month of the viewer's zone.</summary>
/// <param name="Month"><c>yyyy-MM</c>.</param>
public sealed record UserHistoryMonth([property: Required] string Month, [property: Required] int Completed);

/// <summary>On time versus late over the person's completed Tasks that have a due date, in the window.</summary>
/// <param name="SampleSize">Completed Tasks with a due date (on time plus late); Tasks without a due date (ASAP) are not judged.</param>
/// <param name="Rate">On time over <c>SampleSize</c>, a fraction 0 to 1 with three decimals; null while <c>SampleSize</c> is below <c>MinSampleSize</c>.</param>
public sealed record UserHistoryOnTime([property: Required] int OnTime, [property: Required] int Late, [property: Required] int SampleSize, double? Rate);

/// <summary>
/// What one person completed lately, for the user drawer: per task type the count, the median duration against the firm median, the last 12 months as a series and the on-time rate.
/// Duration is Started (the first time the Task went In progress, from the audit log) to Completed, in <c>DurationUnit</c> of <c>DurationBasis</c>: working minutes of the firm's working day
/// (<c>WORKING</c>, the same settings as the unassigned gauge) or every minute (<c>CLOCK</c>). Medians, never means, and only from <c>MinSampleSize</c> samples. Aggregates only: no Task, Matter or title.
/// Counts and durations cover the Tasks the caller may see (sensitive-matter rule), the same set the coverage board and the assignee experience display use.
/// </summary>
public sealed record UserHistory(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] bool IsActive,
    [property: Required] DateTime AsOfUtc,
    [property: Required] string ZoneId,
    [property: Required] int WindowMonths,
    [property: Required] DateTime WindowFromUtc,
    [property: Required] string DurationBasis,
    [property: Required] string DurationUnit,
    [property: Required] int MinSampleSize,
    [property: Required] int TotalCompleted,
    [property: Required] IReadOnlyList<UserHistoryType> Types,
    [property: Required] IReadOnlyList<UserHistoryMonth> Months,
    [property: Required] UserHistoryOnTime OnTime);

/// <summary>The pure rules of the history figures.</summary>
public static class UserHistoryRules
{
    public const int MinSampleSize = 5;
    public const int DefaultWindowMonths = 12;
    public const int SeriesMonths = 12;
    public const string UnitMinutes = "MINUTES";
    public static readonly IReadOnlyList<int> Windows = [3, 12];

    /// <summary>The median of the values (mean of the two middle ones for an even count), one decimal; null for fewer than <see cref="MinSampleSize"/> values.</summary>
    public static double? Median(IReadOnlyCollection<double> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        if (values.Count < MinSampleSize)
            return null;
        var sorted = values.Order().ToArray();
        var mid = sorted.Length / 2;
        var median = sorted.Length % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        return Math.Round(median, 1, MidpointRounding.AwayFromZero);
    }

    public static double? Ratio(double? person, double? firm) =>
        person is { } p && firm is { } f && f > 0 ? Math.Round(p / f, 2, MidpointRounding.AwayFromZero) : null;

    /// <summary>On time like the Trends tab: with a due instant completed at or before it, with a due date only completed before the end of that local day; null for a Task without a due date.</summary>
    public static bool? IsOnTime(DateTime completedAtUtc, DateOnly? dueDate, DateTime? dueAtUtc, Func<DateOnly, DateTime> endOfDayUtc)
    {
        ArgumentNullException.ThrowIfNull(endOfDayUtc);
        if (dueAtUtc is { } at)
            return completedAtUtc <= at;
        return dueDate is { } d ? completedAtUtc < endOfDayUtc(d) : null;
    }

    public static string MonthKey(DateOnly day) => $"{day.Year:0000}-{day.Month:00}";

    /// <summary>The first day of each of the last <paramref name="count"/> calendar months up to and including the month of <paramref name="today"/>, oldest first.</summary>
    public static IReadOnlyList<DateOnly> MonthStarts(DateOnly today, int count)
    {
        var current = new DateOnly(today.Year, today.Month, 1);
        return [.. Enumerable.Range(0, count).Select(i => current.AddMonths(i - (count - 1)))];
    }
}

/// <summary>
/// Read side of the person history. A fixed number of statements: the person, the person's completed Tasks of the last 12 months (narrow columns), and for the task types they worked on in the window
/// everybody's completed Tasks of those types in the window (type, assignee-free, id, completion time). The start of each Task is a correlated minimum over the audit events
/// <c>TASK_STATUS_CHANGED</c> to <c>IN_PROGRESS</c> (index <c>IX_Audit_Task</c>), so only timestamps leave the database. Medians are computed in memory.
/// </summary>
public sealed class UserHistoryService(DbContext db, IClock clock, IUserTimeZone timeZone, DashboardScopeResolver scopes, IMatterVisibility visibility, UnassignedAge age)
{
    public async Task<Result<UserHistory>> GetAsync(int userId, UserHistoryQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var months = query.Months ?? UserHistoryRules.DefaultWindowMonths;
        if (!UserHistoryRules.Windows.Contains(months))
            return Error.Validation("months", "UNKNOWN_WINDOW", $"Unknown window {months}. Allowed: {string.Join(", ", UserHistoryRules.Windows)} months.");

        var resolved = await scopes.ResolveAsync(query.PodScope, null, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;

        var person = await db.Set<AppUser>().AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.DisplayName, u.IsActive }).FirstOrDefaultAsync(ct);
        if (person is null || (!scope.IsAll && !await InScopeAsync(userId, scope, ct)))
            return Error.NotFound("That person is not available.");

        var queueClock = QueueClock.Create(clock.UtcNow, timeZone);
        var (gauge, firmZone) = await age.LoadAsync(ct);
        var windowFrom = queueClock.NowUtc.AddMonths(-months);
        var yearFrom = queueClock.NowUtc.AddMonths(-UserHistoryRules.SeriesMonths);
        var monthStarts = UserHistoryRules.MonthStarts(queueClock.Today, UserHistoryRules.SeriesMonths);
        var seriesFrom = queueClock.StartOfDayUtc(monthStarts[0]);
        var rowsFrom = yearFrom < seriesFrom ? yearFrom : seriesFrom;

        var starts = db.Database.SqlQuery<StartEvent>($"SELECT TaskId, OccurredAtUtc FROM dbo.AuditEvent WHERE EventType = 'TASK_STATUS_CHANGED' AND NewValue = 'IN_PROGRESS' AND TaskId IS NOT NULL");
        var visible = VisibleTasks.Of(db, visibility).Where(t => t.Status == TaskStatusCode.Completed && t.CompletedAtUtc != null);

        var mine = await visible
            .Where(t => t.AssignedUserId == userId && t.CompletedAtUtc >= rowsFrom)
            .Select(t => new Row(t.Id, t.TaskTypeId, t.CompletedAtUtc!.Value, t.DueDate, t.DueAtUtc, starts.Where(s => s.TaskId == t.Id).Min(s => (DateTime?)s.OccurredAtUtc)))
            .ToListAsync(ct);

        // Series: calendar months of the viewer's zone, oldest first, current month partial.
        var perMonth = mine.Where(r => r.CompletedAtUtc >= seriesFrom)
            .GroupBy(r => UserHistoryRules.MonthKey(DateOnly.FromDateTime(timeZone.ToLocal(r.CompletedAtUtc))))
            .ToDictionary(g => g.Key, g => g.Count());
        var series = monthStarts.Select(m => UserHistoryRules.MonthKey(m)).Select(k => new UserHistoryMonth(k, perMonth.GetValueOrDefault(k))).ToList();

        var inWindow = mine.Where(r => r.CompletedAtUtc >= windowFrom).ToList();
        var typeIds = inWindow.Select(r => r.TypeId).Distinct().ToList();

        var firmRows = typeIds.Count == 0
            ? []
            : await visible
                .Where(t => t.AssignedUserId != null && typeIds.Contains(t.TaskTypeId) && t.CompletedAtUtc >= windowFrom)
                .Select(t => new FirmRow(t.TaskTypeId, t.CompletedAtUtc!.Value, starts.Where(s => s.TaskId == t.Id).Min(s => (DateTime?)s.OccurredAtUtc)))
                .ToListAsync(ct);
        var types = await db.Set<TaskType>().AsNoTracking().Where(t => typeIds.Contains(t.Id)).Select(t => new { t.Id, t.Name, t.IconKey, t.IsActive }).ToListAsync(ct);

        // A start after the completion (an inconsistent history, for example edited data) has no duration instead of a misleading zero.
        double? Minutes(DateTime? started, DateTime completed) => started is { } s && s <= completed ? WorkingTime.Minutes(s, completed, gauge, firmZone) : null;

        var firmByType = firmRows
            .Select(r => (r.TypeId, Minutes: Minutes(r.StartedAtUtc, r.CompletedAtUtc)))
            .Where(r => r.Minutes is not null)
            .GroupBy(r => r.TypeId)
            .ToDictionary(g => g.Key, g => g.Select(r => r.Minutes!.Value).ToList());
        var mineByType = inWindow.GroupBy(r => r.TypeId).ToDictionary(g => g.Key, g => g.ToList());

        var rows = types
            .OrderBy(t => t.Name, StringComparer.CurrentCultureIgnoreCase).ThenBy(t => t.Id)
            .Select(t =>
            {
                var own = mineByType[t.Id];
                var ownDurations = own.Select(r => Minutes(r.StartedAtUtc, r.CompletedAtUtc)).Where(m => m is not null).Select(m => m!.Value).ToList();
                var firm = firmByType.GetValueOrDefault(t.Id) ?? [];
                var ownMedian = UserHistoryRules.Median(ownDurations);
                var firmMedian = UserHistoryRules.Median(firm);
                return new UserHistoryType(t.Id, t.Name, t.IconKey, t.IsActive, own.Count, ownDurations.Count, ownMedian, firm.Count, firmMedian, UserHistoryRules.Ratio(ownMedian, firmMedian));
            })
            .ToList();

        var judged = inWindow.Select(r => UserHistoryRules.IsOnTime(r.CompletedAtUtc, r.DueDate, r.DueAtUtc, queueClock.EndOfDayUtc)).Where(b => b is not null).Select(b => b!.Value).ToList();
        var onTime = judged.Count(b => b);
        var onTimeSummary = new UserHistoryOnTime(onTime, judged.Count - onTime, judged.Count, judged.Count >= UserHistoryRules.MinSampleSize ? Math.Round((double)onTime / judged.Count, 3, MidpointRounding.AwayFromZero) : null);

        return new UserHistory(
            userId,
            person.DisplayName,
            person.IsActive,
            queueClock.NowUtc,
            queueClock.ZoneId,
            months,
            DateTime.SpecifyKind(windowFrom, DateTimeKind.Utc),
            gauge.AgeBasis,
            UserHistoryRules.UnitMinutes,
            UserHistoryRules.MinSampleSize,
            inWindow.Count,
            rows,
            series,
            onTimeSummary);
    }

    private async Task<bool> InScopeAsync(int userId, DashboardScope scope, CancellationToken ct)
    {
        var scopePods = scope.PodIds.ToList();
        return await db.Set<PodMember>().AsNoTracking().AnyAsync(m => m.UserId == userId && scopePods.Contains(m.PodId), ct);
    }

    internal sealed class StartEvent
    {
        public long TaskId { get; init; }

        public DateTime OccurredAtUtc { get; init; }
    }

    private sealed record Row(long Id, int TypeId, DateTime CompletedAtUtc, DateOnly? DueDate, DateTime? DueAtUtc, DateTime? StartedAtUtc);

    private sealed record FirmRow(int TypeId, DateTime CompletedAtUtc, DateTime? StartedAtUtc);
}
