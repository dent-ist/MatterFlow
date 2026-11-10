using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain.Settings;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Configuration.Application.Settings;

/// <summary>The gauge settings as the settings form edits them: times as <c>HH:mm</c>, weekdays as ISO numbers (1 Monday to 7 Sunday).</summary>
public sealed record DashboardGaugeValues(
    [Required] string WorkdayStart,
    [Required] string WorkdayEnd,
    [Required] IReadOnlyList<int> WorkDays,
    [Required] string AgeBasis,
    [Required] IReadOnlyList<int> LevelHours,
    [Required] int TasksPerLevel,
    [Required] int CountBonusMax);

/// <summary>The administration view of the Dashboard gauge settings: the values in force, the code defaults, whether a custom value is stored, the row version and the last change.</summary>
/// <param name="RowVersion">Row version (base64) of the stored value; empty when nothing is stored. Send it back on change or reset.</param>
public sealed record DashboardSettingsAdminView(
    [property: Required] DashboardGaugeValues Gauge,
    [property: Required] DashboardGaugeValues Defaults,
    [property: Required] bool IsCustom,
    [property: Required] string RowVersion,
    [property: Required] string TimeZoneId,
    DateTime? UpdatedAtUtc,
    string? UpdatedBy);

/// <summary>Body to change the gauge settings.</summary>
public sealed record SetDashboardGaugeRequest(
    [Required] DashboardGaugeValues Gauge,
    [Required(AllowEmptyStrings = true)] string RowVersion);

/// <summary>The administration view of the capacity battery settings: the value in force, the default, whether a custom value is stored, the row version and the last change.</summary>
/// <param name="CountOffHours">People who are only outside their work hours count as capacity (default true).</param>
/// <param name="RowVersion">Row version (base64) of the stored value; empty when nothing is stored. Send it back on change or reset.</param>
public sealed record DashboardCapacityAdminView(
    [property: Required] bool CountOffHours,
    [property: Required] bool DefaultCountOffHours,
    [property: Required] bool IsCustom,
    [property: Required] string RowVersion,
    DateTime? UpdatedAtUtc,
    string? UpdatedBy);

/// <summary>Body to change the capacity battery settings.</summary>
public sealed record SetDashboardCapacityRequest(
    [Required] bool CountOffHours,
    [Required(AllowEmptyStrings = true)] string RowVersion);

/// <summary>The stored JSON of the capacity settings.</summary>
internal sealed record StoredCapacity(bool? CountOffHours);

/// <summary>
/// The Dashboard gauge settings (Dashboard v4, #1064): one stored JSON value in <c>dbo.AppSetting</c> (<c>Dashboard.Gauge</c>), code defaults when none (no seed row), validated on save.
/// A stored value that no longer validates is ignored and the defaults apply, so a bad row can never break the Dashboard. The time zone is the firm zone (<c>Firm:TimeZoneId</c>).
/// </summary>
public sealed class DashboardSettingsService(AppSettingsService settings, IUserDirectory users, Microsoft.Extensions.Configuration.IConfiguration configuration) : IDashboardSettings
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<DashboardGaugeSettings> GetGaugeAsync(CancellationToken cancellationToken = default) =>
        Parse((await settings.SnapshotAsync(ct: cancellationToken)).GetValueOrDefault(SettingDefinitions.DashboardGaugeKey)?.Text) ?? DashboardGaugeSettings.Default;

    public async Task<DashboardCapacitySettings> GetCapacityAsync(CancellationToken cancellationToken = default) =>
        ParseCapacity((await settings.SnapshotAsync(ct: cancellationToken)).GetValueOrDefault(SettingDefinitions.DashboardCapacityKey)?.Text) ?? DashboardCapacitySettings.Default;

    public async Task<DashboardCapacityAdminView> GetCapacityAdminAsync(CancellationToken ct = default)
    {
        var row = (await settings.SnapshotAsync(fresh: true, ct: ct)).GetValueOrDefault(SettingDefinitions.DashboardCapacityKey);
        var stored = ParseCapacity(row?.Text);
        string? by = null;
        if (row is not null)
            by = (await users.FindAsync(row.UpdatedByUserId, ct))?.DisplayName;
        return new DashboardCapacityAdminView(
            (stored ?? DashboardCapacitySettings.Default).CountOffHours,
            DashboardCapacitySettings.Default.CountOffHours,
            stored is not null,
            row is null ? string.Empty : LookupSupport.FormatRowVersion(row.RowVersion),
            row?.UpdatedAtUtc,
            by);
    }

    public async Task<Result<DashboardCapacityAdminView>> SaveCapacityAsync(SetDashboardCapacityRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var version = ParseVersion(request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        var saved = await settings.SaveTextAsync(SettingDefinitions.DashboardCapacity, JsonSerializer.Serialize(new StoredCapacity(request.CountOffHours), Json), version.Value, ct);
        return saved.IsFailure ? saved.Error! : await GetCapacityAdminAsync(ct);
    }

    public async Task<Result<DashboardCapacityAdminView>> ResetCapacityAsync(string? rowVersion, CancellationToken ct = default)
    {
        var version = ParseVersion(rowVersion);
        if (version.IsFailure)
            return version.Error!;
        var reset = await settings.ResetAsync(SettingDefinitions.DashboardCapacity, version.Value, ct);
        return reset.IsFailure ? reset.Error! : await GetCapacityAdminAsync(ct);
    }

    /// <summary>The stored JSON as capacity settings; null when missing, unreadable or without the flag (the default, count off hours, then applies).</summary>
    public static DashboardCapacitySettings? ParseCapacity(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;
        try
        {
            return JsonSerializer.Deserialize<StoredCapacity>(text, Json) is { CountOffHours: { } flag } ? new DashboardCapacitySettings(flag) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public async Task<DashboardSettingsAdminView> GetAdminAsync(CancellationToken ct = default)
    {
        var row = (await settings.SnapshotAsync(fresh: true, ct: ct)).GetValueOrDefault(SettingDefinitions.DashboardGaugeKey);
        var stored = Parse(row?.Text);
        string? by = null;
        if (row is not null)
            by = (await users.FindAsync(row.UpdatedByUserId, ct))?.DisplayName;
        return new DashboardSettingsAdminView(
            ToValues(stored ?? DashboardGaugeSettings.Default),
            ToValues(DashboardGaugeSettings.Default),
            stored is not null,
            row is null ? string.Empty : LookupSupport.FormatRowVersion(row.RowVersion),
            configuration["Firm:TimeZoneId"] ?? MatterFlow.SharedKernel.Time.UserTimeZone.DefaultFirmZoneId,
            row?.UpdatedAtUtc,
            by);
    }

    public async Task<Result<DashboardSettingsAdminView>> SaveAsync(SetDashboardGaugeRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var version = ParseVersion(request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        var parsed = FromValues(request.Gauge);
        if (parsed.IsFailure)
            return parsed.Error!;

        var saved = await settings.SaveTextAsync(SettingDefinitions.DashboardGauge, JsonSerializer.Serialize(ToValues(parsed.Value), Json), version.Value, ct);
        return saved.IsFailure ? saved.Error! : await GetAdminAsync(ct);
    }

    public async Task<Result<DashboardSettingsAdminView>> ResetAsync(string? rowVersion, CancellationToken ct = default)
    {
        var version = ParseVersion(rowVersion);
        if (version.IsFailure)
            return version.Error!;
        var reset = await settings.ResetAsync(SettingDefinitions.DashboardGauge, version.Value, ct);
        return reset.IsFailure ? reset.Error! : await GetAdminAsync(ct);
    }

    public static DashboardGaugeValues ToValues(DashboardGaugeSettings s) =>
        new(DashboardGaugeSettings.FormatTime(s.WorkdayStart), DashboardGaugeSettings.FormatTime(s.WorkdayEnd), [.. s.WorkDays.Order()], s.AgeBasis, [.. s.LevelHours], s.TasksPerLevel, s.CountBonusMax);

    /// <summary>Validates the form values into settings; a failure names the field.</summary>
    public static Result<DashboardGaugeSettings> FromValues(DashboardGaugeValues? values)
    {
        if (values is null)
            return Error.Validation("gauge", "REQUIRED", "The settings are required.");
        if (!DashboardGaugeSettings.TryParseTime(values.WorkdayStart, out var start))
            return Error.Validation("workdayStart", "INVALID_TIME", "Use a time like 08:00.");
        if (!DashboardGaugeSettings.TryParseTime(values.WorkdayEnd, out var end))
            return Error.Validation("workdayEnd", "INVALID_TIME", "Use a time like 18:00.");

        var settingsValue = new DashboardGaugeSettings(start, end, [.. (values.WorkDays ?? []).Order()], (values.AgeBasis ?? string.Empty).Trim().ToUpperInvariant(), values.LevelHours ?? [], values.TasksPerLevel, values.CountBonusMax);
        var problems = settingsValue.Validate();
        return problems.Count == 0 ? settingsValue : Error.Validation("gauge", "INVALID", string.Join(' ', problems));
    }

    /// <summary>The stored JSON as settings; null when missing, unreadable or no longer valid.</summary>
    public static DashboardGaugeSettings? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;
        try
        {
            var result = FromValues(JsonSerializer.Deserialize<DashboardGaugeValues>(text, Json));
            return result.IsSuccess ? result.Value : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static Result<byte[]?> ParseVersion(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return Result<byte[]?>.Success(null);
        var parsed = LookupSupport.ParseRowVersion(value);
        return parsed is null ? LookupErrors.InvalidRowVersion() : Result<byte[]?>.Success(parsed);
    }
}
