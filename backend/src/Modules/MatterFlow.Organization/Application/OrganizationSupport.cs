using System.ComponentModel.DataAnnotations;
using System.Linq.Expressions;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.ValueObjects;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Organization.Application;

/// <summary>Offset paging and sort parameters shared by the Organization list endpoints (same shape as the host's standard list query).</summary>
public class OrgListQuery
{
    /// <summary>1-based page number.</summary>
    [Range(1, int.MaxValue)]
    public int Page { get; init; } = PageRequest.FirstPage;

    /// <summary>Items per page (default 25, max 100).</summary>
    [Range(1, PageRequest.MaxPageSize)]
    public int PageSize { get; init; } = PageRequest.DefaultPageSize;

    /// <summary>Comma-separated sort fields; prefix with <c>-</c> for descending.</summary>
    [StringLength(200)]
    public string? Sort { get; init; }
}

/// <summary>Client list filters.</summary>
public sealed class ClientListQuery : OrgListQuery
{
    /// <summary>Client number (<c>343</c> or <c>00343</c>) or a name fragment.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Filter by active state.</summary>
    public bool? IsActive { get; init; }

    /// <summary>Column filter: digits that the 5-digit client number contains (<c>343</c> finds 00343 and 13430). Anything but digits finds nothing.</summary>
    [StringLength(200)]
    public string? ClientNumber { get; init; }

    /// <summary>Column filter: fragment of the name only.</summary>
    [StringLength(200)]
    public string? Name { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "q", "isActive", "clientNumber", "name"];
}

/// <summary>Matter list filters.</summary>
public sealed class MatterListQuery : OrgListQuery
{
    /// <summary>Matter reference (<c>343-12</c>, <c>00343-00012</c>), a number (client or matter), or a name fragment.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Only Matters of this Client.</summary>
    public int? ClientId { get; init; }

    /// <summary>Filter by active state.</summary>
    public bool? IsActive { get; init; }

    /// <summary>Filter by the sensitivity flag.</summary>
    public bool? IsSensitive { get; init; }

    /// <summary>Column filter: the Matter reference (<c>00343-00012</c>, a fragment, or the typed pair <c>343-12</c>, which also finds <c>343-120</c> as you type).</summary>
    [StringLength(200)]
    public string? MatterRef { get; init; }

    /// <summary>Column filter: fragment of the Matter name only.</summary>
    [StringLength(200)]
    public string? Name { get; init; }

    /// <summary>Column filter: fragment of the Client name, or digits that the Client number contains.</summary>
    [StringLength(200)]
    public string? Client { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "q", "clientId", "isActive", "isSensitive", "matterRef", "name", "client"];
}

/// <summary>Project list filters.</summary>
public sealed class ProjectListQuery : OrgListQuery
{
    /// <summary>Project name fragment or Matter reference.</summary>
    [StringLength(200)]
    public string? Q { get; init; }

    /// <summary>Only Projects of this Matter.</summary>
    public int? MatterId { get; init; }

    /// <summary>Filter by active state (false = archived).</summary>
    public bool? IsActive { get; init; }

    /// <summary>Column filter: fragment of the Project name only.</summary>
    [StringLength(200)]
    public string? Name { get; init; }

    /// <summary>Column filter: fragment of the Matter reference or name, or the typed pair <c>343-12</c>.</summary>
    [StringLength(200)]
    public string? Matter { get; init; }

    internal static readonly string[] Keys = ["page", "pageSize", "sort", "q", "matterId", "isActive", "name", "matter"];
}

/// <summary>Audit event type codes written by the Organization module.</summary>
public static class OrganizationAuditEvents
{
    public const string ClientCreated = "CLIENT_CREATED";
    public const string ClientNumberChanged = "CLIENT_NUMBER_CHANGED";
    public const string MatterCreated = "MATTER_CREATED";
    public const string MatterNumberChanged = "MATTER_NUMBER_CHANGED";
    public const string ProjectCreated = "PROJECT_CREATED";
}

internal static class OrganizationSupport
{
    public const string ClientNumberUnique = "UQ_Client_Number";
    public const string MatterNumberUnique = "UQ_Matter_ClientMatterNumber";
    public const string ProjectNameUnique = "UQ_Project_MatterName";

    /// <summary>Parses a 1-5 digit number, reporting the failure against <paramref name="field"/> (a request property name, camelCase).</summary>
    public static Result<BusinessNumber> ParseNumber(string? input, string field)
    {
        var parsed = BusinessNumber.Parse(input);
        if (parsed.IsSuccess)
            return parsed;

        var message = parsed.Error!.Message;
        return new Error(
            ErrorType.Validation,
            ErrorCodes.InvalidNumberFormat,
            message,
            new Dictionary<string, IReadOnlyList<FieldError>> { [field] = [new FieldError(ErrorCodes.InvalidNumberFormat, message)] });
    }

    public static Error Duplicate(string code, string field, string message, int? existingId)
    {
        var meta = existingId is null ? null : new Dictionary<string, object?> { ["existingId"] = existingId };
        return new Error(
            ErrorType.Conflict,
            code,
            message,
            new Dictionary<string, IReadOnlyList<FieldError>> { [field] = [new FieldError(code, message)] },
            meta);
    }

    public static Error NotFound(string what) => Error.NotFound($"{what} not found.");

    public static string Encode(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    public static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static DateTime? Utc(DateTime? value) => value is null ? null : Utc(value.Value);

    /// <summary>Optimistic concurrency check: the supplied token must equal the stored one (409 with the current token otherwise).</summary>
    public static Result CheckRowVersion(byte[] current, string supplied)
    {
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(supplied);
        }
        catch (FormatException)
        {
            return Error.Validation("rowVersion", "INVALID", "rowVersion is not a valid token.");
        }

        return bytes.AsSpan().SequenceEqual(current)
            ? Result.Success()
            : Error.Conflict(
                ErrorCodes.ConcurrencyConflict,
                "The record was changed by someone else. Reload and try again.",
                new Dictionary<string, object?> { ["currentRowVersion"] = Encode(current) });
    }

    /// <summary>Makes the supplied token the original value so the UPDATE's WHERE clause re-checks it against a concurrent writer.</summary>
    public static void TrackOriginalRowVersion(DbContext db, object entity, string supplied) =>
        db.Entry(entity).Property("RowVersion").OriginalValue = Convert.FromBase64String(supplied);

    public static bool IsUniqueViolation(DbUpdateException exception, string constraint) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 } sql && sql.Message.Contains(constraint, StringComparison.OrdinalIgnoreCase);

    public static bool IsForeignKeyViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: 547 };

    public static Error ConcurrencyError() =>
        Error.Conflict(ErrorCodes.ConcurrencyConflict, "The record was changed by someone else. Reload and try again.");

    public static PagedResult<TOut> Page<TOut>(IReadOnlyList<TOut> items, int total, PageRequest page) =>
        new(items, total, page.Page, page.PageSize);

    /// <summary>Applies the parsed sort keys (first key OrderBy, the rest ThenBy) using the per-field key selectors, ending with a stable tie-break.</summary>
    public static IQueryable<T> ApplySort<T>(
        IQueryable<T> source,
        IReadOnlyList<SortField> sort,
        IReadOnlyDictionary<string, Func<IQueryable<T>, bool, bool, IOrderedQueryable<T>>> orderings,
        Expression<Func<T, int>> tieBreak)
    {
        IOrderedQueryable<T>? ordered = null;
        foreach (var field in sort)
            ordered = orderings[field.Field](ordered is null ? source : ordered, field.Descending, ordered is not null);

        return ordered is null ? source.OrderBy(tieBreak) : ordered.ThenBy(tieBreak);
    }

    /// <summary>Builds the ordering delegate for one key selector: <c>OrderBy</c> on the first key, <c>ThenBy</c> afterwards.</summary>
    public static Func<IQueryable<T>, bool, bool, IOrderedQueryable<T>> By<T, TKey>(Expression<Func<T, TKey>> key) =>
        (query, descending, then) => then
            ? (descending ? ((IOrderedQueryable<T>)query).ThenByDescending(key) : ((IOrderedQueryable<T>)query).ThenBy(key))
            : (descending ? query.OrderByDescending(key) : query.OrderBy(key));

    /// <summary>Sort keys of the Task counts, shared by the Client, Matter and Project lists.</summary>
    public const string SortOpenTasks = "openTasks";
    public const string SortOverdue = "overdue";

    public static bool IsCountSort(string field) => field is SortOpenTasks or SortOverdue;

    /// <summary>
    /// The sort to apply: the request's keys, or the default when none, followed by the default key when a count sort was asked for (so ties and
    /// viewers who may not count Tasks fall back to the existing default order). The unique id tie-break is added by <see cref="ApplySort{T}"/>.
    /// </summary>
    public static IReadOnlyList<SortField> WithDefaultTail(IReadOnlyList<SortField> sort, SortField defaultField)
    {
        if (sort.Count == 0)
            return [defaultField];

        return sort.Any(f => IsCountSort(f.Field)) && sort.All(f => f.Field != defaultField.Field) ? [.. sort, defaultField] : sort;
    }

    public static Result<(PageRequest Page, IReadOnlyList<SortField> Sort)> PagingOf(OrgListQuery query, IReadOnlyCollection<string> allowedSort)
    {
        var page = PageRequest.Create(query.Page, query.PageSize);
        if (page.IsFailure)
            return page.Error!;

        var sort = SortSpec.Parse(query.Sort, allowedSort);
        if (sort.IsFailure)
            return sort.Error!;

        return (page.Value, sort.Value);
    }
}
