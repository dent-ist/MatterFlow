using System.Linq.Expressions;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Assets.Application;

internal static class AssetSupport
{
    public const string AssetTypeNameUnique = "UQ_AssetType_Name";

    public static Error NotFound(string what) => Error.NotFound($"{what} not found.");

    public static string Encode(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    public static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static DateTime? Utc(DateTime? value) => value is null ? null : Utc(value.Value);

    public static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    public static Error Duplicate(string field, string message, int? existingId)
    {
        var meta = existingId is null ? null : new Dictionary<string, object?> { ["existingId"] = existingId };
        return new Error(
            ErrorType.Conflict,
            ErrorCodes.DuplicateName,
            message,
            new Dictionary<string, IReadOnlyList<FieldError>> { [field] = [new FieldError(ErrorCodes.DuplicateName, message)] },
            meta);
    }

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

    public static Error ConcurrencyError() =>
        Error.Conflict(ErrorCodes.ConcurrencyConflict, "The record was changed by someone else. Reload and try again.");

    public static bool IsUniqueViolation(DbUpdateException exception, string constraint) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 } sql && sql.Message.Contains(constraint, StringComparison.OrdinalIgnoreCase);

    public static PagedResult<TOut> Page<TOut>(IReadOnlyList<TOut> items, int total, PageRequest page) =>
        new(items, total, page.Page, page.PageSize);

    public static Result<(PageRequest Page, IReadOnlyList<SortField> Sort)> PagingOf(AssetListQueryBase query, IReadOnlyCollection<string> allowedSort)
    {
        var page = PageRequest.Create(query.Page, query.PageSize);
        if (page.IsFailure)
            return page.Error!;

        var sort = SortSpec.Parse(query.Sort, allowedSort);
        if (sort.IsFailure)
            return sort.Error!;

        return (page.Value, sort.Value);
    }

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
}
