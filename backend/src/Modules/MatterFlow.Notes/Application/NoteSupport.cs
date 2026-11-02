using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Notes.Application;

internal static class NoteSupport
{
    public const string TagNameUnique = "UQ_NoteTag_Name";
    public const string FirmTemplateNameUnique = "UQ_NoteTemplate_FirmName";
    public const string MatterTemplateNameUnique = "UQ_NoteTemplate_MatterName";


    public static Error NotFound(string what) => Error.NotFound($"{what} not found.");

    public static string Encode(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    public static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static DateTime? Utc(DateTime? value) => value is null ? null : Utc(value.Value);

    public static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    public static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);

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

    public static bool IsUniqueViolation(DbUpdateException exception, string constraint) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 } sql && sql.Message.Contains(constraint, StringComparison.OrdinalIgnoreCase);

    public static Result<(PageRequest Page, IReadOnlyList<SortField> Sort)> PagingOf(int? page, int? pageSize, string? sort, IReadOnlyCollection<string> allowedSort)
    {
        var p = PageRequest.Create(page, pageSize);
        if (p.IsFailure)
            return p.Error!;

        var s = SortSpec.Parse(sort, allowedSort);
        if (s.IsFailure)
            return s.Error!;

        return (p.Value, s.Value);
    }

    /// <summary>
    /// Queues one audit event per changed field (<c>FIELD_CHANGED</c>, old and new text) about an object of a matter. <paramref name="before"/> and <paramref name="after"/>
    /// hold the audited fields as text; a field that is equal in both is not written.
    /// </summary>
    public static void WriteFieldChanges(IAuditWriter audit, string objectType, string objectId, int matterId, IReadOnlyDictionary<string, string?> before, IReadOnlyDictionary<string, string?> after)
    {
        foreach (var (key, value) in after)
        {
            before.TryGetValue(key, out var old);
            if (string.Equals(old, value, StringComparison.Ordinal))
                continue;

            audit.Write(new AuditEntry
            {
                EventType = AuditEventTypes.FieldChanged,
                ObjectType = objectType,
                ObjectId = objectId,
                MatterId = matterId,
                FieldKey = key,
                OldValue = old,
                NewValue = value,
            });
        }
    }
}
