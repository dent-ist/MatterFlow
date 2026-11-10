using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.Configuration.Domain.Settings;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Configuration.Application.Settings;

/// <summary>What everyone (signed in or not) gets: the name and where to find the icon.</summary>
/// <param name="AppName">Application name (the default <c>MatterFlow</c> when none is set).</param>
/// <param name="IconUrl">Relative URL of the custom icon with the version as cache buster, or null when the built-in icons stay in use.</param>
/// <param name="IconKind"><c>png</c>, <c>svg</c> or <c>ico</c> when there is a custom icon, else null.</param>
/// <param name="Version">First 12 hex digits of a SHA-256 over the name and the icon hash; also the ETag.</param>
public sealed record BrandingView(
    [property: Required] string AppName,
    string? IconUrl,
    string? IconKind,
    [property: Required] string Version);

/// <summary>The limits the settings page shows (the numbers come from the server so they are never out of step).</summary>
/// <param name="AppNameMaxLength">Longest application name.</param>
/// <param name="IconMaxBytes">Largest icon file in bytes.</param>
/// <param name="IconMinPixels">Smallest side of a PNG or ICO icon.</param>
/// <param name="IconMaxPngPixels">Largest side of a PNG icon.</param>
/// <param name="IconTypes">Accepted kinds: png, svg, ico.</param>
public sealed record BrandingLimits(
    [property: Required] int AppNameMaxLength,
    [property: Required] int IconMaxBytes,
    [property: Required] int IconMinPixels,
    [property: Required] int IconMaxPngPixels,
    [property: Required] IReadOnlyList<string> IconTypes);

/// <summary>The administration view of the branding: the public values plus row versions, the last change and the limits.</summary>
/// <param name="AppName">Current application name (default when no custom name).</param>
/// <param name="DefaultAppName">The built-in name that Reset restores.</param>
/// <param name="AppNameIsCustom">True when a custom name is stored.</param>
/// <param name="AppNameRowVersion">Row version of the name setting (base64), empty when there is no row; send it back on change or reset.</param>
/// <param name="IconUrl">Relative URL of the custom icon, or null for the built-in icon.</param>
/// <param name="IconKind"><c>png</c>, <c>svg</c> or <c>ico</c> when there is a custom icon.</param>
/// <param name="IconContentType">Stored content type of the custom icon.</param>
/// <param name="IconBytes">Size of the custom icon in bytes.</param>
/// <param name="IconRowVersion">Row version of the icon setting (base64), empty when there is no row.</param>
/// <param name="Version">Version of the branding as everyone sees it.</param>
/// <param name="UpdatedAtUtc">When either value was last saved (null when both are defaults).</param>
/// <param name="UpdatedBy">Display name of the person who saved last.</param>
/// <param name="Limits">The validation limits.</param>
public sealed record BrandingAdminView(
    [property: Required] string AppName,
    [property: Required] string DefaultAppName,
    [property: Required] bool AppNameIsCustom,
    [property: Required] string AppNameRowVersion,
    string? IconUrl,
    string? IconKind,
    string? IconContentType,
    int? IconBytes,
    [property: Required] string IconRowVersion,
    [property: Required] string Version,
    DateTime? UpdatedAtUtc,
    string? UpdatedBy,
    [property: Required] BrandingLimits Limits);

/// <summary>Body to change the application name.</summary>
/// <param name="AppName">The new name (trimmed by the server; 1 to 40 characters, no &lt; or &gt;).</param>
/// <param name="RowVersion">The name's row version from the last read (empty when there was no row).</param>
public sealed record SetBrandingNameRequest([Required(AllowEmptyStrings = true)] string AppName, [Required(AllowEmptyStrings = true)] string RowVersion);

/// <summary>The stored custom icon, ready to be served.</summary>
public sealed record BrandingIcon(byte[] Bytes, string ContentType, string Version);

/// <summary>
/// The application name and icon (decision AM): defaults in code, one stored value each, validated by <see cref="BrandingName"/> and
/// <see cref="IconInspector"/>. Public reads come from the 30 second copy in <see cref="AppSettingsService"/>.
/// </summary>
public sealed class BrandingService(AppSettingsService settings, IUserDirectory users)
{
    public const string IconPath = "/api/v1/branding/icon";

    private static readonly BrandingLimits Limits = new(
        BrandingName.MaxLength,
        IconInspector.MaxBytes,
        IconInspector.MinPixels,
        IconInspector.MaxPngPixels,
        ["png", "svg", "ico"]);

    /// <summary>The public view (anonymous endpoint).</summary>
    public async Task<BrandingView> GetPublicAsync(CancellationToken ct = default)
    {
        var snapshot = await settings.SnapshotAsync(ct: ct);
        var (name, icon) = Pick(snapshot);
        var version = VersionOf(name, icon);
        return new BrandingView(name, icon is null ? null : IconUrl(version), KindOf(icon?.ContentType), version);
    }

    /// <summary>The custom icon with its version, or null when none is stored.</summary>
    public async Task<BrandingIcon?> GetIconAsync(CancellationToken ct = default)
    {
        var snapshot = await settings.SnapshotAsync(ct: ct);
        var (name, icon) = Pick(snapshot);
        return icon is { Binary: not null, ContentType: not null } ? new BrandingIcon(icon.Binary, icon.ContentType, VersionOf(name, icon)) : null;
    }

    /// <summary>The administration view; read from the database, not from the 30 second copy, so the row versions are current.</summary>
    public async Task<BrandingAdminView> GetAdminAsync(CancellationToken ct = default) => await BuildAdminAsync(await settings.SnapshotAsync(fresh: true, ct: ct), ct);

    public async Task<Result<BrandingAdminView>> SetNameAsync(SetBrandingNameRequest request, CancellationToken ct = default)
    {
        var version = ParseVersion(request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        var name = BrandingName.Normalize(request.AppName);
        if (name.IsFailure)
            return name.Error!;

        var saved = await settings.SaveTextAsync(SettingDefinitions.BrandingAppName, name.Value, version.Value, ct);
        return saved.IsFailure ? saved.Error! : await GetAdminAsync(ct);
    }

    public async Task<Result<BrandingAdminView>> SetIconAsync(byte[] bytes, string? rowVersion, CancellationToken ct = default)
    {
        var version = ParseVersion(rowVersion);
        if (version.IsFailure)
            return version.Error!;
        var info = IconInspector.Inspect(bytes);
        if (info.IsFailure)
            return info.Error!;

        var saved = await settings.SaveBinaryAsync(SettingDefinitions.BrandingIcon, bytes, info.Value.ContentType, version.Value, ct);
        return saved.IsFailure ? saved.Error! : await GetAdminAsync(ct);
    }

    public Task<Result<BrandingAdminView>> ResetNameAsync(string? rowVersion, CancellationToken ct = default) => ResetAsync(SettingDefinitions.BrandingAppName, rowVersion, ct);

    public Task<Result<BrandingAdminView>> ResetIconAsync(string? rowVersion, CancellationToken ct = default) => ResetAsync(SettingDefinitions.BrandingIcon, rowVersion, ct);

    private async Task<Result<BrandingAdminView>> ResetAsync(SettingDefinition definition, string? rowVersion, CancellationToken ct)
    {
        var version = ParseVersion(rowVersion);
        if (version.IsFailure)
            return version.Error!;

        var reset = await settings.ResetAsync(definition, version.Value, ct);
        return reset.IsFailure ? reset.Error! : await GetAdminAsync(ct);
    }

    private async Task<BrandingAdminView> BuildAdminAsync(IReadOnlyDictionary<string, AppSettingValue> snapshot, CancellationToken ct)
    {
        var (name, icon) = Pick(snapshot);
        var nameRow = snapshot.GetValueOrDefault(SettingDefinitions.BrandingAppNameKey);
        var version = VersionOf(name, icon);
        var last = new[] { nameRow, icon }.Where(r => r is not null).OrderByDescending(r => r!.UpdatedAtUtc).FirstOrDefault();
        string? updatedBy = null;
        if (last is not null)
            updatedBy = (await users.FindAsync(last.UpdatedByUserId, ct))?.DisplayName;

        return new BrandingAdminView(
            name,
            BrandingName.Default,
            nameRow?.Text is not null,
            nameRow is null ? string.Empty : LookupSupport.FormatRowVersion(nameRow.RowVersion),
            icon is null ? null : IconUrl(version),
            KindOf(icon?.ContentType),
            icon?.ContentType,
            icon?.Binary?.Length,
            icon is null ? string.Empty : LookupSupport.FormatRowVersion(icon.RowVersion),
            version,
            last?.UpdatedAtUtc,
            updatedBy,
            Limits);
    }

    private static (string Name, AppSettingValue? Icon) Pick(IReadOnlyDictionary<string, AppSettingValue> snapshot)
    {
        var name = snapshot.GetValueOrDefault(SettingDefinitions.BrandingAppNameKey)?.Text;
        var icon = snapshot.GetValueOrDefault(SettingDefinitions.BrandingIconKey);
        return (string.IsNullOrWhiteSpace(name) ? BrandingName.Default : name, icon?.Binary is null ? null : icon);
    }

    /// <summary>Twelve hex digits of SHA-256 over the name, a separator and the icon hash: changes whenever either value changes.</summary>
    internal static string VersionOf(string name, AppSettingValue? icon)
    {
        var input = Encoding.UTF8.GetBytes(name).Concat([(byte)0]).Concat(icon?.Sha256 ?? []).ToArray();
        return Convert.ToHexString(SHA256.HashData(input))[..12].ToLowerInvariant();
    }

    private static string IconUrl(string version) => $"{IconPath}?v={version}";

    private static string? KindOf(string? contentType) => contentType switch
    {
        IconInspector.PngContentType => "png",
        IconInspector.SvgContentType => "svg",
        IconInspector.IcoContentType => "ico",
        _ => null,
    };

    /// <summary>An empty row version means "I saw no row"; anything else must be a valid base64 version.</summary>
    private static Result<byte[]?> ParseVersion(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return Result<byte[]?>.Success(null);

        var parsed = LookupSupport.ParseRowVersion(value);
        return parsed is null ? LookupErrors.InvalidRowVersion() : Result<byte[]?>.Success(parsed);
    }
}
