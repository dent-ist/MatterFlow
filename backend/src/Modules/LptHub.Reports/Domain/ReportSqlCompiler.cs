using MatterFlow.Reports.Domain.Parameters;

namespace MatterFlow.Reports.Domain;

/// <summary>The text the engine sends for a report, with everything needed to validate it and to map positions back to the author's text.</summary>
/// <param name="Scan">The scan of the author's text.</param>
/// <param name="Rewritten">The text sent to SQL Server: <c>:NAME</c> replaced by <c>@p_NAME</c> or, for lists, the engine-owned sub-select.</param>
/// <param name="UsedPlaceholders">Upper-case placeholder names that occur in the SQL.</param>
public sealed record CompiledReportSql(string SourceText, SqlScan Scan, RewrittenSql Rewritten, IReadOnlySet<string> UsedPlaceholders)
{
    public string SqlText => Rewritten.Text;
}

/// <summary>
/// Turns the author's SQL into the text that is sent to SQL Server (spec 5.4). A scalar placeholder becomes <c>@p_NAME</c>. A list
/// placeholder (multi choice, multi lookup, <c>:CURRENT_POD_IDS</c>) becomes a **constant** sub-select over the one JSON array parameter:
/// <c>(SELECT CAST([value] AS int) AS [value] FROM OPENJSON(@p_NAME))</c>, <c>int</c> or <c>nvarchar(200)</c> by the declared element type. The only
/// part that varies is that cast type, chosen from the definition, never from anything a user typed. If the token already sits alone inside
/// parentheses (<c>IN (:PODS)</c>) the engine's own parentheses are dropped, so <c>IN ((SELECT ...))</c> is never produced; after
/// <c>FROM</c>/<c>JOIN</c>/<c>APPLY</c> the derived table gets an alias unless the author wrote one.
/// </summary>
public static class ReportSqlCompiler
{
    private static readonly HashSet<string> NotAnAlias = new(StringComparer.OrdinalIgnoreCase)
    {
        "WHERE", "GROUP", "ORDER", "HAVING", "UNION", "EXCEPT", "INTERSECT", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER", "ON", "OPTION", "FOR",
        "WINDOW", "OUTER", "APPLY", "TABLESAMPLE",
    };

    /// <summary>The list placeholders and their element type for <paramref name="definitions"/> (plus the built-in pod list).</summary>
    public static IReadOnlyDictionary<string, ListKind> ListPlaceholders(IReadOnlyList<ReportParameterDefinition> definitions)
    {
        var lists = new Dictionary<string, ListKind>(StringComparer.Ordinal)
        {
            [BuiltInParameters.CurrentPodIds] = ListKind.Int,
        };
        foreach (var d in definitions.Where(d => d.IsList))
            lists[d.Name] = d.ElementType == ChoiceValueType.Int ? ListKind.Int : ListKind.Text;
        return lists;
    }

    public static CompiledReportSql Compile(string sql, IReadOnlyList<ReportParameterDefinition> definitions) => Compile(sql, ListPlaceholders(definitions));

    public static CompiledReportSql Compile(string sql, IReadOnlyDictionary<string, ListKind> lists)
    {
        ArgumentNullException.ThrowIfNull(sql);
        var scan = SqlScanner.Scan(sql);
        var rewritten = SqlPlaceholderRewriter.RewriteMapped(sql, scan.Occurrences, o =>
            lists.TryGetValue(o.Name, out var kind) ? ListSubSelect(sql, scan, o, kind) : SqlPlaceholderRewriter.ParameterName(o.Name));
        var used = scan.Placeholders.Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        return new CompiledReportSql(sql, scan, rewritten, used);
    }

    /// <summary>Compiles and validates in one step (the text as the engine will send it).</summary>
    public static (CompiledReportSql Compiled, SqlValidationResult Validation) CompileAndValidate(string sql, IReadOnlyList<ReportParameterDefinition> definitions)
    {
        var compiled = Compile(sql, definitions);
        return (compiled, SqlValidator.Validate(sql, compiled.Scan, compiled.Rewritten));
    }

    /// <summary>The constant sub-select for a list parameter, without any surrounding parentheses.</summary>
    internal static string ListSelect(string upperName, ListKind kind) =>
        kind == ListKind.Int
            ? $"SELECT CAST([value] AS int) AS [value] FROM OPENJSON({SqlPlaceholderRewriter.ParameterName(upperName)})"
            : $"SELECT CAST([value] AS nvarchar(200)) AS [value] FROM OPENJSON({SqlPlaceholderRewriter.ParameterName(upperName)})";

    private static string ListSubSelect(string sql, SqlScan scan, PlaceholderOccurrence o, ListKind kind)
    {
        var select = ListSelect(o.Name, kind);
        var before = PreviousSignificant(sql, o.Start, scan.CommentSpans);
        var afterIndex = o.Start + o.Length;
        var after = NextSignificant(sql, afterIndex, scan.CommentSpans);

        if (before >= 0 && after >= 0 && sql[before] == '(' && sql[after] == ')')
            return select; // IN (:PODS): the author's parentheses are the sub-select's parentheses

        var word = WordEndingAt(sql, before);
        if (word is not null && (word.Equals("FROM", StringComparison.OrdinalIgnoreCase) || word.Equals("JOIN", StringComparison.OrdinalIgnoreCase) || word.Equals("APPLY", StringComparison.OrdinalIgnoreCase)))
        {
            var hasAlias = after >= 0 && (sql[after] is '[' or '"' or '_' || char.IsLetter(sql[after])) && !NotAnAlias.Contains(WordStartingAt(sql, after) ?? "");
            return hasAlias ? $"({select})" : $"({select}) AS [list_{o.Name}]";
        }

        return $"({select})";
    }

    private static int PreviousSignificant(string sql, int tokenStart, IReadOnlyList<(int Start, int End)> comments)
    {
        var i = tokenStart - 1;
        while (i >= 0)
        {
            if (char.IsWhiteSpace(sql[i]))
            {
                i--;
                continue;
            }

            var c = CommentAt(comments, i);
            if (c is { } span)
            {
                i = span.Start - 1;
                continue;
            }

            return i;
        }

        return -1;
    }

    private static int NextSignificant(string sql, int from, IReadOnlyList<(int Start, int End)> comments)
    {
        var i = from;
        while (i < sql.Length)
        {
            if (char.IsWhiteSpace(sql[i]))
            {
                i++;
                continue;
            }

            var c = CommentAt(comments, i);
            if (c is { } span)
            {
                i = span.End;
                continue;
            }

            return i;
        }

        return -1;
    }

    private static (int Start, int End)? CommentAt(IReadOnlyList<(int Start, int End)> comments, int index)
    {
        var lo = 0;
        var hi = comments.Count - 1;
        while (lo <= hi)
        {
            var mid = (lo + hi) >>> 1;
            var (start, end) = comments[mid];
            if (index < start)
                hi = mid - 1;
            else if (index >= end)
                lo = mid + 1;
            else
                return comments[mid];
        }

        return null;
    }

    private static string? WordEndingAt(string sql, int end)
    {
        if (end < 0 || !char.IsLetter(sql[end]))
            return null;
        var start = end;
        while (start > 0 && (char.IsLetterOrDigit(sql[start - 1]) || sql[start - 1] == '_'))
            start--;
        return sql.Substring(start, end - start + 1);
    }

    private static string? WordStartingAt(string sql, int start)
    {
        if (start < 0 || start >= sql.Length || !char.IsLetter(sql[start]))
            return null;
        var end = start;
        while (end < sql.Length && (char.IsLetterOrDigit(sql[end]) || sql[end] == '_'))
            end++;
        return sql[start..end];
    }
}
