using System.Text.Json;

namespace MatterFlow.Configuration.Domain.Forms.Rules;

internal enum RuleOperator
{
    Eq,
    Neq,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    In,
    NotIn,
    IsEmpty,
    IsNotEmpty,
    IsTrue,
    IsFalse,
}

/// <summary>A parsed rule expression tree node (already shape-checked against form-rules.schema.json).</summary>
internal abstract record RuleNode
{
    public abstract int Depth { get; }

    public IEnumerable<LeafRule> Leaves()
    {
        switch (this)
        {
            case LeafRule leaf:
                yield return leaf;
                break;
            case NotRule not:
                foreach (var l in not.Arg.Leaves())
                {
                    yield return l;
                }

                break;
            case GroupRule group:
                foreach (var arg in group.Args)
                {
                    foreach (var l in arg.Leaves())
                    {
                        yield return l;
                    }
                }

                break;
        }
    }
}

internal sealed record GroupRule(bool IsAnd, IReadOnlyList<RuleNode> Args) : RuleNode
{
    public override int Depth => 1 + Args.Max(a => a.Depth);
}

internal sealed record NotRule(RuleNode Arg) : RuleNode
{
    public override int Depth => 1 + Arg.Depth;
}

/// <summary>Comparison or unary leaf. <see cref="Literals"/> has one item for scalar operators, 1..50 for in/notIn, none for unary.</summary>
internal sealed record LeafRule(RuleOperator Op, string Field, IReadOnlyList<JsonElement> Literals) : RuleNode
{
    public override int Depth => 1;
}

/// <summary>Structural parser equivalent to <c>contracts/form-rules.schema.json</c> (root = one rule node).</summary>
internal static class RuleParser
{
    public const int MaxDepth = 3;

    private static readonly Dictionary<string, RuleOperator> ScalarOps = new(StringComparer.Ordinal)
    {
        ["eq"] = RuleOperator.Eq,
        ["neq"] = RuleOperator.Neq,
        ["gt"] = RuleOperator.Gt,
        ["gte"] = RuleOperator.Gte,
        ["lt"] = RuleOperator.Lt,
        ["lte"] = RuleOperator.Lte,
        ["contains"] = RuleOperator.Contains,
    };

    private static readonly Dictionary<string, RuleOperator> SetOps = new(StringComparer.Ordinal)
    {
        ["in"] = RuleOperator.In,
        ["notIn"] = RuleOperator.NotIn,
    };

    private static readonly Dictionary<string, RuleOperator> UnaryOps = new(StringComparer.Ordinal)
    {
        ["isEmpty"] = RuleOperator.IsEmpty,
        ["isNotEmpty"] = RuleOperator.IsNotEmpty,
        ["isTrue"] = RuleOperator.IsTrue,
        ["isFalse"] = RuleOperator.IsFalse,
    };

    /// <summary>Parses a rule; false means the JSON violates the rule schema.</summary>
    public static bool TryParse(JsonElement element, out RuleNode? node)
    {
        node = null;
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty("op", out var opElement) ||
            opElement.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var op = opElement.GetString()!;
        switch (op)
        {
            case "and" or "or":
                return TryParseGroup(element, op == "and", out node);
            case "not":
                if (!HasExactlyProperties(element, "op", "arg") || !TryParse(element.GetProperty("arg"), out var arg))
                {
                    return false;
                }

                node = new NotRule(arg!);
                return true;
        }

        if (ScalarOps.TryGetValue(op, out var scalarOp))
        {
            if (!HasExactlyProperties(element, "op", "field", "value") ||
                !TryGetFieldKey(element, out var field) ||
                !IsScalar(element.GetProperty("value")))
            {
                return false;
            }

            node = new LeafRule(scalarOp, field!, [element.GetProperty("value").Clone()]);
            return true;
        }

        if (SetOps.TryGetValue(op, out var setOp))
        {
            if (!HasExactlyProperties(element, "op", "field", "value") ||
                !TryGetFieldKey(element, out var field) ||
                element.GetProperty("value") is not { ValueKind: JsonValueKind.Array } array ||
                array.GetArrayLength() is < 1 or > 50 ||
                !array.EnumerateArray().All(IsScalar))
            {
                return false;
            }

            node = new LeafRule(setOp, field!, [.. array.EnumerateArray().Select(e => e.Clone())]);
            return true;
        }

        if (UnaryOps.TryGetValue(op, out var unaryOp))
        {
            if (!HasExactlyProperties(element, "op", "field") || !TryGetFieldKey(element, out var field))
            {
                return false;
            }

            node = new LeafRule(unaryOp, field!, []);
            return true;
        }

        return false;
    }

    private static bool TryParseGroup(JsonElement element, bool isAnd, out RuleNode? node)
    {
        node = null;
        if (!HasExactlyProperties(element, "op", "args") ||
            element.GetProperty("args") is not { ValueKind: JsonValueKind.Array } args ||
            args.GetArrayLength() is < 1 or > 8)
        {
            return false;
        }

        var list = new List<RuleNode>(args.GetArrayLength());
        foreach (var item in args.EnumerateArray())
        {
            if (!TryParse(item, out var child))
            {
                return false;
            }

            list.Add(child!);
        }

        node = new GroupRule(isAnd, list);
        return true;
    }

    private static bool HasExactlyProperties(JsonElement element, params string[] names)
    {
        var count = 0;
        foreach (var property in element.EnumerateObject())
        {
            if (Array.IndexOf(names, property.Name) < 0)
            {
                return false;
            }

            count++;
        }

        return count == names.Length;
    }

    private static bool TryGetFieldKey(JsonElement element, out string? key)
    {
        key = null;
        var field = element.GetProperty("field");
        if (field.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var text = field.GetString()!;
        if (!FormValueRules.IsValidFieldKey(text))
        {
            return false;
        }

        key = text;
        return true;
    }

    private static bool IsScalar(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String or JsonValueKind.True or JsonValueKind.False => true,
        JsonValueKind.Number => value.TryGetDouble(out var d) && double.IsFinite(d),
        _ => false,
    };
}
