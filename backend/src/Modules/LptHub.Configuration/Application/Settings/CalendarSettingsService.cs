using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text.Json;
using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain.Settings;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Availability;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Configuration.Application.Settings;

/// <summary>The thresholds as the form edits them.</summary>
public sealed record CalendarThresholdValues(
    [property: Required] int MinCoveragePercent,
    [property: Required] int PodMinimumPercent,
    [property: Required] IReadOnlyList<PodMinimum> PodMinimums);

/// <summary>The administration view of the Calendar thresholds: values in force, code defaults, whether a custom value is stored and the row version.</summary>
public sealed record CalendarSettingsAdminView(
    [property: Required] int MinCoveragePercent,
    [property: Required] int PodMinimumPercent,
    [property: Required] IReadOnlyList<PodMinimum> PodMinimums,
    [property: Required] CalendarThresholdValues Defaults,
    [property: Required] bool IsCustom,
    [property: Required] string RowVersion,
    DateTime? UpdatedAtUtc,
    string? UpdatedBy);

/// <summary>Body to change the thresholds. <c>rowVersion</c> is the one read before (empty when nothing is stored).</summary>
public sealed record SetCalendarSettingsRequest(
    [Required] int MinCoveragePercent,
    [Required] int PodMinimumPercent,
    [Required] IReadOnlyList<PodMinimum> PodMinimums,
    [Required(AllowEmptyStrings = true)] string RowVersion);

/// <summary>
/// The Dashboard Calendar thresholds and the firm holiday calendar (epic #1074): stored in <c>dbo.AppSetting</c> (<c>Calendar.Thresholds</c> as JSON and
/// <c>Calendar.FirmHolidayCalendarId</c>), code defaults when nothing is stored, validated on save; a stored value that no longer validates is ignored.
/// </summary>
public sealed class CalendarSettingsService(AppSettingsService settings, IUserDirectory users, IPodDirectory pods) : ICalendarSettings, IFirmHolidayCalendar
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<CalendarThresholdSettings> GetThresholdsAsync(CancellationToken cancellationToken = default) =>
        Parse((await settings.SnapshotAsync(ct: cancellationToken)).GetValueOrDefault(SettingDefinitions.CalendarThresholdsKey)?.Text) ?? CalendarThresholdSettings.Default;

    public async Task<FirmCalendarSetting> GetFirmCalendarAsync(bool fresh = false, CancellationToken cancellationToken = default)
    {
        var row = (await settings.SnapshotAsync(fresh, cancellationToken)).GetValueOrDefault(SettingDefinitions.CalendarFirmHolidayKey);
        var id = int.TryParse(row?.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed : (int?)null;
        return new FirmCalendarSetting(id, row is null ? string.Empty : LookupSupport.FormatRowVersion(row.RowVersion));
    }

    public async Task<Result<FirmCalendarSetting>> SetFirmCalendarAsync(int? calendarId, string rowVersion, CancellationToken cancellationToken = default)
    {
        var version = ParseVersion(rowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (calendarId is null)
        {
            var reset = await settings.ResetAsync(SettingDefinitions.CalendarFirmHoliday, version.Value, cancellationToken);
            return reset.IsFailure ? reset.Error! : await GetFirmCalendarAsync(true, cancellationToken);
        }

        var saved = await settings.SaveTextAsync(SettingDefinitions.CalendarFirmHoliday, calendarId.Value.ToString(CultureInfo.InvariantCulture), version.Value, cancellationToken);
        return saved.IsFailure ? saved.Error! : await GetFirmCalendarAsync(true, cancellationToken);
    }

    public async Task<CalendarSettingsAdminView> GetAdminAsync(CancellationToken ct = default)
    {
        var row = (await settings.SnapshotAsync(fresh: true, ct: ct)).GetValueOrDefault(SettingDefinitions.CalendarThresholdsKey);
        var stored = Parse(row?.Text);
        string? by = null;
        if (row is not null)
            by = (await users.FindAsync(row.UpdatedByUserId, ct))?.DisplayName;
        var shown = stored ?? CalendarThresholdSettings.Default;
        return new CalendarSettingsAdminView(
            shown.MinCoveragePercent,
            shown.PodMinimumPercent,
            shown.PodMinimums,
            ToValues(CalendarThresholdSettings.Default),
            stored is not null,
            row is null ? string.Empty : LookupSupport.FormatRowVersion(row.RowVersion),
            row?.UpdatedAtUtc,
            by);
    }

    public async Task<Result<CalendarSettingsAdminView>> SaveAsync(SetCalendarSettingsRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var version = ParseVersion(request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var value = new CalendarThresholdSettings(request.MinCoveragePercent, request.PodMinimumPercent, [.. (request.PodMinimums ?? []).OrderBy(p => p.PodId)]);
        var problems = value.Validate();
        if (problems.Count > 0)
            return Error.Validation("thresholds", "INVALID", string.Join(' ', problems));
        foreach (var pm in value.PodMinimums)
        {
            if (await pods.FindAsync(pm.PodId, ct) is null)
                return Error.Validation("podMinimums", "UNKNOWN_POD", $"Unknown pod {pm.PodId}.");
        }

        var saved = await settings.SaveTextAsync(SettingDefinitions.CalendarThresholds, JsonSerializer.Serialize(ToValues(value), Json), version.Value, ct);
        return saved.IsFailure ? saved.Error! : await GetAdminAsync(ct);
    }

    public async Task<Result<CalendarSettingsAdminView>> ResetAsync(string? rowVersion, CancellationToken ct = default)
    {
        var version = ParseVersion(rowVersion);
        if (version.IsFailure)
            return version.Error!;
        var reset = await settings.ResetAsync(SettingDefinitions.CalendarThresholds, version.Value, ct);
        return reset.IsFailure ? reset.Error! : await GetAdminAsync(ct);
    }

    private static CalendarThresholdValues ToValues(CalendarThresholdSettings s) => new(s.MinCoveragePercent, s.PodMinimumPercent, s.PodMinimums);

    /// <summary>The stored JSON as settings; null when missing, unreadable or no longer valid.</summary>
    public static CalendarThresholdSettings? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;
        try
        {
            var values = JsonSerializer.Deserialize<CalendarThresholdValues>(text, Json);
            if (values is null)
                return null;
            var result = new CalendarThresholdSettings(values.MinCoveragePercent, values.PodMinimumPercent, values.PodMinimums ?? []);
            return result.Validate().Count == 0 ? result : null;
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
