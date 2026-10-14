using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MatterFlow.Configuration.Domain.Forms.Rules;

/// <summary>Result of evaluating a submission against a <see cref="FormSchema"/>.</summary>
/// <param name="Visible">Visibility of every field (headings and help text included).</param>
/// <param name="Required">Required state of every field.</param>
/// <param name="Options">Offered option keys (declared order) of every SELECT, RADIO and MULTISELECT field.</param>
/// <param name="Errors">Validation errors; at most one per field, plus UNKNOWN_FIELD per unknown key.</param>
/// <param name="Normalized">Values to persist: one entry per visible, non-empty, type-valid input field. Persist only when <paramref name="Errors"/> is empty.</param>
public sealed record FormEvaluationResult(
    IReadOnlyDictionary<string, bool> Visible,
    IReadOnlyDictionary<string, bool> Required,
    IReadOnlyDictionary<string, IReadOnlyList<string>> Options,
    IReadOnlyList<FormFieldError> Errors,
    FormValues Normalized)
{
    /// <summary>True when there are no errors.</summary>
    public bool IsValid => Errors.Count == 0;
}

/// <summary>The authoritative, pure rule evaluator and value validator (contracts/form-rules.md section 3).</summary>
public static class FormEvaluator
{
    private static readonly TimeSpan RegexTimeout = TimeSpan.FromMilliseconds(250);
    private static readonly ConcurrentDictionary<string, Regex?> PatternCache = new(StringComparer.Ordinal);

    /// <summary>Evaluates visibility, required state and offered options, validates the values and builds the normalized value set.</summary>
    public static FormEvaluationResult Evaluate(FormSchema schema, FormValues values, FormEvaluationMode mode = FormEvaluationMode.Submit)
    {
        ArgumentNullException.ThrowIfNull(schema);
        ArgumentNullException.ThrowIfNull(values);

        var fields = schema.Fields;
        var visible = new bool[fields.Count];
        var required = new bool[fields.Count];
        var effective = new JsonElement?[fields.Count];
        var offered = new List<string>?[fields.Count];
        var errors = new List<FormFieldError>();
        var normalized = new JsonElement?[fields.Count];

        foreach (var i in schema.Order)
        {
            var field = fields[i];
            var def = field.Definition;
            var ctx = new Context(schema, effective);

            var sectionVisible = field.SectionIndex < 0 || visible[field.SectionIndex];
            visible[i] = sectionVisible && (field.ShowWhen is null || ctx.Evaluate(field.ShowWhen));

            if (def.Control.HasOptions())
            {
                offered[i] = [.. field.Options.Where(o => o.AvailableWhen is null || ctx.Evaluate(o.AvailableWhen)).Select(o => o.Key)];
            }

            if (!visible[i] || !def.Control.IsInput())
            {
                continue;
            }

            required[i] = def.Required || (field.RequiredWhen is not null && ctx.Evaluate(field.RequiredWhen));

            values.TryGetValue(def.Key, out var raw);
            if (FormValueRules.IsEmpty(raw))
            {
                if (required[i] && mode == FormEvaluationMode.Submit)
                {
                    errors.Add(new FormFieldError(def.Key, FormErrorCode.Required, "A value is required."));
                }

                continue;
            }

            if (!FormValueRules.IsValidType(def.Control, raw))
            {
                errors.Add(new FormFieldError(def.Key, FormErrorCode.InvalidType, $"Value is not a valid {def.Control.ToWireName()} value."));
                continue;
            }

            effective[i] = raw;
            normalized[i] = raw;
            ValidateValue(def, raw, offered[i], errors);
        }

        foreach (var key in values.Keys)
        {
            if (!schema.TryGetIndex(key, out var index) || !fields[index].Definition.Control.IsInput())
            {
                errors.Add(new FormFieldError(key, FormErrorCode.UnknownField, $"'{key}' is not an input field of this form."));
            }
        }

        return Build(schema, visible, required, offered, errors, normalized);
    }

    private static FormEvaluationResult Build(
        FormSchema schema,
        bool[] visible,
        bool[] required,
        List<string>?[] offered,
        List<FormFieldError> errors,
        JsonElement?[] normalized)
    {
        var visibleMap = new Dictionary<string, bool>(StringComparer.Ordinal);
        var requiredMap = new Dictionary<string, bool>(StringComparer.Ordinal);
        var optionMap = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        var kept = new List<KeyValuePair<string, JsonElement>>();
        foreach (var field in schema.Fields)
        {
            var key = field.Definition.Key;
            visibleMap[key] = visible[field.Index];
            requiredMap[key] = required[field.Index];
            if (offered[field.Index] is { } list)
            {
                optionMap[key] = list;
            }

            if (normalized[field.Index] is { } value)
            {
                kept.Add(new KeyValuePair<string, JsonElement>(key, value));
            }
        }

        errors.Sort((a, b) =>
        {
            var byField = string.CompareOrdinal(a.FieldKey, b.FieldKey);
            return byField != 0 ? byField : string.CompareOrdinal(a.Code.ToWireName(), b.Code.ToWireName());
        });
        return new FormEvaluationResult(visibleMap, requiredMap, optionMap, errors, FormValues.From(kept));
    }

    private static void ValidateValue(FormFieldDefinition def, JsonElement value, List<string>? offered, List<FormFieldError> errors)
    {
        var validation = def.Validation;
        if (validation is not null)
        {
            if (def.Control is FormControl.Number or FormControl.Date && !InRange(def.Control, value, validation))
            {
                errors.Add(new FormFieldError(def.Key, FormErrorCode.OutOfRange, "Value is outside the allowed range."));
                return;
            }

            if (def.Control.IsTextFamily())
            {
                var text = value.GetString()!;
                if (validation.MaxLength is { } max && text.Length > max)
                {
                    errors.Add(new FormFieldError(def.Key, FormErrorCode.TooLong, $"Value is longer than {max} characters."));
                    return;
                }

                if (validation.Pattern is { } pattern && !MatchesPattern(pattern, text))
                {
                    errors.Add(new FormFieldError(def.Key, FormErrorCode.Pattern, "Value does not match the required pattern."));
                    return;
                }
            }
        }

        if (def.Control.HasOptions() && offered is not null && !OptionsAllowed(def.Control, value, offered))
        {
            errors.Add(new FormFieldError(def.Key, FormErrorCode.OptionNotAllowed, "Selected option is not available."));
        }
    }

    private static bool OptionsAllowed(FormControl control, JsonElement value, List<string> offered)
    {
        if (control == FormControl.MultiSelect)
        {
            return value.EnumerateArray().All(e => offered.Contains(e.GetString()!, StringComparer.Ordinal));
        }

        return offered.Contains(value.GetString()!, StringComparer.Ordinal);
    }

    private static bool InRange(FormControl control, JsonElement value, FormFieldValidation validation)
    {
        if (control == FormControl.Number)
        {
            var number = value.GetDouble();
            return !(IsNumber(validation.Min, out var min) && number < min) &&
                   !(IsNumber(validation.Max, out var max) && number > max);
        }

        var date = value.GetString()!;
        return !(IsString(validation.Min, out var minDate) && string.CompareOrdinal(date, minDate) < 0) &&
               !(IsString(validation.Max, out var maxDate) && string.CompareOrdinal(date, maxDate) > 0);
    }

    private static bool IsNumber(JsonElement? bound, out double number)
    {
        number = 0;
        return bound is { ValueKind: JsonValueKind.Number } e && e.TryGetDouble(out number);
    }

    private static bool IsString(JsonElement? bound, out string text)
    {
        text = string.Empty;
        if (bound is { ValueKind: JsonValueKind.String } e)
        {
            text = e.GetString()!;
            return true;
        }

        return false;
    }

    /// <summary>Portable subset (contracts/form-rules.md 3.1), unanchored search. A pattern outside the subset (publish rejects it) or a timeout counts as no match.</summary>
    private static bool MatchesPattern(string pattern, string text)
    {
        var regex = PatternCache.GetOrAdd(pattern, p =>
        {
            try
            {
                return PortablePattern.TryTranslate(p, out var translated)
                    ? new Regex(translated, RegexOptions.ECMAScript, RegexTimeout)
                    : null;
            }
            catch (ArgumentException)
            {
                return null;
            }
        });
        if (regex is null)
        {
            return false;
        }

        try
        {
            return regex.IsMatch(text);
        }
        catch (RegexMatchTimeoutException)
        {
            return false;
        }
    }

    /// <summary>Rule evaluation over effective values (null = hidden, empty or type-invalid).</summary>
    private readonly struct Context
    {
        private readonly FormSchema _schema;
        private readonly JsonElement?[] _effective;

        public Context(FormSchema schema, JsonElement?[] effective)
        {
            _schema = schema;
            _effective = effective;
        }

        public bool Evaluate(RuleNode node) => node switch
        {
            GroupRule { IsAnd: true } g => g.Args.All(Evaluate),
            GroupRule g => g.Args.Any(Evaluate),
            NotRule n => !Evaluate(n.Arg),
            LeafRule leaf => EvaluateLeaf(leaf),
            _ => false,
        };

        private bool EvaluateLeaf(LeafRule leaf)
        {
            _schema.TryGetIndex(leaf.Field, out var index);
            var control = _schema.Fields[index].Definition.Control;
            var value = _effective[index];

            if (value is not { } v)
            {
                return leaf.Op is RuleOperator.Neq or RuleOperator.NotIn or RuleOperator.IsEmpty;
            }

            return leaf.Op switch
            {
                RuleOperator.IsEmpty => false,
                RuleOperator.IsNotEmpty => true,
                RuleOperator.IsTrue => v.ValueKind == JsonValueKind.True,
                RuleOperator.IsFalse => v.ValueKind == JsonValueKind.False,
                RuleOperator.Contains => control == FormControl.MultiSelect && leaf.Literals[0].ValueKind == JsonValueKind.String &&
                    v.EnumerateArray().Any(e => string.Equals(e.GetString(), leaf.Literals[0].GetString(), StringComparison.Ordinal)),
                RuleOperator.Eq => Compare(control, v, leaf.Literals[0]) == 0,
                RuleOperator.Neq => Compare(control, v, leaf.Literals[0]) != 0,
                RuleOperator.Gt => Compare(control, v, leaf.Literals[0]) is > 0,
                RuleOperator.Gte => Compare(control, v, leaf.Literals[0]) is >= 0,
                RuleOperator.Lt => Compare(control, v, leaf.Literals[0]) is < 0,
                RuleOperator.Lte => Compare(control, v, leaf.Literals[0]) is <= 0,
                RuleOperator.In => leaf.Literals.Any(l => Compare(control, v, l) == 0),
                RuleOperator.NotIn => !leaf.Literals.Any(l => Compare(control, v, l) == 0),
                _ => false,
            };
        }

        /// <summary>0 = equal, negative/positive = ordering, null = not comparable (never equal, no ordering).</summary>
        private static int? Compare(FormControl control, JsonElement value, JsonElement literal)
        {
            switch (control)
            {
                case FormControl.Text or FormControl.TextArea or FormControl.Url:
                    return literal.ValueKind == JsonValueKind.String &&
                           FormValueRules.AsciiEqualsIgnoreCase(value.GetString()!, literal.GetString()!)
                        ? 0
                        : null;
                case FormControl.Select or FormControl.Radio:
                    return literal.ValueKind == JsonValueKind.String &&
                           string.Equals(value.GetString(), literal.GetString(), StringComparison.Ordinal)
                        ? 0
                        : null;
                case FormControl.Number or FormControl.AssetRef or FormControl.UserRef:
                    return literal.ValueKind == JsonValueKind.Number && literal.TryGetDouble(out var l)
                        ? value.GetDouble().CompareTo(l)
                        : null;
                case FormControl.Date:
                    return literal.ValueKind == JsonValueKind.String
                        ? Math.Sign(string.CompareOrdinal(value.GetString(), literal.GetString()))
                        : null;
                default:
                    return null;
            }
        }
    }
}
