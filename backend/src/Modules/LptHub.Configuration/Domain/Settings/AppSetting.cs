namespace MatterFlow.Configuration.Domain.Settings;

/// <summary>
/// One row of <c>dbo.AppSetting</c>: a thin key/value store for administrator-maintained settings (script 48). The type of a value is defined in
/// code (<see cref="SettingDefinitions"/>), not in SQL. A missing row is the normal "use the code default" state. Not an <c>Entity&lt;T&gt;</c>:
/// the key is the text <see cref="SettingKey"/>. Changes are audited by explicit semantic events (never the bytes), so the type carries no
/// <c>[Audited]</c> attribute.
/// </summary>
public class AppSetting
{
    public string SettingKey { get; set; } = string.Empty;

    public string? ValueText { get; set; }

    public byte[]? ValueBinary { get; set; }

    public string? ContentType { get; set; }

    /// <summary>SHA-256 of <see cref="ValueBinary"/>; the source of the ETag/version of the public branding endpoints.</summary>
    public byte[]? ContentSha256 { get; set; }

    public DateTime UpdatedAtUtc { get; set; }

    public int UpdatedByUserId { get; set; }

    /// <summary>SQL Server rowversion of this setting (optimistic concurrency).</summary>
    public byte[] RowVersion { get; set; } = [];
}
