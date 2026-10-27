using System.Security.Cryptography;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.Configuration.Domain.Settings;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Settings;

/// <summary>
/// Reads and writes the typed settings in <c>dbo.AppSetting</c> (decision AM, design section 4). Reads come from a 30 second in-memory copy
/// (<see cref="AppSettingsCache"/>); every write goes to the database with optimistic concurrency, writes a semantic audit event (metadata and
/// hash, never the icon bytes) in the same transaction, and invalidates the copy. A missing row is the normal default state, not an error.
/// Validation of a value is the caller's job (<see cref="BrandingName"/>, <see cref="IconInspector"/>); this class only stores.
/// </summary>
public sealed class AppSettingsService(DbContext db, AppSettingsCache cache, IAuditWriter audit, IClock clock, ICurrentUser currentUser)
{
    private const int SqlDuplicateKey = 2601;
    private const int SqlUniqueConstraint = 2627;

    /// <summary>All known settings that have a row, keyed by setting key. <paramref name="fresh"/> bypasses the 30 second copy (admin screens).</summary>
    public async Task<IReadOnlyDictionary<string, AppSettingValue>> SnapshotAsync(bool fresh = false, CancellationToken ct = default)
    {
        if (!fresh && cache.TryGet() is { } cached)
            return cached;

        var generation = cache.Generation;
        var known = SettingDefinitions.All.Select(d => d.Key).ToArray();
        var rows = await db.Set<AppSetting>().AsNoTracking().Where(s => known.Contains(s.SettingKey)).ToListAsync(ct);
        var snapshot = rows.ToDictionary(
            r => r.SettingKey,
            r => new AppSettingValue(r.SettingKey, r.ValueText, r.ValueBinary, r.ContentType, r.ContentSha256, r.UpdatedAtUtc, r.UpdatedByUserId, r.RowVersion),
            StringComparer.Ordinal);
        if (!fresh)
            cache.Store(snapshot, generation);
        return snapshot;
    }

    /// <summary>The stored value of one setting, or null when it has no row (the code default applies).</summary>
    public async Task<AppSettingValue?> GetAsync(SettingDefinition definition, bool fresh = false, CancellationToken ct = default) =>
        (await SnapshotAsync(fresh, ct)).GetValueOrDefault(definition.Key);

    /// <summary>The text setting's value: the stored text, or the code default when there is no row.</summary>
    public async Task<string> GetTextAsync(SettingDefinition definition, CancellationToken ct = default) =>
        (await GetAsync(definition, ct: ct))?.Text ?? definition.DefaultText ?? string.Empty;

    /// <summary>
    /// Saves a text value. <paramref name="expectedRowVersion"/> is the version the caller saw (null or empty when it saw no row); a mismatch
    /// is a <c>CONCURRENCY_CONFLICT</c>.
    /// </summary>
    public async Task<Result<AppSettingValue>> SaveTextAsync(SettingDefinition definition, string text, byte[]? expectedRowVersion, CancellationToken ct = default)
    {
        if (definition.Type != SettingValueType.Text)
            throw new ArgumentException("Not a text setting.", nameof(definition));

        return await SaveAsync(
            definition,
            expectedRowVersion,
            row =>
            {
                row.ValueText = text;
                row.ValueBinary = null;
                row.ContentType = null;
                row.ContentSha256 = null;
            },
            previous => previous?.Text ?? definition.DefaultText,
            _ => text,
            ct);
    }

    /// <summary>Saves a binary value (already validated by the caller) with its content type and SHA-256.</summary>
    public async Task<Result<AppSettingValue>> SaveBinaryAsync(
        SettingDefinition definition,
        byte[] bytes,
        string contentType,
        byte[]? expectedRowVersion,
        CancellationToken ct = default)
    {
        if (definition.Type != SettingValueType.Binary)
            throw new ArgumentException("Not a binary setting.", nameof(definition));

        var hash = SHA256.HashData(bytes);
        return await SaveAsync(
            definition,
            expectedRowVersion,
            row =>
            {
                row.ValueText = null;
                row.ValueBinary = bytes;
                row.ContentType = contentType;
                row.ContentSha256 = hash;
            },
            previous => previous is { Binary: not null } ? Describe(previous.ContentType, previous.Binary.Length, previous.Sha256) : null,
            _ => Describe(contentType, bytes.Length, hash),
            ct);
    }

    /// <summary>Deletes the row (reset to the code default) and writes <c>SETTINGS_BRANDING_RESET</c>. No row is a success: it is already the default.</summary>
    public async Task<Result> ResetAsync(SettingDefinition definition, byte[]? expectedRowVersion, CancellationToken ct = default)
    {
        var row = await db.Set<AppSetting>().FirstOrDefaultAsync(s => s.SettingKey == definition.Key, ct);
        if (row is null)
            return Result.Success();
        if (!VersionMatches(row.RowVersion, expectedRowVersion))
            return LookupErrors.Concurrency();

        var previous = row.ValueBinary is not null ? Describe(row.ContentType, row.ValueBinary.Length, row.ContentSha256) : row.ValueText;
        db.Entry(row).Property(nameof(AppSetting.RowVersion)).OriginalValue = row.RowVersion;
        db.Set<AppSetting>().Remove(row);
        audit.Write(new AuditEntry
        {
            EventType = definition.ResetEvent,
            ObjectType = SettingDefinitions.AuditObjectType,
            ObjectId = definition.Key,
            FieldKey = definition.Key,
            OldValue = previous,
            NewValue = definition.DefaultText,
            Summary = $"{definition.Label} reset to default",
        });

        var failure = await TrySaveAsync(ct);
        if (failure is not null)
            return failure;

        cache.Invalidate();
        return Result.Success();
    }

    /// <summary>Audit text of a binary value: content type, size and SHA-256 (never the bytes).</summary>
    public static string Describe(string? contentType, int length, byte[]? sha256) =>
        $"{contentType}, {length} bytes, sha256 {(sha256 is null ? string.Empty : Convert.ToHexString(sha256).ToLowerInvariant())}";

    private async Task<Result<AppSettingValue>> SaveAsync(
        SettingDefinition definition,
        byte[]? expectedRowVersion,
        Action<AppSetting> apply,
        Func<AppSettingValue?, string?> before,
        Func<AppSetting, string?> after,
        CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return Error.Unauthenticated("Sign in to change settings.");

        var row = await db.Set<AppSetting>().FirstOrDefaultAsync(s => s.SettingKey == definition.Key, ct);
        AppSettingValue? previous = null;
        if (row is null)
        {
            if (HasVersion(expectedRowVersion))
                return LookupErrors.Concurrency(); // it was reset by someone else after this person loaded the page

            row = new AppSetting { SettingKey = definition.Key };
            db.Set<AppSetting>().Add(row);
        }
        else
        {
            if (!VersionMatches(row.RowVersion, expectedRowVersion))
                return LookupErrors.Concurrency();

            previous = new AppSettingValue(row.SettingKey, row.ValueText, row.ValueBinary, row.ContentType, row.ContentSha256, row.UpdatedAtUtc, row.UpdatedByUserId, row.RowVersion);
            db.Entry(row).Property(nameof(AppSetting.RowVersion)).OriginalValue = row.RowVersion;
        }

        apply(row);
        row.UpdatedAtUtc = clock.UtcNow;
        row.UpdatedByUserId = userId;

        audit.Write(new AuditEntry
        {
            EventType = definition.ChangedEvent,
            ObjectType = SettingDefinitions.AuditObjectType,
            ObjectId = definition.Key,
            FieldKey = definition.Key,
            OldValue = before(previous),
            NewValue = after(row),
            Summary = $"{definition.Label} changed",
        });

        var failure = await TrySaveAsync(ct);
        if (failure is not null)
            return failure;

        cache.Invalidate();
        return new AppSettingValue(row.SettingKey, row.ValueText, row.ValueBinary, row.ContentType, row.ContentSha256, row.UpdatedAtUtc, row.UpdatedByUserId, row.RowVersion);
    }

    private async Task<Error?> TrySaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            return LookupErrors.Concurrency();
        }
        catch (DbUpdateException ex) when (ex.GetBaseException() is SqlException { Number: SqlDuplicateKey or SqlUniqueConstraint })
        {
            return LookupErrors.Concurrency(); // two first saves at the same moment: the second one lost
        }
    }

    private static bool HasVersion(byte[]? version) => version is { Length: > 0 };

    private static bool VersionMatches(byte[] current, byte[]? expected) => HasVersion(expected) && current.AsSpan().SequenceEqual(expected);
}
