using MatterFlow.SharedKernel.Entities;
using MatterFlow.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkflowEngine.Application;

/// <summary>Shared helpers of the workflow configuration services (row versions, text validation, SQL error mapping).</summary>
internal static class WorkflowSupport
{
    private const int SqlDuplicateKey = 2601;
    private const int SqlUniqueConstraint = 2627;
    private const int SqlForeignKey = 547;
    private const int SqlDeadlockVictim = 1205;

    public static string Text(int value) => value.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>Decodes a base64 row version; null when malformed.</summary>
    public static byte[]? ParseRowVersion(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return null;
        }

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

    public static Error InvalidRowVersion() => Error.Validation("rowVersion", "INVALID", "The row version is not valid.");

    public static Error Concurrency(string message = "Someone else changed this item. Reload and try again.") =>
        Error.Conflict(ErrorCodes.ConcurrencyConflict, message);

    public static Error Duplicate(string field, string message) =>
        new(
            ErrorType.Conflict,
            ErrorCodes.DuplicateName,
            message,
            new Dictionary<string, IReadOnlyList<FieldError>> { [field] = [new FieldError("DUPLICATE", message)] });

    /// <summary>
    /// Compares the row version the client saw with the loaded entity and makes the update conditional on it (architecture section 10).
    /// Returns a failure when it is malformed or already stale.
    /// </summary>
    public static Error? ExpectVersion(DbContext db, IAuditStamped entity, string? rowVersion)
    {
        var version = ParseRowVersion(rowVersion);
        if (version is null)
        {
            return InvalidRowVersion();
        }

        if (!entity.RowVersion.AsSpan().SequenceEqual(version))
        {
            return Concurrency();
        }

        db.Entry(entity).Property(nameof(IAuditStamped.RowVersion)).OriginalValue = version;
        return null;
    }

    /// <summary>Trims a required text value (1 to <paramref name="max"/> characters).</summary>
    public static Result<string> RequiredText(string? value, string field, string requiredMessage, int max)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return Error.Validation(field, "REQUIRED", requiredMessage);
        }

        return text.Length > max ? Error.Validation(field, "TOO_LONG", $"Use at most {max} characters.") : text;
    }

    /// <summary>Trims an optional text value; blank becomes null.</summary>
    public static Result<string?> OptionalText(string? value, string field, int max)
    {
        var text = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        return text is { } t && t.Length > max ? Error.Validation(field, "TOO_LONG", $"Use at most {max} characters.") : Result<string?>.Success(text);
    }

    /// <summary>Optional http(s) URL (as the form engine's URL control), or a OneNote desktop link: <c>onenote:</c> followed by an http(s) address.</summary>
    public static Result<string?> OptionalUrl(string? value, string field, int max)
    {
        var text = OptionalText(value, field, max);
        if (text.IsFailure || text.Value is null)
        {
            return text;
        }

        var address = text.Value.StartsWith("onenote:", StringComparison.OrdinalIgnoreCase) ? text.Value["onenote:".Length..] : text.Value;
        return Uri.TryCreate(address, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https"
            ? text
            : Error.Validation(field, "INVALID_URL", "Enter a full web address starting with http:// or https://, or a OneNote link starting with onenote:https://.");
    }

    /// <summary>True when the exception (or one inside it) is a SQL Server deadlock: error 1205, the victim's transaction was rolled back and may be repeated.</summary>
    public static bool IsDeadlock(Exception exception)
    {
        for (var ex = exception; ex is not null; ex = ex.InnerException)
        {
            if (ex is SqlException { Number: SqlDeadlockVictim })
            {
                return true;
            }
        }

        return false;
    }

    public static bool IsDuplicateKey(DbUpdateException ex) =>
        ex.GetBaseException() is SqlException sql && (sql.Number is SqlDuplicateKey or SqlUniqueConstraint);

    public static bool IsDuplicateOf(DbUpdateException ex, string indexName) =>
        IsDuplicateKey(ex) && ex.GetBaseException().Message.Contains(indexName, StringComparison.OrdinalIgnoreCase);

    public static bool IsForeignKey(DbUpdateException ex) =>
        ex.GetBaseException() is SqlException sql && sql.Number == SqlForeignKey;
}
