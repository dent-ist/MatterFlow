using System.Text.Json;

namespace MatterFlow.Reports.Domain.Parameters;

/// <summary>The parameter types of spec 5.1.</summary>
public enum ReportParameterType
{
    Number,
    Date,
    Text,
    Single,
    Multi,
    DateRange,
    YesNo,
    Lookup,
}

/// <summary>What a choice value is: a whole number or text. Decides the SQL type it is bound with (int or nvarchar(200)).</summary>
public enum ChoiceValueType
{
    Text,
    Int,
}

/// <summary>Which existing picker backs a lookup parameter (the values are ids).</summary>
public enum LookupKind
{
    Matter,
    Client,
    User,
    Pod,
    Role,
    TaskType,
}

/// <summary>Where a single/multi choice list comes from.</summary>
public enum OptionsKind
{
    Fixed,
    Query,
}

/// <summary>One entry of a choice list. <see cref="Value"/> is text; for an <see cref="ChoiceValueType.Int"/> list it parses to an integer.</summary>
public sealed record ParameterOption(string Value, string Label);

/// <summary>
/// An admin's definition of one parameter (the working copy of <c>dbo.ReportParameter</c> and the snapshot kept in a version). For a
/// <see cref="ReportParameterType.DateRange"/> the <see cref="Name"/> is the base name: the SQL uses <c>:NAME_FROM</c> and <c>:NAME_TO</c>.
/// </summary>
public sealed record ReportParameterDefinition
{
    public const int DefaultMaxTextLength = 400;
    public const int DefaultMaxSelected = 200;
    public const int MaxSelectedCeiling = 1000;
    public const int MaxChoiceTextLength = 200;

    /// <summary>Upper-case name as used in the SQL (without the colon).</summary>
    public required string Name { get; init; }

    public required ReportParameterType Type { get; init; }

    public string Label { get; init; } = "";

    public string? HelpText { get; init; }

    /// <summary>The default as JSON (a literal, or a keyword such as <c>"today"</c>, <c>"startOfMonth"</c>, <c>"myPods"</c>). Null means no default.</summary>
    public JsonElement? Default { get; init; }

    public bool IsRequired { get; init; }

    /// <summary>For <see cref="ReportParameterType.Lookup"/>.</summary>
    public LookupKind? LookupKind { get; init; }

    /// <summary>For <see cref="ReportParameterType.Lookup"/>: more than one id.</summary>
    public bool LookupMulti { get; init; }

    /// <summary>For single/multi.</summary>
    public ChoiceValueType ValueType { get; init; } = ChoiceValueType.Text;

    public OptionsKind? OptionsKind { get; init; }

    /// <summary>The fixed list, or the list the query produced (resolved by the caller before binding).</summary>
    public IReadOnlyList<ParameterOption> Options { get; init; } = [];

    /// <summary>Number: lowest/highest value.</summary>
    public decimal? Min { get; init; }

    public decimal? Max { get; init; }

    /// <summary>Number: bind as <c>bigint</c> instead of <c>decimal(38,10)</c> and refuse a fraction.</summary>
    public bool IntegerOnly { get; init; }

    /// <summary>Text: longest accepted value (at most 400).</summary>
    public int? MaxLength { get; init; }

    /// <summary>Multi/lookup-multi: most selections (default 200, at most 1,000).</summary>
    public int? MaxSelected { get; init; }

    /// <summary>True when the value is a list that the engine binds as one JSON array.</summary>
    public bool IsList => Type is ReportParameterType.Multi || (Type is ReportParameterType.Lookup && LookupMulti);

    /// <summary>The list element type (lookups are ids).</summary>
    public ChoiceValueType ElementType => Type is ReportParameterType.Lookup ? ChoiceValueType.Int : ValueType;

    /// <summary>The placeholder names this definition answers in the SQL text.</summary>
    public IReadOnlyList<string> PlaceholderNames => Type is ReportParameterType.DateRange ? [Name + "_FROM", Name + "_TO"] : [Name];
}
