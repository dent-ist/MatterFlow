using LptHub.Audit.Contracts;
using LptHub.Integrations.Contracts;
using LptHub.Integrations.Domain;
using LptHub.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Integrations.Application;

/// <summary>
/// The integrations list (Administration > Settings > Integrations): add, change, turn on or off, delete and test. At most one Matter Lookup and one Ethical Wall (409 <c>INTEGRATION_TYPE_EXISTS</c>), any
/// number of Other; a Base URL must be https. Every change is audited in the same transaction with the integration's name (never a secret).
/// </summary>
public sealed class IntegrationService(DbContext db, ConnectionAccess connection, IAuditWriter audit, IntegrationTester tester, TokenCache cache)
{
    public async Task<IReadOnlyList<IntegrationResponse>> ListAsync(CancellationToken ct)
    {
        var rows = await db.Set<Integration>().AsNoTracking().OrderBy(i => i.TypeCode == IntegrationTypes.MatterLookup ? 0 : i.TypeCode == IntegrationTypes.EthicalWall ? 1 : 2).ThenBy(i => i.Name).ToListAsync(ct);
        return await ToResponsesAsync(rows, ct);
    }

    public async Task<Result<IntegrationResponse>> GetAsync(int id, CancellationToken ct)
    {
        var row = await db.Set<Integration>().AsNoTracking().SingleOrDefaultAsync(i => i.Id == id, ct);
        return row is null ? NotFound() : (await ToResponsesAsync([row], ct))[0];
    }

    public async Task<Result<IntegrationResponse>> CreateAsync(CreateIntegrationRequest request, CancellationToken ct)
    {
        var fields = new FieldErrors();
        var name = IntegrationSupport.Clean(request.Name);
        var baseUrl = ValidateFields(name, request.TypeCode, request.BaseUrl, request.Scope, fields, out var scope);
        if (fields.ToError() is { } invalid)
            return invalid;
        if (await TypeTakenAsync(request.TypeCode, null, ct))
            return TypeExists(request.TypeCode);
        if (await NameTakenAsync(name!, null, ct))
            return DuplicateName(name!);

        var row = new Integration { Name = name!, TypeCode = request.TypeCode, BaseUrl = baseUrl, Scope = scope, IsEnabled = request.IsEnabled };
        db.Set<Integration>().Add(row);
        audit.Write(IntegrationAudit.About(IntegrationAuditEvents.Created, IntegrationAudit.IntegrationType, () => IntegrationSupport.Id(row.Id), $"Added the {row.Name} integration ({IntegrationSupport.TypeLabel(row.TypeCode)})"));
        var failure = await SaveAsync(row.Name, request.TypeCode, ct);
        return failure is not null ? failure : await GetAsync(row.Id, ct);
    }

    public async Task<Result<IntegrationResponse>> UpdateAsync(int id, UpdateIntegrationRequest request, CancellationToken ct)
    {
        var row = await db.Set<Integration>().SingleOrDefaultAsync(i => i.Id == id, ct);
        if (row is null)
            return NotFound();

        var version = IntegrationSupport.CheckRowVersion(row.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var fields = new FieldErrors();
        var name = IntegrationSupport.Clean(request.Name);
        var baseUrl = ValidateFields(name, request.TypeCode, request.BaseUrl, request.Scope, fields, out var scope);
        if (fields.ToError() is { } invalid)
            return invalid;
        if (request.TypeCode != row.TypeCode && await TypeTakenAsync(request.TypeCode, id, ct))
            return TypeExists(request.TypeCode);
        if (!string.Equals(name, row.Name, StringComparison.OrdinalIgnoreCase) && await NameTakenAsync(name!, id, ct))
            return DuplicateName(name!);

        var changed = new List<string>();
        var oldName = row.Name;
        if (!string.Equals(row.Name, name, StringComparison.Ordinal))
            changed.Add("Name");
        if (row.TypeCode != request.TypeCode)
            changed.Add("Type");
        if (!string.Equals(row.BaseUrl, baseUrl, StringComparison.Ordinal))
            changed.Add("Base URL");
        if (!string.Equals(row.Scope, scope, StringComparison.Ordinal))
            changed.Add("Scope");
        var enabledChanged = row.IsEnabled != request.IsEnabled;
        if (changed.Count == 0 && !enabledChanged)
            return (await ToResponsesAsync([row], ct))[0];

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var endpointChanged = changed.Contains("Type") || changed.Contains("Base URL") || changed.Contains("Scope");
        row.Name = name!;
        row.TypeCode = request.TypeCode;
        row.BaseUrl = baseUrl;
        row.Scope = scope;
        row.IsEnabled = request.IsEnabled;
        if (endpointChanged)
        {
            row.LastTestAtUtc = null;
            row.LastTestByUserId = null;
            row.LastTestOutcome = null;
            row.LastTestTokenSeconds = null;
        }

        if (changed.Count > 0)
            audit.Write(IntegrationAudit.About(IntegrationAuditEvents.Updated, IntegrationAudit.IntegrationType, () => IntegrationSupport.Id(id), $"Changed the {oldName} integration: {JoinAnd(changed)}"));
        if (enabledChanged)
            audit.Write(IntegrationAudit.About(request.IsEnabled ? IntegrationAuditEvents.Enabled : IntegrationAuditEvents.Disabled, IntegrationAudit.IntegrationType, () => IntegrationSupport.Id(id), $"{(request.IsEnabled ? "Enabled" : "Disabled")} the {row.Name} integration"));

        IntegrationSupport.TrackOriginalRowVersion(db, row, request.RowVersion);
        var failure = await SaveAsync(row.Name, row.TypeCode, ct);
        if (failure is not null)
            return failure;

        await transaction.CommitAsync(ct);
        if (endpointChanged)
            cache.Clear();
        return await GetAsync(id, ct);
    }

    /// <summary>Turns an integration on or off (the row menu; reversible, so it does not ask).</summary>
    public async Task<Result<IntegrationResponse>> SetEnabledAsync(int id, bool enabled, CancellationToken ct)
    {
        var row = await db.Set<Integration>().SingleOrDefaultAsync(i => i.Id == id, ct);
        if (row is null)
            return NotFound();
        if (row.IsEnabled == enabled)
            return (await ToResponsesAsync([row], ct))[0];

        row.IsEnabled = enabled;
        audit.Write(IntegrationAudit.About(enabled ? IntegrationAuditEvents.Enabled : IntegrationAuditEvents.Disabled, IntegrationAudit.IntegrationType, () => IntegrationSupport.Id(id), $"{(enabled ? "Enabled" : "Disabled")} the {row.Name} integration"));
        var failure = await SaveAsync(row.Name, row.TypeCode, ct);
        return failure is not null ? failure : await GetAsync(id, ct);
    }

    public async Task<Result> DeleteAsync(int id, CancellationToken ct)
    {
        var row = await db.Set<Integration>().SingleOrDefaultAsync(i => i.Id == id, ct);
        if (row is null)
            return NotFound();

        db.Set<Integration>().Remove(row);
        audit.Write(IntegrationAudit.About(IntegrationAuditEvents.Deleted, IntegrationAudit.IntegrationType, () => IntegrationSupport.Id(id), $"Deleted the {row.Name} integration ({IntegrationSupport.TypeLabel(row.TypeCode)})"));
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            audit.DiscardPending();
            return NotFound();
        }

        cache.Clear();
        return Result.Success();
    }

    public Task<Result<TestResultResponse>> TestAsync(int id, CancellationToken ct) => tester.TestIntegrationAsync(id, ct);

    private async Task<IReadOnlyList<IntegrationResponse>> ToResponsesAsync(IReadOnlyList<Integration> rows, CancellationToken ct)
    {
        if (rows.Count == 0)
            return [];

        var complete = IntegrationSupport.IsComplete(await connection.LoadAsync(ct));
        var names = await tester.NamesAsync(rows.Select(r => r.LastTestByUserId), ct);
        return [.. rows.Select(r =>
        {
            var last = r.LastTestAtUtc is { } at && r.LastTestOutcome is { } outcome
                ? IntegrationTester.Build(outcome, r.LastTestTokenSeconds, at, r.LastTestByUserId is { } u && names.TryGetValue(u, out var n) ? n : null, forIntegration: true)
                : null;
            return new IntegrationResponse(r.Id, r.Name, r.TypeCode, r.BaseUrl, r.Scope, r.IsEnabled, IntegrationSupport.StatusOf(r.IsEnabled, complete, r.BaseUrl, r.Scope, r.LastTestOutcome), last, IntegrationSupport.Encode(r.RowVersion));
        })];
    }

    /// <summary>Validates name, type, Base URL and Scope; returns the cleaned Base URL and Scope.</summary>
    private static string? ValidateFields(string? name, string typeCode, string? baseUrlText, string? scopeText, FieldErrors fields, out string? scope)
    {
        if (name is null)
            fields.Add("name", "REQUIRED", "Enter a name.");
        else if (name.Length > 100)
            fields.Add("name", "TOO_LONG", "A name may have at most 100 characters.");
        if (!IntegrationTypes.IsValid(typeCode))
            fields.Add("typeCode", "INVALID", "Choose Matter Lookup, Ethical Wall or Other.");

        var baseUrl = IntegrationSupport.Clean(baseUrlText);
        if (baseUrl is not null && !IsHttpsAddress(baseUrl))
            fields.Add("baseUrl", "NOT_HTTPS", "Enter an address that starts with https:// and names a server.");

        scope = IntegrationSupport.Clean(scopeText);
        if (scope is not null && (scope.Length < 3 || scope.Any(char.IsWhiteSpace) || scope.Any(char.IsControl)))
            fields.Add("scope", "INVALID", "Enter one scope without spaces, for example api://<app-id>/.default.");
        return baseUrl;
    }

    internal static bool IsHttpsAddress(string text) =>
        text.Length <= 500
        && Uri.TryCreate(text, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && !string.IsNullOrEmpty(uri.Host)
        && string.IsNullOrEmpty(uri.UserInfo)
        && string.IsNullOrEmpty(uri.Fragment);

    private Task<bool> TypeTakenAsync(string typeCode, int? exceptId, CancellationToken ct) =>
        IntegrationTypes.IsSingle(typeCode)
            ? db.Set<Integration>().AnyAsync(i => i.TypeCode == typeCode && (exceptId == null || i.Id != exceptId), ct)
            : Task.FromResult(false);

    private Task<bool> NameTakenAsync(string name, int? exceptId, CancellationToken ct) =>
        db.Set<Integration>().AnyAsync(i => i.Name == name && (exceptId == null || i.Id != exceptId), ct);

    private async Task<Error?> SaveAsync(string name, string typeCode, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            audit.DiscardPending();
            return IntegrationSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (IntegrationSupport.IsUniqueViolation(ex))
        {
            audit.DiscardPending();
            return ex.GetBaseException().Message.Contains("UQ_Integration_FixedType", StringComparison.Ordinal) ? TypeExists(typeCode) : DuplicateName(name);
        }
    }

    private static string JoinAnd(IReadOnlyList<string> items) =>
        items.Count <= 2 ? string.Join(" and ", items) : string.Join(", ", items.Take(items.Count - 1)) + " and " + items[^1];

    private static Error NotFound() => Error.NotFound("Integration not found.");

    private static Error DuplicateName(string name) =>
        new(ErrorType.Conflict, ErrorCodes.DuplicateName, $"An integration named '{name}' already exists.", new Dictionary<string, IReadOnlyList<FieldError>> { ["name"] = [new FieldError(ErrorCodes.DuplicateName, $"An integration named '{name}' already exists.")] });

    private static Error TypeExists(string typeCode)
    {
        var message = $"There is already a {IntegrationSupport.TypeLabel(typeCode)} integration. Edit it instead, or choose Other.";
        return new(ErrorType.Conflict, ErrorCodes.IntegrationTypeExists, message, new Dictionary<string, IReadOnlyList<FieldError>> { ["typeCode"] = [new FieldError(ErrorCodes.IntegrationTypeExists, message)] });
    }
}
