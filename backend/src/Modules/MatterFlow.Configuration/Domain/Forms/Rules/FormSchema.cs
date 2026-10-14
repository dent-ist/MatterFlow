using System.Text.Json;

namespace MatterFlow.Configuration.Domain.Forms.Rules;

/// <summary>Outcome of <see cref="FormSchema.Compile"/>: a usable schema, or the definition errors.</summary>
public sealed class FormSchemaCompileResult
{
    internal FormSchemaCompileResult(FormSchema? schema, IReadOnlyList<FormDefinitionError> errors)
    {
        Schema = schema;
        Errors = errors;
    }

    /// <summary>The compiled schema; null when the definition is invalid.</summary>
    public FormSchema? Schema { get; }

    /// <summary>Definition errors (empty when valid).</summary>
    public IReadOnlyList<FormDefinitionError> Errors { get; }

    /// <summary>True when the definition passed every contract section 4 check.</summary>
    public bool IsValid => Schema is not null;
}

internal sealed class CompiledOption
{
    public CompiledOption(string key, RuleNode? availableWhen)
    {
        Key = key;
        AvailableWhen = availableWhen;
    }

    public string Key { get; }

    public RuleNode? AvailableWhen { get; }
}

internal sealed class CompiledField
{
    public CompiledField(FormFieldDefinition definition, int index)
    {
        Definition = definition;
        Index = index;
    }

    public FormFieldDefinition Definition { get; }

    public int Index { get; }

    public int SectionIndex { get; set; } = -1;

    public RuleNode? ShowWhen { get; set; }

    public RuleNode? RequiredWhen { get; set; }

    public IReadOnlyList<CompiledOption> Options { get; set; } = [];
}

/// <summary>
/// An immutable, validated form definition ready for evaluation (publish-time validation per contracts/form-rules.md
/// section 4 has passed). Safe to cache per form version and share across threads.
/// </summary>
public sealed class FormSchema
{
    private readonly Dictionary<string, int> _indexByKey;

    private FormSchema(IReadOnlyList<CompiledField> fields, int[] order)
    {
        Fields = fields;
        Order = order;
        _indexByKey = fields.ToDictionary(f => f.Definition.Key, f => f.Index, StringComparer.Ordinal);
    }

    /// <summary>The fields in display order.</summary>
    public IReadOnlyList<FormFieldDefinition> Definitions => [.. Fields.Select(f => f.Definition)];

    internal IReadOnlyList<CompiledField> Fields { get; }

    /// <summary>Evaluation order: every field after everything its rules reference (ties keep display order).</summary>
    internal int[] Order { get; }

    /// <summary>Validates and compiles a form definition (publish-time check).</summary>
    public static FormSchemaCompileResult Compile(IEnumerable<FormFieldDefinition> fields)
    {
        var compiler = new Compiler([.. fields]);
        return compiler.Run();
    }

    internal bool TryGetIndex(string key, out int index) => _indexByKey.TryGetValue(key, out index);

    private sealed class Compiler
    {
        private readonly IReadOnlyList<FormFieldDefinition> _defs;
        private readonly List<FormDefinitionError> _errors = [];
        private readonly Dictionary<string, int> _index = new(StringComparer.Ordinal);
        private readonly List<CompiledField> _fields = [];
        private HashSet<int>[] _deps = [];

        public Compiler(IReadOnlyList<FormFieldDefinition> defs)
        {
            _defs = defs;
        }

        public FormSchemaCompileResult Run()
        {
            if (CheckDuplicateKeys())
            {
                return new FormSchemaCompileResult(null, _errors);
            }

            for (var i = 0; i < _defs.Count; i++)
            {
                _index[_defs[i].Key] = i;
                _fields.Add(new CompiledField(_defs[i], i));
            }

            _deps = [.. _defs.Select(_ => new HashSet<int>())];

            foreach (var field in _fields)
            {
                CheckSection(field);
                CheckOptionKeys(field);
                field.ShowWhen = CompileRule(field, field.Definition.ShowWhen, "showWhen");
                field.RequiredWhen = CompileRule(field, field.Definition.RequiredWhen, "requiredWhen");
                field.Options = [.. field.Definition.Options.Select(o =>
                    new CompiledOption(o.Key, CompileRule(field, o.AvailableWhen, $"option '{o.Key}' availableWhen")))];
            }

            var order = TopologicalOrder();
            if (order is null)
            {
                Add(FormDefinitionErrorCode.CircularDependency, null, "The rule dependency graph contains a cycle.");
            }

            if (_errors.Count > 0)
            {
                return new FormSchemaCompileResult(null, _errors);
            }

            return new FormSchemaCompileResult(new FormSchema(_fields, order!), []);
        }

        private bool CheckDuplicateKeys()
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var reported = new HashSet<string>(StringComparer.Ordinal);
            foreach (var def in _defs)
            {
                if (!seen.Add(def.Key) && reported.Add(def.Key))
                {
                    Add(FormDefinitionErrorCode.DuplicateFieldKey, def.Key, $"Field key '{def.Key}' is used more than once.");
                }
            }

            return _errors.Count > 0;
        }

        private void CheckSection(CompiledField field)
        {
            var section = field.Definition.Section;
            if (section is null)
            {
                return;
            }

            if (_index.TryGetValue(section, out var target) &&
                target != field.Index &&
                _defs[target].Control == FormControl.SectionHeading)
            {
                field.SectionIndex = target;
                _deps[field.Index].Add(target);
                return;
            }

            Add(FormDefinitionErrorCode.InvalidSection, field.Definition.Key, $"Section '{section}' is not a different SECTION_HEADING field.");
        }

        private void CheckOptionKeys(CompiledField field)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var option in field.Definition.Options)
            {
                if (!seen.Add(option.Key))
                {
                    Add(FormDefinitionErrorCode.DuplicateOptionKey, field.Definition.Key, $"Option key '{option.Key}' is used more than once.");
                    return;
                }
            }
        }

        private RuleNode? CompileRule(CompiledField owner, JsonElement? raw, string where)
        {
            if (raw is not { } element || element.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
            {
                return null;
            }

            var key = owner.Definition.Key;
            if (!RuleParser.TryParse(element, out var node))
            {
                Add(FormDefinitionErrorCode.SchemaViolation, key, $"The {where} rule of '{key}' does not match the rule schema.");
                return null;
            }

            if (node!.Depth > RuleParser.MaxDepth)
            {
                Add(FormDefinitionErrorCode.RuleTooDeep, key, $"The {where} rule of '{key}' is deeper than {RuleParser.MaxDepth}.");
            }

            foreach (var leaf in node.Leaves())
            {
                CheckLeaf(owner, leaf, where);
            }

            return node;
        }

        private void CheckLeaf(CompiledField owner, LeafRule leaf, string where)
        {
            var key = owner.Definition.Key;
            if (!_index.TryGetValue(leaf.Field, out var targetIndex))
            {
                Add(FormDefinitionErrorCode.UnknownFieldReference, key, $"The {where} rule of '{key}' references unknown field '{leaf.Field}'.");
                return;
            }

            var target = _defs[targetIndex];
            if (!target.Control.IsInput())
            {
                Add(FormDefinitionErrorCode.InvalidReferenceTarget, key, $"The {where} rule of '{key}' references non-input field '{leaf.Field}'.");
                return;
            }

            if (targetIndex == owner.Index)
            {
                Add(FormDefinitionErrorCode.SelfReference, key, $"The {where} rule of '{key}' references the field itself.");
                return;
            }

            _deps[owner.Index].Add(targetIndex);

            if (!IsOperatorAllowed(target.Control, leaf.Op))
            {
                Add(FormDefinitionErrorCode.OperatorTypeMismatch, key, $"Operator {leaf.Op} is not allowed on {target.Control.ToWireName()} field '{leaf.Field}'.");
                return;
            }

            foreach (var literal in leaf.Literals)
            {
                if (!IsLiteralTypeOk(target.Control, literal))
                {
                    Add(FormDefinitionErrorCode.LiteralTypeMismatch, key, $"Literal {literal.GetRawText()} does not fit {target.Control.ToWireName()} field '{leaf.Field}'.");
                }
                else if (target.Control.HasOptions() &&
                         !target.Options.Any(o => string.Equals(o.Key, literal.GetString(), StringComparison.Ordinal)))
                {
                    Add(FormDefinitionErrorCode.UnknownOptionReference, key, $"Literal '{literal.GetString()}' is not a declared option of '{leaf.Field}'.");
                }
            }
        }

        private static bool IsOperatorAllowed(FormControl control, RuleOperator op)
        {
            if (op is RuleOperator.IsEmpty or RuleOperator.IsNotEmpty)
            {
                return true;
            }

            return control switch
            {
                FormControl.Text or FormControl.TextArea or FormControl.Url or FormControl.Select or FormControl.Radio
                    or FormControl.AssetRef or FormControl.UserRef
                    => op is RuleOperator.Eq or RuleOperator.Neq or RuleOperator.In or RuleOperator.NotIn,
                FormControl.Number or FormControl.Date
                    => op is RuleOperator.Eq or RuleOperator.Neq or RuleOperator.Gt or RuleOperator.Gte
                        or RuleOperator.Lt or RuleOperator.Lte or RuleOperator.In or RuleOperator.NotIn,
                FormControl.Checkbox => op is RuleOperator.IsTrue or RuleOperator.IsFalse,
                FormControl.MultiSelect => op is RuleOperator.Contains,
                _ => false,
            };
        }

        private static bool IsLiteralTypeOk(FormControl control, JsonElement literal) => control switch
        {
            FormControl.Number => literal.ValueKind == JsonValueKind.Number,
            FormControl.Date => literal.ValueKind == JsonValueKind.String && FormValueRules.TryParseDate(literal.GetString()!, out _),
            FormControl.AssetRef or FormControl.UserRef => FormValueRules.IsPositiveInteger(literal),
            FormControl.DateTime or FormControl.Checkbox => false,
            _ => literal.ValueKind == JsonValueKind.String,
        };

        /// <summary>Kahn's algorithm, always taking the lowest display index first; null when the graph has a cycle.</summary>
        private int[]? TopologicalOrder()
        {
            var remaining = _deps.Select(d => d.Count).ToArray();
            var dependents = _deps.Select(_ => new List<int>()).ToArray();
            for (var i = 0; i < _deps.Length; i++)
            {
                foreach (var dep in _deps[i])
                {
                    dependents[dep].Add(i);
                }
            }

            var ready = new SortedSet<int>(Enumerable.Range(0, _deps.Length).Where(i => remaining[i] == 0));
            var order = new List<int>(_deps.Length);
            while (ready.Count > 0)
            {
                var next = ready.Min;
                ready.Remove(next);
                order.Add(next);
                foreach (var dependent in dependents[next])
                {
                    if (--remaining[dependent] == 0)
                    {
                        ready.Add(dependent);
                    }
                }
            }

            return order.Count == _deps.Length ? [.. order] : null;
        }

        private void Add(FormDefinitionErrorCode code, string? fieldKey, string message) =>
            _errors.Add(new FormDefinitionError(code, fieldKey, message));
    }
}
