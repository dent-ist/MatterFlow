namespace MatterFlow.Configuration.Domain.Forms.Rules;

/// <summary>Form control types (contracts/form-rules.md section 1).</summary>
public enum FormControl
{
    Text,
    TextArea,
    Number,
    Checkbox,
    Select,
    Radio,
    MultiSelect,
    Date,
    DateTime,
    Url,
    AssetRef,
    UserRef,
    SectionHeading,
    HelpText,

    /// <summary>A control name outside the catalog (reported as <c>UNKNOWN_CONTROL</c> at compile time; never evaluated).</summary>
    Unknown,
}

/// <summary>Classification and wire-name helpers for <see cref="FormControl"/>.</summary>
public static class FormControlExtensions
{
    private static readonly Dictionary<string, FormControl> ByWireName = new(StringComparer.Ordinal)
    {
        ["TEXT"] = FormControl.Text,
        ["TEXTAREA"] = FormControl.TextArea,
        ["NUMBER"] = FormControl.Number,
        ["CHECKBOX"] = FormControl.Checkbox,
        ["SELECT"] = FormControl.Select,
        ["RADIO"] = FormControl.Radio,
        ["MULTISELECT"] = FormControl.MultiSelect,
        ["DATE"] = FormControl.Date,
        ["DATETIME"] = FormControl.DateTime,
        ["URL"] = FormControl.Url,
        ["ASSET_REF"] = FormControl.AssetRef,
        ["USER_REF"] = FormControl.UserRef,
        ["SECTION_HEADING"] = FormControl.SectionHeading,
        ["HELP_TEXT"] = FormControl.HelpText,
    };

    /// <summary>Parses the persisted control name (for example <c>MULTISELECT</c>).</summary>
    public static bool TryParseWireName(string? name, out FormControl control)
    {
        control = default;
        return name is not null && ByWireName.TryGetValue(name, out control);
    }

    /// <summary>The persisted control name.</summary>
    public static string ToWireName(this FormControl control) =>
        control == FormControl.Unknown ? "UNKNOWN" : ByWireName.First(p => p.Value == control).Key;

    /// <summary>True for every control that holds a value (everything except SECTION_HEADING, HELP_TEXT and unknown controls).</summary>
    public static bool IsInput(this FormControl control) =>
        control is not (FormControl.SectionHeading or FormControl.HelpText or FormControl.Unknown);

    /// <summary>TEXT, TEXTAREA and URL.</summary>
    public static bool IsTextFamily(this FormControl control) =>
        control is FormControl.Text or FormControl.TextArea or FormControl.Url;

    /// <summary>SELECT, RADIO and MULTISELECT.</summary>
    public static bool HasOptions(this FormControl control) =>
        control is FormControl.Select or FormControl.Radio or FormControl.MultiSelect;

    /// <summary>ASSET_REF and USER_REF.</summary>
    public static bool IsReference(this FormControl control) =>
        control is FormControl.AssetRef or FormControl.UserRef;
}
