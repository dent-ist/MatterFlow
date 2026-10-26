using MatterFlow.Configuration.Domain;
using MatterFlow.Organization.Domain;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>The type filter and the sort of a My Matters task section (PM v2, #855), parsed once and applied to the task query.</summary>
public sealed record SectionOptions(IReadOnlyList<int> TaskTypeIds, string? Sort, bool Descending)
{
    public bool Filtered => TaskTypeIds.Count > 0;

    /// <summary>The Task Queue parameters ("View all") that open the same rows: <c>type=</c> per filtered type and the sort.</summary>
    public IEnumerable<string> QueueParts() =>
        TaskTypeIds.Select(id => "type=" + id.ToString(System.Globalization.CultureInfo.InvariantCulture))
            .Concat(Sort is null ? [] : [$"sort={Sort}", .. (Descending ? new[] { "dir=desc" } : [])]);
}

/// <summary>The sort keys of a section and how each orders the tasks. The keys are columns of Task or one-row lookups of the type, priority or matter.</summary>
public static class SectionSorts
{
    public const string SortType = "type";
    public const string SortDue = "due";
    public const string SortPriority = "priority";
    public const string SortMatter = "matter";
    public const string SortAge = "age";

    public static readonly IReadOnlyList<string> All = [SortType, SortDue, SortPriority, SortMatter, SortAge];

    /// <summary>The filter and sort of a request; a bad key, direction or type id is a 400.</summary>
    public static Result<SectionOptions> Parse(MyMattersSectionQuery query)
    {
        ArgumentNullException.ThrowIfNull(query);
        var types = query.TaskTypeId ?? [];
        if (types.Any(id => id <= 0))
            return Error.Validation("taskTypeId", "INVALID", "taskTypeId must be a positive task type id.");

        var sort = string.IsNullOrWhiteSpace(query.Sort) ? null : query.Sort.Trim().ToLowerInvariant();
        if (sort is not null && !All.Contains(sort))
            return Error.Validation("sort", "UNKNOWN_SORT", $"sort must be one of: {string.Join(", ", All)}.");

        var dir = string.IsNullOrWhiteSpace(query.Dir) ? "asc" : query.Dir.Trim().ToLowerInvariant();
        if (dir is not ("asc" or "desc"))
            return Error.Validation("dir", "INVALID", "dir must be asc or desc.");

        return new SectionOptions([.. types.Distinct().Order()], sort, dir == "desc");
    }

    /// <summary>Narrows the tasks to the filtered types (no change without a filter).</summary>
    public static IQueryable<WorkTask> Filter(IQueryable<WorkTask> tasks, SectionOptions options)
    {
        if (!options.Filtered)
            return tasks;
        var ids = options.TaskTypeIds;
        return tasks.Where(t => ids.Contains(t.TaskTypeId));
    }

    /// <summary>The sort: the key (reversed by <c>desc</c>), then the due moment, then the id so the order is stable.</summary>
    public static IOrderedQueryable<WorkTask> Apply(IQueryable<WorkTask> tasks, DbContext db, string sort, bool descending)
    {
        ArgumentNullException.ThrowIfNull(db);
        IOrderedQueryable<WorkTask> ordered = sort switch
        {
            SortType => descending
                ? tasks.OrderByDescending(t => db.Set<TaskType>().Where(x => x.Id == t.TaskTypeId).Select(x => x.Name).FirstOrDefault())
                : tasks.OrderBy(t => db.Set<TaskType>().Where(x => x.Id == t.TaskTypeId).Select(x => x.Name).FirstOrDefault()),
            SortPriority => descending
                ? tasks.OrderByDescending(t => db.Set<Priority>().Where(x => x.Id == t.PriorityId).Select(x => x.SortOrder).FirstOrDefault())
                : tasks.OrderBy(t => db.Set<Priority>().Where(x => x.Id == t.PriorityId).Select(x => x.SortOrder).FirstOrDefault()),
            SortMatter => descending
                ? tasks.OrderByDescending(t => db.Set<Matter>().Where(x => x.Id == t.MatterId).Select(x => x.MatterRef).FirstOrDefault())
                : tasks.OrderBy(t => db.Set<Matter>().Where(x => x.Id == t.MatterId).Select(x => x.MatterRef).FirstOrDefault()),
            SortAge => descending ? tasks.OrderByDescending(t => t.CreatedAtUtc) : tasks.OrderBy(t => t.CreatedAtUtc),
            _ => descending ? tasks.OrderByDescending(t => t.DueSortKey) : tasks.OrderBy(t => t.DueSortKey),
        };

        return sort == SortDue ? ordered.ThenBy(t => t.Id) : ordered.ThenBy(t => t.DueSortKey).ThenBy(t => t.Id);
    }
}
