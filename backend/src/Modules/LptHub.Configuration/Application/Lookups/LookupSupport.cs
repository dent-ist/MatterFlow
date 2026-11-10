using MatterFlow.SharedKernel.Entities;
using MatterFlow.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Lookups;

/// <summary>Stable codes specific to the configuration lookups (also listed in <see cref="ErrorCodes"/> for the API contract).</summary>
internal static class LookupErrors
{
    public static Error Required(string field, string message) => Error.Validation(field, "REQUIRED", message);

    public static Error TooLong(string field, string message) => Error.Validation(field, "TOO_LONG", message);

    public static Error Duplicate(string field, string message) =>
        new(
            ErrorType.Conflict,
            ErrorCodes.DuplicateName,
            message,
            new Dictionary<string, IReadOnlyList<FieldError>> { [field] = [new FieldError("DUPLICATE", message)] });

    public static Error Concurrency(string message = "Someone else changed this item. Reload and try again.") =>
        Error.Conflict(ErrorCodes.ConcurrencyConflict, message);

    public static Error InUse(string message) => Error.Conflict(ErrorCodes.InUse, message);

    public static Error DefaultRequired(string message) => Error.Conflict(ErrorCodes.DefaultRequired, message);

    public static Error InvalidRowVersion() => Error.Validation("rowVersion", "INVALID", "The row version is not valid.");
}

internal static class LookupSupport
{
    private const int SqlDuplicateKey = 2601;
    private const int SqlUniqueConstraint = 2627;
    private const int SqlForeignKey = 547;

    /// <summary>Trims and validates a required text value (1 to <paramref name="max"/> characters).</summary>
    public static Result<string> CleanText(string? value, string field, string requiredMessage, int max = 50)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
            return LookupErrors.Required(field, requiredMessage);
        if (text.Length > max)
            return LookupErrors.TooLong(field, $"Use at most {max} characters.");
        return text;
    }

    /// <summary>Decodes a base64 row version; null when malformed.</summary>
    public static byte[]? ParseRowVersion(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return null;
        try
        {
            var bytes = Convert.FromBase64String(value);
            return bytes.Length == 8 ? bytes : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    public static string FormatRowVersion(byte[] value) => Convert.ToBase64String(value);

    /// <summary>Makes the update conditional on the version the client saw (optimistic concurrency, architecture section 10).</summary>
    public static void ExpectVersion(DbContext db, IAuditStamped entity, byte[] version) =>
        db.Entry(entity).Property(nameof(IAuditStamped.RowVersion)).OriginalValue = version;

    public static bool VersionMatches(IAuditStamped entity, byte[] version) => entity.RowVersion.AsSpan().SequenceEqual(version);

    /// <summary>
    /// Saves, translating a concurrency clash, a unique-index violation (<paramref name="duplicate"/>) and a foreign-key violation
    /// (<paramref name="inUse"/>) into results. Returns null on success.
    /// </summary>
    public static async Task<Error?> SaveAsync(DbContext db, Error? duplicate, Error? inUse, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            return LookupErrors.Concurrency();
        }
        catch (DbUpdateException ex) when (duplicate is not null && IsSqlError(ex, SqlDuplicateKey, SqlUniqueConstraint))
        {
            return duplicate;
        }
        catch (DbUpdateException ex) when (inUse is not null && IsSqlError(ex, SqlForeignKey))
        {
            return inUse;
        }
    }

    private static bool IsSqlError(DbUpdateException ex, params int[] numbers) =>
        ex.GetBaseException() is SqlException sql && numbers.Contains(sql.Number);
}
