using System.Globalization;
using LptHub.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Vendors.Application;

internal static class VendorSupport
{
    public const string VendorNameUnique = "UQ_Vendor_Name";

    public static Error NotFound(string what) => Error.NotFound($"{what} not found.");

    public static string Encode(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    public static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);

    public static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static DateTime? Utc(DateTime? value) => value is null ? null : Utc(value.Value);

    /// <summary>Trims; blank becomes null.</summary>
    public static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    public static Error Duplicate(string field, string message) =>
        new(
            ErrorType.Conflict,
            ErrorCodes.DuplicateName,
            message,
            new Dictionary<string, IReadOnlyList<FieldError>> { [field] = [new FieldError(ErrorCodes.DuplicateName, message)] });

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

    public static bool IsUniqueViolation(DbUpdateException ex) => ex.GetBaseException() is SqlException { Number: 2601 or 2627 };

    public static bool IsForeignKeyViolation(DbUpdateException ex) => ex.GetBaseException() is SqlException { Number: 547 };

    /// <summary>Text for an audit value: names joined with ", " (A to Z), or null for none.</summary>
    public static string? Joined(IEnumerable<string> names)
    {
        var list = names.OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
        return list.Count == 0 ? null : string.Join(", ", list);
    }
}
