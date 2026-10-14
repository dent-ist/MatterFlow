using MatterFlow.SharedKernel.Results;

namespace MatterFlow.SharedKernel.Paging;

/// <summary>One sort key: a whitelisted field name and a direction.</summary>
public sealed record SortField(string Field, bool Descending);

/// <summary>Parses <c>sort=priority,-dueAt,createdAt</c> against a per-resource whitelist (case-insensitive).</summary>
public static class SortSpec
{
    /// <summary>The named sort that expands to a resource-specific ordering (e.g. the Task Queue rule).</summary>
    public const string Default = "default";

    public static Result<IReadOnlyList<SortField>> Parse(string? sort, IReadOnlyCollection<string> allowed)
    {
        if (string.IsNullOrWhiteSpace(sort))
            return Result<IReadOnlyList<SortField>>.Success([]);

        var fields = new List<SortField>();
        foreach (var raw in sort.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var desc = raw.StartsWith('-');
            var name = desc ? raw[1..] : raw;
            var match = allowed.FirstOrDefault(a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
            if (match is null)
                return Error.Validation("sort", "UNKNOWN_SORT", $"Unknown sort field '{name}'. Allowed: {string.Join(", ", allowed)}.");
            if (fields.Any(f => f.Field == match))
                return Error.Validation("sort", "DUPLICATE_SORT", $"Sort field '{match}' is repeated.");
            fields.Add(new SortField(match, desc));
        }

        return Result<IReadOnlyList<SortField>>.Success(fields);
    }
}

/// <summary>Helpers for flat filter parameters with comma-separated multi-values.</summary>
public static class FilterParsing
{
    public static IReadOnlyList<string> SplitList(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    /// <summary>Unknown filters are a 400 (architecture section 11).</summary>
    public static Result EnsureKnown(IEnumerable<string> presentKeys, IReadOnlyCollection<string> allowedKeys, Func<string, bool>? allowedPrefix = null)
    {
        var unknown = presentKeys
            .Where(k => !allowedKeys.Contains(k, StringComparer.OrdinalIgnoreCase) && !(allowedPrefix?.Invoke(k) ?? false))
            .ToList();
        return unknown.Count == 0
            ? Result.Success()
            : Error.Validation(unknown[0], "UNKNOWN_FILTER", $"Unknown filter '{unknown[0]}'.");
    }
}
