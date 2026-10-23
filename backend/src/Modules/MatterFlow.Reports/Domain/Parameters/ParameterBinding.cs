using System.Data;

namespace MatterFlow.Reports.Domain.Parameters;

/// <summary>How the engine binds a value that is a list.</summary>
public enum ListKind
{
    None,
    Int,
    Text,
}

/// <summary>
/// One typed SQL parameter, ready to become a <c>SqlParameter</c> with an explicit type (never <c>AddWithValue</c>).
/// <see cref="Name"/> is the placeholder name (upper case); the SQL parameter is <c>@p_NAME</c>. A list is a single JSON array string of
/// type <c>nvarchar(max)</c> and <see cref="ListKind"/> tells the rewrite which cast the constant sub-select uses.
/// </summary>
public sealed record BoundParameter(string Name, SqlDbType DbType, int Size, byte Precision, byte Scale, object? Value, ListKind ListKind, string LogValue)
{
    public bool IsNull => Value is null;
}

/// <summary>One thing wrong with a supplied value. <see cref="Name"/> is the parameter (the definition name, not the placeholder).</summary>
public sealed record ParameterError(string Name, string Code, string Message);

/// <summary>Stable error codes of the binder.</summary>
public static class ParameterErrorCodes
{
    public const string Required = "REQUIRED";
    public const string InvalidType = "INVALID_TYPE";
    public const string OutOfRange = "OUT_OF_RANGE";
    public const string TooLong = "TOO_LONG";
    public const string NotInOptions = "NOT_IN_OPTIONS";
    public const string TooMany = "TOO_MANY";
    public const string BuiltInNotAllowed = "BUILTIN_NOT_ALLOWED";
    public const string UnknownParameter = "UNKNOWN_PARAMETER";
    public const string RangeOrder = "RANGE_ORDER";
    public const string InvalidDate = "INVALID_DATE";
    public const string Undefined = "UNDEFINED_PARAMETER";
}

/// <summary>The outcome of binding a run's values.</summary>
public sealed record BindResult(IReadOnlyList<BoundParameter> Parameters, IReadOnlyList<ParameterError> Errors)
{
    public bool IsValid => Errors.Count == 0;
}

/// <summary>The caller's facts that the server supplies as built-in values (spec 5.3).</summary>
public sealed record BuiltInContext(
    int UserId,
    string UserName,
    DateOnly Today,
    DateTime NowUtc,
    IReadOnlyList<int> PodIds,
    int? PrimaryPodId,
    int FirmTimeZoneOffsetMinutes);
