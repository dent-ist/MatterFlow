using System.Text;

namespace MatterFlow.Reports.Domain;

/// <summary>One replaced token: where it sits in the rewritten text and in the original.</summary>
public readonly record struct RewriteSpan(int ParseStart, int ParseLength, int OriginalStart, int OriginalLength);

/// <summary>The rewritten text plus the spans that let a position in it be mapped back to the text the author typed.</summary>
public sealed record RewrittenSql(string Text, IReadOnlyList<RewriteSpan> Spans)
{
    /// <summary>Maps an offset in <see cref="Text"/> to the offset in the original: inside a replaced token it is the token's start.</summary>
    public int ToOriginal(int offset)
    {
        var shift = 0;
        foreach (var span in Spans)
        {
            if (offset < span.ParseStart)
                break;
            if (offset < span.ParseStart + span.ParseLength)
                return span.OriginalStart;
            shift += span.ParseLength - span.OriginalLength;
        }

        return Math.Max(0, offset - shift);
    }
}

/// <summary>
/// Replaces the <c>:NAME</c> tokens the scanner found. Only the scanner's positions decide what changes: the rest of the text is copied
/// verbatim, so nothing a user typed (a value) can ever reach the SQL text, because values are never part of it.
/// </summary>
public static class SqlPlaceholderRewriter
{
    /// <summary>The name of the SQL parameter the engine binds for a placeholder.</summary>
    public static string ParameterName(string upperName) => "@p_" + upperName;

    public static string Rewrite(string sql, IReadOnlyList<PlaceholderOccurrence> occurrences) => Rewrite(sql, occurrences, o => ParameterName(o.Name));

    public static string Rewrite(string sql, IReadOnlyList<PlaceholderOccurrence> occurrences, Func<PlaceholderOccurrence, string> replacement) =>
        RewriteMapped(sql, occurrences, replacement).Text;

    /// <summary>Like <see cref="Rewrite(string, IReadOnlyList{PlaceholderOccurrence}, Func{PlaceholderOccurrence, string})"/> and also returns where each replacement landed.</summary>
    public static RewrittenSql RewriteMapped(string sql, IReadOnlyList<PlaceholderOccurrence> occurrences, Func<PlaceholderOccurrence, string> replacement)
    {
        if (occurrences.Count == 0)
            return new RewrittenSql(sql, []);

        var sb = new StringBuilder(sql.Length + occurrences.Count * 4);
        var spans = new List<RewriteSpan>(occurrences.Count);
        var at = 0;
        foreach (var o in occurrences)
        {
            if (o.Start < at || o.Start + o.Length > sql.Length)
                throw new ArgumentException("Occurrences must be in text order and inside the text.", nameof(occurrences));
            sb.Append(sql, at, o.Start - at);
            var text = replacement(o);
            spans.Add(new RewriteSpan(sb.Length, text.Length, o.Start, o.Length));
            sb.Append(text);
            at = o.Start + o.Length;
        }

        return new RewrittenSql(sb.Append(sql, at, sql.Length - at).ToString(), spans);
    }
}
