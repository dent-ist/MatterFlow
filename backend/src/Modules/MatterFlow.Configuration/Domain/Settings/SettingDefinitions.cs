namespace MatterFlow.Configuration.Domain.Settings;

/// <summary>How a setting is stored: in <c>ValueText</c> or in <c>ValueBinary</c> (with content type and hash).</summary>
public enum SettingValueType
{
    Text,
    Binary,
}

/// <summary>
/// The code-side definition of one setting: its key, type, default and the audit events written when it changes or is reset (decision AM.5:
/// defaults live in code, there is no seed row). A future setting is one more definition here plus a section on the settings page.
/// </summary>
/// <param name="Key">Row key, <c>Group.Name</c>.</param>
/// <param name="Type">Text or binary.</param>
/// <param name="DefaultText">The default of a text setting (null for a binary setting: its default is "none", the built-in file stays).</param>
/// <param name="ChangedEvent">Audit event type written when the value is saved.</param>
/// <param name="ResetEvent">Audit event type written when the row is deleted (reset to default).</param>
/// <param name="Label">Short human name used in the audit summary.</param>
public sealed record SettingDefinition(string Key, SettingValueType Type, string? DefaultText, string ChangedEvent, string ResetEvent, string Label);

/// <summary>Registry of the settings the application knows. Unknown keys found in the table are ignored.</summary>
public static class SettingDefinitions
{
    public const string BrandingAppNameKey = "Branding.AppName";

    public const string BrandingIconKey = "Branding.Icon";

    public const string BrandingNameChanged = "SETTINGS_BRANDING_NAME_CHANGED";

    public const string BrandingIconChanged = "SETTINGS_BRANDING_ICON_CHANGED";

    public const string BrandingReset = "SETTINGS_BRANDING_RESET";

    /// <summary>The audited object type of every setting event.</summary>
    public const string AuditObjectType = "AppSetting";

    public static SettingDefinition BrandingAppName { get; } =
        new(BrandingAppNameKey, SettingValueType.Text, BrandingName.Default, BrandingNameChanged, BrandingReset, "Application name");

    public static SettingDefinition BrandingIcon { get; } =
        new(BrandingIconKey, SettingValueType.Binary, null, BrandingIconChanged, BrandingReset, "Application icon");

    public static IReadOnlyList<SettingDefinition> All { get; } = [BrandingAppName, BrandingIcon];
}
