using System.Globalization;
using System.Text.RegularExpressions;

namespace MatterFlow.Reports.Domain.Parameters;

/// <summary>One thing wrong with a parameter definition. <see cref="Parameter"/> is the definition's name (empty for a problem with the list as a whole).</summary>
public sealed record DefinitionIssue(string Parameter, string Field, string Code, string Message);

/// <summary>Stable codes of <see cref="ParameterDefinitionValidator"/>.</summary>
public static class DefinitionIssueCodes
{
    public const string TooMany = "TOO_MANY_PARAMETERS";
    public const string BadName = "BAD_NAME";
    public const string ReservedName = "RESERVED_NAME";
    public const string DuplicateName = "DUPLICATE_NAME";
    public const string LabelRequired = "LABEL_REQUIRED";
    public const string TooLong = "TOO_LONG";
    public const string LookupKindRequired = "LOOKUP_KIND_REQUIRED";
    public const string OptionsKindRequired = "OPTIONS_KIND_REQUIRED";
    public const string OptionsEmpty = "OPTIONS_EMPTY";
    public const string OptionsTooMany = "OPTIONS_TOO_MANY";
    public const string OptionValueInvalid = "OPTION_VALUE_INVALID";
    public const string OptionDuplicate = "OPTION_DUPLICATE";
    public const string OptionsSqlRequired = "OPTIONS_SQL_REQUIRED";
    public const string OptionsSqlInvalid = "OPTIONS_SQL_INVALID";
    public const string OptionsSqlParameters = "OPTIONS_SQL_PARAMETERS";
    public const string RangeInvalid = "RANGE_INVALID";
}

/// <summary>
/// Checks the parameter definitions an author saves (spec 5.1, 5.3, 5.4): names, reserved built-ins, the settings each type needs, and that a
/// SELECT choice list passes the same validator as a report and uses no user parameters. The result of a list query is never stored here:
/// definitions only keep the fixed list or the query text.
/// </summary>
public static partial class ParameterDefinitionValidator
{
    public const int MaxParameters = 100;
    public const int MaxFixedOptions = 200;
    public const int MaxLabelLength = 100;
    public const int MaxHelpLength = 300;
    public const int MaxOptionLabelLength = 200;

    [GeneratedRegex("^[A-Z_][A-Z0-9_]{0,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex NamePattern();

    /// <summary>Upper-cases names and drops what the type does not use, so the stored snapshot is canonical.</summary>
    public static IReadOnlyList<ReportParameterDefinition> Normalize(IReadOnlyList<ReportParameterDefinition> definitions) =>
        definitions.Select(Normalize).ToList();

    private static ReportParameterDefinition Normalize(ReportParameterDefinition d)
    {
        var isChoice = d.Type is ReportParameterType.Single or ReportParameterType.Multi;
        return d with
        {
            Name = (d.Name ?? "").Trim().ToUpperInvariant(),
            Label = (d.Label ?? "").Trim(),
            HelpText = string.IsNullOrWhiteSpace(d.HelpText) ? null : d.HelpText.Trim(),
            LookupKind = d.Type == ReportParameterType.Lookup ? d.LookupKind : null,
            LookupMulti = d.Type == ReportParameterType.Lookup && d.LookupMulti,
            OptionsKind = isChoice ? d.OptionsKind : null,
            Options = isChoice && d.OptionsKind == OptionsKind.Fixed ? d.Options.Select(o => new ParameterOption(o.Value?.Trim() ?? "", o.Label?.Trim() ?? "")).ToList() : [],
            OptionsSql = isChoice && d.OptionsKind == OptionsKind.Query && !string.IsNullOrWhiteSpace(d.OptionsSql) ? d.OptionsSql : null,
            ValueType = isChoice ? d.ValueType : ChoiceValueType.Text,
            MaxLength = d.Type == ReportParameterType.Text ? d.MaxLength : null,
            Min = d.Type == ReportParameterType.Number ? d.Min : null,
            Max = d.Type == ReportParameterType.Number ? d.Max : null,
            IntegerOnly = d.Type == ReportParameterType.Number && d.IntegerOnly,
            MaxSelected = d.IsList ? d.MaxSelected : null,
        };
    }

    public static IReadOnlyList<DefinitionIssue> Validate(IReadOnlyList<ReportParameterDefinition> definitions)
    {
        var issues = new List<DefinitionIssue>();
        if (definitions.Count > MaxParameters)
            issues.Add(new("", "parameters", DefinitionIssueCodes.TooMany, $"A report can have at most {MaxParameters} parameters."));

        var placeholders = new HashSet<string>(StringComparer.Ordinal);
        foreach (var d in definitions.Take(MaxParameters))
        {
            ValidateName(d, placeholders, issues);
            if (d.Label.Length == 0)
                issues.Add(new(d.Name, "label", DefinitionIssueCodes.LabelRequired, "Enter a label."));
            else if (d.Label.Length > MaxLabelLength)
                issues.Add(new(d.Name, "label", DefinitionIssueCodes.TooLong, $"The label can have at most {MaxLabelLength} characters."));
            if (d.HelpText is { Length: > MaxHelpLength })
                issues.Add(new(d.Name, "helpText", DefinitionIssueCodes.TooLong, $"The help text can have at most {MaxHelpLength} characters."));

            switch (d.Type)
            {
                case ReportParameterType.Lookup when d.LookupKind is null:
                    issues.Add(new(d.Name, "lookupKind", DefinitionIssueCodes.LookupKindRequired, "Choose what the lookup searches (matter, client, user, pod, role or task type)."));
                    break;
                case ReportParameterType.Single or ReportParameterType.Multi:
                    ValidateChoice(d, issues);
                    break;
                case ReportParameterType.Number when d.Min is { } min && d.Max is { } max && min > max:
                    issues.Add(new(d.Name, "min", DefinitionIssueCodes.RangeInvalid, "The lowest value is above the highest value."));
                    break;
                case ReportParameterType.Text when d.MaxLength is { } len && (len < 1 || len > ReportParameterDefinition.DefaultMaxTextLength):
                    issues.Add(new(d.Name, "maxLength", DefinitionIssueCodes.RangeInvalid, $"The longest text must be between 1 and {ReportParameterDefinition.DefaultMaxTextLength}."));
                    break;
            }

            if (d.IsList && d.MaxSelected is { } sel && (sel < 1 || sel > ReportParameterDefinition.MaxSelectedCeiling))
                issues.Add(new(d.Name, "maxSelected", DefinitionIssueCodes.RangeInvalid, $"The most selections must be between 1 and {ReportParameterDefinition.MaxSelectedCeiling}."));
        }

        return issues;
    }

    private static void ValidateName(ReportParameterDefinition d, HashSet<string> placeholders, List<DefinitionIssue> issues)
    {
        if (!NamePattern().IsMatch(d.Name))
        {
            issues.Add(new(d.Name, "name", DefinitionIssueCodes.BadName, "Use 1 to 64 letters, digits and underscores, not starting with a digit."));
            return;
        }

        foreach (var placeholder in d.PlaceholderNames)
        {
            if (BuiltInParameters.IsBuiltIn(placeholder))
                issues.Add(new(d.Name, "name", DefinitionIssueCodes.ReservedName, $"{placeholder} is a built-in value of the server and cannot be used as a parameter name."));
            else if (!placeholders.Add(placeholder))
                issues.Add(new(d.Name, "name", DefinitionIssueCodes.DuplicateName, $"{placeholder} is defined more than once."));
        }
    }

    private static void ValidateChoice(ReportParameterDefinition d, List<DefinitionIssue> issues)
    {
        switch (d.OptionsKind)
        {
            case null:
                issues.Add(new(d.Name, "optionsKind", DefinitionIssueCodes.OptionsKindRequired, "Choose where the choices come from: a fixed list or a SELECT."));
                break;

            case OptionsKind.Fixed:
                if (d.Options.Count == 0)
                    issues.Add(new(d.Name, "options", DefinitionIssueCodes.OptionsEmpty, "Add at least one choice."));
                if (d.Options.Count > MaxFixedOptions)
                    issues.Add(new(d.Name, "options", DefinitionIssueCodes.OptionsTooMany, $"A fixed list can have at most {MaxFixedOptions} choices. Use a SELECT for longer lists."));
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (var o in d.Options.Take(MaxFixedOptions))
                {
                    if (o.Value.Length == 0 || o.Value.Length > ReportParameterDefinition.MaxChoiceTextLength || (d.ValueType == ChoiceValueType.Int && !int.TryParse(o.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _)))
                        issues.Add(new(d.Name, "options", DefinitionIssueCodes.OptionValueInvalid, d.ValueType == ChoiceValueType.Int ? $"'{Shorten(o.Value)}' is not a whole number." : "Every choice needs a value of at most 200 characters."));
                    else if (!seen.Add(o.Value))
                        issues.Add(new(d.Name, "options", DefinitionIssueCodes.OptionDuplicate, $"The value '{Shorten(o.Value)}' appears twice."));
                    if (o.Label.Length == 0 || o.Label.Length > MaxOptionLabelLength)
                        issues.Add(new(d.Name, "options", DefinitionIssueCodes.OptionValueInvalid, "Every choice needs a label of at most 200 characters."));
                }

                break;

            case OptionsKind.Query:
                if (string.IsNullOrWhiteSpace(d.OptionsSql))
                {
                    issues.Add(new(d.Name, "optionsSql", DefinitionIssueCodes.OptionsSqlRequired, "Enter the SELECT that returns the columns Value and Label."));
                    break;
                }

                var (compiled, verdict) = ReportSqlCompiler.CompileAndValidate(d.OptionsSql, []);
                foreach (var e in verdict.Errors)
                    issues.Add(new(d.Name, "optionsSql", DefinitionIssueCodes.OptionsSqlInvalid, $"Line {e.Line}: {e.Message}"));
                foreach (var p in compiled.Scan.Placeholders.Where(p => !p.IsBuiltIn))
                    issues.Add(new(d.Name, "optionsSql", DefinitionIssueCodes.OptionsSqlParameters, $"A choice list cannot use the parameter :{p.DisplayName}. Only built-in values such as :CURRENT_USER_ID are allowed."));
                break;
        }
    }

    private static string Shorten(string value) => value.Length <= 30 ? value : value[..30] + "...";
}
