using System.Globalization;
using System.Net;
using System.Text;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Tasks;
using MatterFlow.WorkManagement.Domain;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.WorkManagement.Application;

internal static class TaskSupport
{
    public const string TaskObjectType = "Task";
    public const string TaskUpdatedEvent = "TASK_UPDATED";
    public const string CommentAddedEvent = "COMMENT_ADDED";
    public const string CommentEditedEvent = "COMMENT_EDITED";
    public const string CommentDeletedEvent = "COMMENT_DELETED";
    public const string AssetLinkedEvent = "TASK_ASSET_LINKED";
    public const string AssetUnlinkedEvent = "TASK_ASSET_UNLINKED";
    public const string AssetRoleChangedEvent = "TASK_ASSET_ROLE_CHANGED";

    // Stable error codes of the comment and asset-link endpoints (HTTP status in the comment).
    public const string CommentNotDeletableCode = "COMMENT_NOT_DELETABLE"; // 409
    public const string CommentNotEditableCode = "COMMENT_NOT_EDITABLE"; // 409
    public const string AlreadyLinkedCode = "ASSET_ALREADY_LINKED"; // 409

    public static string Encode(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    public static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static DateTime? Utc(DateTime? value) => value is null ? null : Utc(value.Value);

    public static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    public static string Id(long id) => id.ToString(CultureInfo.InvariantCulture);

    public static Error NotFound() => Error.NotFound("Task not found.");

    public static Error Concurrency(byte[]? current = null) =>
        Error.Conflict(
            ErrorCodes.ConcurrencyConflict,
            "The task was changed by someone else. Reload and try again.",
            current is null ? null : new Dictionary<string, object?> { ["currentRowVersion"] = Encode(current) });

    /// <summary>Optimistic concurrency check: the supplied token must equal the stored one (409 with the current token otherwise).</summary>
    public static Result CheckRowVersion(byte[] current, string supplied)
    {
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(supplied ?? string.Empty);
        }
        catch (FormatException)
        {
            return Error.Validation("rowVersion", "INVALID", "rowVersion is not a valid token.");
        }

        return bytes.Length > 0 && bytes.AsSpan().SequenceEqual(current) ? Result.Success() : Concurrency(current);
    }

    /// <summary>Makes the supplied token the original value so the UPDATE's WHERE clause re-checks it against a concurrent writer.</summary>
    public static void TrackOriginalRowVersion(DbContext db, object entity, string supplied) =>
        db.Entry(entity).Property("RowVersion").OriginalValue = Convert.FromBase64String(supplied);

    /// <summary>Plain text to the safe HTML stored for comments: everything is escaped, line breaks become <c>&lt;br&gt;</c>.</summary>
    public static string ToSafeHtml(string plainText)
    {
        var normalized = plainText.Trim().Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
        var encoded = WebUtility.HtmlEncode(normalized);
        var sb = new StringBuilder("<p>");
        sb.Append(encoded.Replace("\n", "<br>", StringComparison.Ordinal));
        sb.Append("</p>");
        return sb.ToString();
    }

    /// <summary>A short audit value for a nullable date.</summary>
    public static string? Display(DateTime? value) => ToUtc(value)?.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>
    /// A UTC instant at the millisecond precision the columns store: a local time (from an offset in JSON) is converted, an unspecified
    /// one (read from the database) is taken as UTC.
    /// </summary>
    public static DateTime? ToUtc(DateTime? value)
    {
        if (value is not { } v)
            return null;

        var utc = v.Kind == DateTimeKind.Local ? v.ToUniversalTime() : DateTime.SpecifyKind(v, DateTimeKind.Utc);
        return new DateTime(utc.Ticks - (utc.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Utc);
    }

    public static string? Display(DateOnly? value) => value?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Validates the free-text fields of a Task; returns a 400 with one entry per bad field, or null.</summary>
    public static Error? ValidateTexts(string? title, string? description, string? requestorName, string? requestorEmail)
    {
        var errors = new Dictionary<string, IReadOnlyList<FieldError>>();

        void Add(string field, FieldError? error)
        {
            if (error is not null)
                errors[field] = [error];
        }

        Add("title", TaskValidation.ValidateTitle(title));
        Add("description", TaskValidation.ValidateDescription(description));
        Add("requestorName", TaskValidation.ValidateRequestorName(requestorName));
        Add("requestorEmail", TaskValidation.ValidateRequestorEmail(requestorEmail));
        return errors.Count == 0 ? null : Error.Validation("The task details are not valid.", errors);
    }

    /// <summary>Parses a comma-separated list of status codes; an unknown code is a 400.</summary>
    public static Result<IReadOnlyList<TaskStatusCode>> ParseStatuses(string? csv)
    {
        var list = new List<TaskStatusCode>();
        foreach (var code in FilterParsingList(csv))
        {
            if (!TaskStatusCodeExtensions.TryParse(code.ToUpperInvariant(), out var status))
                return Error.Validation("status", "UNKNOWN_STATUS", $"Unknown status '{code}'.");
            list.Add(status);
        }

        return list;
    }

    private static IEnumerable<string> FilterParsingList(string? csv) =>
        string.IsNullOrWhiteSpace(csv) ? [] : csv.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
}
