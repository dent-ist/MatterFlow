using System.Text.Json;
using System.Text.RegularExpressions;
using MatterFlow.Configuration.Domain.Forms.Rules;

namespace MatterFlow.Configuration.Domain.Forms;

/// <summary>A problem with a form definition. <see cref="Path"/> locates it for the API (<c>fields[2].key</c>, or <c>form:&lt;fieldKey&gt;</c> style keys are built by the caller).</summary>
/// <param name="Code">Stable code: a contract section 4 code (for example <c>CIRCULAR_DEPENDENCY</c>) or one of <see cref="FormPublishCodes"/>.</param>
/// <param name="FieldKey">The field concerned, when attributable.</param>
/// <param name="Message">English detail.</param>
/// <param name="Path">Request path of the offending member when the problem is a shape error of a draft save; otherwise null.</param>
public sealed record FormDefinitionIssue(string Code, string? FieldKey, string Message, string? Path = null);

/// <summary>Publish-time codes beyond the rule contract's section 4 (architecture 7.5).</summary>
public static class FormPublishCodes
{
    /// <summary>More than <see cref="FormPublishValidator.MaxFilterableFields"/> filterable fields.</summary>
    public const string TooManyFilterableFields = "TOO_MANY_FILTERABLE_FIELDS";

    /// <summary>IsFilterable on a control that cannot be indexed.</summary>
    public const string InvalidFilterableField = "INVALID_FILTERABLE_FIELD";

    /// <summary>The data type of an existing field key changed between versions.</summary>
    public const string FieldTypeChanged = "FIELD_TYPE_CHANGED";

    /// <summary>A default value does not satisfy its own field.</summary>
    public const string InvalidDefault = "INVALID_DEFAULT";

    /// <summary>A field label is missing.</summary>
    public const string LabelRequired = "LABEL_REQUIRED";
}

/// <summary>Shape checks applied whenever a draft is saved. They protect the database constraints; semantic checks wait for publish.</summary>
public static partial class FormDraftChecker
{
    /// <summary>Maximum number of fields in one version.</summary>
    public const int MaxFields = 200;

    /// <summary>Maximum options per field.</summary>
    public const int MaxOptions = 200;

    [GeneratedRegex("^[a-z][a-z0-9_]{0,63}$")]
    private static partial Regex FieldKeyPattern();

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")]
    private static partial Regex OptionKeyPattern();

    /// <summary>Returns the shape problems of a draft (empty when it can be stored).</summary>
    public static IReadOnlyList<FormDefinitionIssue> Check(IReadOnlyList<FormFieldSpec> fields)
    {
        var issues = new List<FormDefinitionIssue>();
        if (fields.Count > MaxFields)
        {
            issues.Add(new FormDefinitionIssue("TOO_MANY_FIELDS", null, $"A form version has at most {MaxFields} fields.", "fields"));
            return issues;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < fields.Count; i++)
        {
            var f = fields[i];
            var at = $"fields[{i}]";
            if (!FieldKeyPattern().IsMatch(f.Key))
            {
                issues.Add(new FormDefinitionIssue(FormDefinitionErrorCode.InvalidFieldKey.ToWireName(), f.Key, "The key must be lowercase letters, digits and underscores, starting with a letter (max 64).", $"{at}.key"));
            }
            else if (!seen.Add(f.Key))
            {
                issues.Add(new FormDefinitionIssue(FormDefinitionErrorCode.DuplicateFieldKey.ToWireName(), f.Key, $"The field key '{f.Key}' is used twice.", $"{at}.key"));
            }

            if (!FormControlExtensions.TryParseWireName(f.Control, out _))
            {
                issues.Add(new FormDefinitionIssue(FormDefinitionErrorCode.UnknownControl.ToWireName(), f.Key, $"'{f.Control}' is not a control type.", $"{at}.control"));
            }

            if (string.IsNullOrWhiteSpace(f.Label) || f.Label.Length > 200)
            {
                issues.Add(new FormDefinitionIssue("INVALID_LABEL", f.Key, "The label is required and at most 200 characters.", $"{at}.label"));
            }

            if (f.HelpText is { Length: > 1000 })
            {
                issues.Add(new FormDefinitionIssue("INVALID_HELP_TEXT", f.Key, "The help text is at most 1000 characters.", $"{at}.helpText"));
            }

            if (f.Section is { } section && !FieldKeyPattern().IsMatch(section))
            {
                issues.Add(new FormDefinitionIssue(FormDefinitionErrorCode.InvalidSection.ToWireName(), f.Key, "The section must be a field key.", $"{at}.section"));
            }

            CheckObject(issues, f.Key, f.Validation, $"{at}.validation");
            CheckObject(issues, f.Key, f.ShowWhen, $"{at}.showWhen");
            CheckObject(issues, f.Key, f.RequiredWhen, $"{at}.requiredWhen");
            CheckOptions(issues, f, at);
        }

        return issues;
    }

    private static void CheckOptions(List<FormDefinitionIssue> issues, FormFieldSpec f, string at)
    {
        if (f.Options.Count > MaxOptions)
        {
            issues.Add(new FormDefinitionIssue("TOO_MANY_OPTIONS", f.Key, $"A field has at most {MaxOptions} options.", $"{at}.options"));
            return;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var j = 0; j < f.Options.Count; j++)
        {
            var o = f.Options[j];
            var oat = $"{at}.options[{j}]";
            if (!OptionKeyPattern().IsMatch(o.Key))
            {
                issues.Add(new FormDefinitionIssue(FormDefinitionErrorCode.InvalidOptionKey.ToWireName(), f.Key, "The option key must start with a letter or digit and use letters, digits, _ . - (max 64).", $"{oat}.key"));
            }
            else if (!seen.Add(o.Key))
            {
                issues.Add(new FormDefinitionIssue(FormDefinitionErrorCode.DuplicateOptionKey.ToWireName(), f.Key, $"The option key '{o.Key}' is used twice.", $"{oat}.key"));
            }

            if (string.IsNullOrWhiteSpace(o.Label) || o.Label.Length > 200)
            {
                issues.Add(new FormDefinitionIssue("INVALID_LABEL", f.Key, "The option label is required and at most 200 characters.", $"{oat}.label"));
            }

            CheckObject(issues, f.Key, o.AvailableWhen, $"{oat}.availableWhen");
        }
    }

    /// <summary>The JSON columns are checked with ISJSON; a bare string or number would be rejected, and it is not a valid rule or validation object anyway.</summary>
    private static void CheckObject(List<FormDefinitionIssue> issues, string key, JsonElement? value, string path)
    {
        if (value is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined or JsonValueKind.Object) })
        {
            issues.Add(new FormDefinitionIssue(FormDefinitionErrorCode.SchemaViolation.ToWireName(), key, "Expected a JSON object.", path));
        }
    }
}

/// <summary>Publish-time validation of a form version (architecture 7.5; rule contract section 4 via <see cref="FormSchema.Compile"/>).</summary>
public static class FormPublishValidator
{
    /// <summary>Maximum filterable fields per form version.</summary>
    public const int MaxFilterableFields = 5;

    /// <summary>Result of <see cref="Validate"/>.</summary>
    /// <param name="Schema">The compiled schema when the definition is valid, otherwise null.</param>
    /// <param name="Issues">All problems found.</param>
    public sealed record Outcome(FormSchema? Schema, IReadOnlyList<FormDefinitionIssue> Issues)
    {
        /// <summary>True when the definition may be published.</summary>
        public bool IsValid => Schema is not null && Issues.Count == 0;
    }

    /// <summary>
    /// Validates the definition. <paramref name="priorControls"/> maps each field key used by earlier (published or retired) versions of the same
    /// definition to its control, so a key cannot change data type.
    /// </summary>
    public static Outcome Validate(IReadOnlyList<FormFieldSpec> specs, IReadOnlyDictionary<string, FormControl> priorControls)
    {
        var issues = new List<FormDefinitionIssue>();
        var definitions = FormSpecs.ToDefinitions(specs);
        var compiled = FormSchema.Compile(definitions);
        issues.AddRange(compiled.Errors.Select(e => new FormDefinitionIssue(e.Code.ToWireName(), e.FieldKey, e.Message)));

        foreach (var spec in specs.Where(s => string.IsNullOrWhiteSpace(s.Label)))
        {
            issues.Add(new FormDefinitionIssue(FormPublishCodes.LabelRequired, spec.Key, $"The field '{spec.Key}' needs a label."));
        }

        CheckFilterable(definitions, issues);
        CheckTypeChanges(definitions, priorControls, issues);
        if (compiled.Schema is not null)
        {
            CheckDefaults(specs, definitions, issues);
        }

        return new Outcome(issues.Count == 0 ? compiled.Schema : null, issues);
    }

    private static void CheckFilterable(IReadOnlyList<FormFieldDefinition> definitions, List<FormDefinitionIssue> issues)
    {
        var filterable = definitions.Where(d => d.IsFilterable).ToList();
        foreach (var d in filterable.Where(d => !d.Control.IsInput() && d.Control != FormControl.Unknown))
        {
            issues.Add(new FormDefinitionIssue(FormPublishCodes.InvalidFilterableField, d.Key, $"The {d.Control.ToWireName()} field '{d.Key}' holds no value and cannot be filterable."));
        }

        if (filterable.Count > MaxFilterableFields)
        {
            issues.Add(new FormDefinitionIssue(FormPublishCodes.TooManyFilterableFields, null, $"At most {MaxFilterableFields} fields can be filterable; this version has {filterable.Count}."));
        }
    }

    private static void CheckTypeChanges(IReadOnlyList<FormFieldDefinition> definitions, IReadOnlyDictionary<string, FormControl> priorControls, List<FormDefinitionIssue> issues)
    {
        foreach (var d in definitions)
        {
            if (d.Control != FormControl.Unknown && priorControls.TryGetValue(d.Key, out var previous) && DataType(previous) != DataType(d.Control))
            {
                issues.Add(new FormDefinitionIssue(FormPublishCodes.FieldTypeChanged, d.Key, $"The field '{d.Key}' was {previous.ToWireName()} in an earlier version; its data type cannot change to {d.Control.ToWireName()}."));
            }
        }
    }

    /// <summary>Controls that store the same kind of value are interchangeable between versions.</summary>
    public static string DataType(FormControl control) => control switch
    {
        FormControl.Text or FormControl.TextArea or FormControl.Url => "text",
        FormControl.Select or FormControl.Radio => "option",
        FormControl.MultiSelect => "options",
        FormControl.Number => "number",
        FormControl.Checkbox => "bool",
        FormControl.Date => "date",
        FormControl.DateTime => "datetime",
        FormControl.AssetRef => "asset",
        FormControl.UserRef => "user",
        _ => "none",
    };

    /// <summary>
    /// Defaults are validated as the evaluator would validate a submission, with every visibility and availability rule switched off so that a default
    /// is checked even when it is currently hidden (type, range, length, pattern and option membership still apply).
    /// </summary>
    private static void CheckDefaults(IReadOnlyList<FormFieldSpec> specs, IReadOnlyList<FormFieldDefinition> definitions, List<FormDefinitionIssue> issues)
    {
        var withDefaults = specs.Where(s => s.Default is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) }).ToList();
        if (withDefaults.Count == 0)
        {
            return;
        }

        var flat = definitions.Select(d => d with
        {
            ShowWhen = null,
            RequiredWhen = null,
            Section = null,
            Options = [.. d.Options.Select(o => o with { AvailableWhen = null })],
        });
        var compiled = FormSchema.Compile(flat);
        if (compiled.Schema is null)
        {
            return;
        }

        var values = FormValues.From(withDefaults.Select(s => KeyValuePair.Create(s.Key, s.Default!.Value)));
        var result = FormEvaluator.Evaluate(compiled.Schema, values, FormEvaluationMode.Draft);
        foreach (var error in result.Errors)
        {
            issues.Add(new FormDefinitionIssue(FormPublishCodes.InvalidDefault, error.FieldKey, $"The default of '{error.FieldKey}' is not valid ({error.Code.ToWireName()}): {error.Message}"));
        }
    }
}
