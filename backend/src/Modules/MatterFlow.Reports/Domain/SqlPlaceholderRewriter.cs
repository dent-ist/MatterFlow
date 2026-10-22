using System.Text;

namespace MatterFlow.Reports.Domain;

/// <summary>
/// Replaces the <c>:NAME</c> tokens the scanner found. Only the scanner's positions decide what changes: the rest of the text is copied
/// verbatim, so nothing a user typed (a value) can ever reach the SQL text, because values are never part of it.
/// </summary>
public static class SqlPlaceholderRewriter
{
    /// <summary>The name of the SQL parameter the engine binds for a placeholder.</summary>
    public static string ParameterName(string upperName) => "@p_" + upperName;

    public static string Rewrite(string sql, IReadOnlyList<PlaceholderOccurrence> occurrences) => Rewrite(sql, occurrences, o => ParameterName(o.Name));

    public static string Rewrite(string sql, IReadOnlyList<PlaceholderOccurrence> occurrences, Func<PlaceholderOccurrence, string> replacement)
    {
        if (occurrences.Count == 0)
            return sql;

        var sb = new StringBuilder(sql.Length + occurrences.Count * 4);
        var at = 0;
        foreach (var o in occurrences)
        {
            if (o.Start < at || o.Start + o.Length > sql.Length)
                throw new ArgumentException("Occurrences must be in text order and inside the text.", nameof(occurrences));
            sb.Append(sql, at, o.Start - at).Append(replacement(o));
            at = o.Start + o.Length;
        }

        return sb.Append(sql, at, sql.Length - at).ToString();
    }
}
