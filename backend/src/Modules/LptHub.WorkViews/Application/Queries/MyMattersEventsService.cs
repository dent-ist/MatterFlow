using MatterFlow.Organization.Application;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>The upcoming events of a My Matters scope.</summary>
public sealed record MyMattersUpcomingEvents(
    [property: System.ComponentModel.DataAnnotations.Required] DateTime AsOfUtc,
    [property: System.ComponentModel.DataAnnotations.Required] DateOnly From,
    [property: System.ComponentModel.DataAnnotations.Required] DateOnly To,
    [property: System.ComponentModel.DataAnnotations.Required] int Total,
    [property: System.ComponentModel.DataAnnotations.Required] IReadOnlyList<MatterEventResponse> Items);

/// <summary>
/// Matter events (calendar items) of the scope's matters (UI-05, #958): the Calendar tab's range and the side panel's Upcoming events. The scope's matters are visible to the caller by construction and
/// the event service applies the sensitive-matter rule again, so a hidden matter's events are never counted or listed.
/// </summary>
public sealed class MyMattersEventsService(MyMattersScopeResolver scopes, MatterEventService events)
{
    public async Task<Result<MatterEventList>> ListAsync(MyMattersEventsQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (query.From is not { } from)
            return Error.Validation("from", "REQUIRED", "from is required.");
        if (query.To is not { } to)
            return Error.Validation("to", "REQUIRED", "to is required.");
        var range = MatterEventService.ValidateRange(from, to);
        if (range.IsFailure)
            return range.Error!;

        var types = new List<string>();
        foreach (var code in (query.TypeCode ?? []).SelectMany(FilterParsing.SplitList))
        {
            if (MatterEventTypes.Find(code) is not { } type)
                return Error.Validation("typeCode", "UNKNOWN_EVENT_TYPE", $"Unknown event type '{code}'.");
            if (!types.Contains(type.Code))
                types.Add(type.Code);
        }

        // The scope's own date range is a task filter; the event range is the one asked for here.
        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;

        var rows = MatterEventService.Ordered(events.InRange(scope.Matters.Select(m => m.Id), from, to, types));
        var items = await rows.Take(MatterEventService.MaxEvents + 1).ToListAsync(ct);
        if (items.Count > MatterEventService.MaxEvents)
            return Error.Validation("to", "RANGE_TOO_LARGE", $"More than {MatterEventService.MaxEvents} events in that range. Choose a shorter range.");

        return new MatterEventList(from, to, items.Count, await events.ToResponsesAsync(items, ct));
    }

    public async Task<Result<MyMattersUpcomingEvents>> UpcomingAsync(MyMattersUpcomingEventsQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        var resolved = await scopes.ResolveAsync(query, ct);
        if (resolved.IsFailure)
            return resolved.Error!;
        var scope = resolved.Value;
        var from = scope.Clock.Today;
        var to = from.AddDays(query.Days - 1);

        var range = events.InRange(scope.Matters.Select(m => m.Id), from, to);
        var total = await range.CountAsync(ct);
        var items = total == 0 ? [] : await MatterEventService.Ordered(range).Take(query.Take).ToListAsync(ct);
        return new MyMattersUpcomingEvents(DateTime.SpecifyKind(scope.Clock.NowUtc, DateTimeKind.Utc), from, to, total, await events.ToResponsesAsync(items, ct));
    }
}
