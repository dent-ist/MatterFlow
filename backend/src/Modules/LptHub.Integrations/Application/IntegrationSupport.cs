using System.Globalization;
using LptHub.Integrations.Contracts;
using LptHub.Integrations.Domain;
using LptHub.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Integrations.Application;

internal static class IntegrationSupport
{
    public static string Encode(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    public static string Id(int id) => id.ToString(CultureInfo.InvariantCulture);

    public static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static DateTime? Utc(DateTime? value) => value is null ? null : Utc(value.Value);

    public static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    /// <summary>The credentials are complete when Tenant ID, Client ID and a secret are all there.</summary>
    public static bool IsComplete(EntraConnection c) =>
        !string.IsNullOrWhiteSpace(c.TenantId) && !string.IsNullOrWhiteSpace(c.ClientId) && !string.IsNullOrWhiteSpace(c.ClientSecretProtected);

    /// <summary>
    /// The status the list shows: Disabled first (an administrator turned it off), then Not Set Up (no Base URL or Scope, or the Entra ID connection is incomplete),
    /// then the last test: never tested is Not Tested, a successful one Connected, any other Failed.
    /// </summary>
    public static string StatusOf(bool isEnabled, bool connectionComplete, string? baseUrl, string? scope, string? lastOutcome)
    {
        if (!isEnabled)
            return IntegrationStatuses.Disabled;
        if (!connectionComplete || string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(scope))
            return IntegrationStatuses.NotSetUp;
        if (lastOutcome is null)
            return IntegrationStatuses.NotTested;

        return lastOutcome == TestOutcomes.Ok ? IntegrationStatuses.Connected : IntegrationStatuses.Failed;
    }

    /// <summary>The steps of a test with the state of each, given the outcome: the steps before the failing one passed, the failing one failed, the rest were not reached.</summary>
    public static IReadOnlyList<TestStep> StepsOf(string outcome, bool forIntegration)
    {
        string[] keys = forIntegration
            ? ["ENTRA_REACHED", "CREDENTIALS_ACCEPTED", "TOKEN_ISSUED", "API_ANSWERED"]
            : ["ENTRA_REACHED", "CREDENTIALS_ACCEPTED"];
        var failed = TestOutcomes.FailedStep(outcome);
        return [.. keys.Select((key, i) => new TestStep(key, failed < 0 || i < failed ? "PASSED" : i == failed ? "FAILED" : "NOT_REACHED"))];
    }

    public static Error ConcurrencyError() =>
        Error.Conflict(ErrorCodes.ConcurrencyConflict, "This was changed by someone else. Reload and try again.");

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
            : Error.Conflict(ErrorCodes.ConcurrencyConflict, "This was changed by someone else. Reload and try again.", new Dictionary<string, object?> { ["currentRowVersion"] = Encode(current) });
    }

    public static void TrackOriginalRowVersion(DbContext db, object entity, string supplied) =>
        db.Entry(entity).Property("RowVersion").OriginalValue = Convert.FromBase64String(supplied);

    public static bool IsUniqueViolation(DbUpdateException ex) => ex.GetBaseException() is SqlException { Number: 2601 or 2627 };

    /// <summary>The label of an integration type in a sentence (audit lines, messages).</summary>
    public static string TypeLabel(string typeCode) => typeCode switch
    {
        IntegrationTypes.MatterLookup => "Matter Lookup",
        IntegrationTypes.EthicalWall => "Ethical Wall",
        _ => "Other",
    };
}

/// <summary>Collects field errors of one request (field, stable code, message).</summary>
internal sealed class FieldErrors
{
    private readonly Dictionary<string, List<FieldError>> _errors = [];

    public void Add(string field, string code, string message)
    {
        if (!_errors.TryGetValue(field, out var list))
            _errors[field] = list = [];
        list.Add(new FieldError(code, message));
    }

    public Error? ToError() =>
        _errors.Count == 0
            ? null
            : Error.Validation("The request is not valid.", _errors.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<FieldError>)kv.Value));
}
