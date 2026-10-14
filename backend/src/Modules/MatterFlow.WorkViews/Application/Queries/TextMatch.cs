using System.Text;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Case-insensitive "contains" for the free-text filters of the queues. The column is compared as <c>LOWER(column) COLLATE Latin1_General_100_BIN2</c>
/// against the lower-cased, LIKE-escaped term: the same matches as the database's case-insensitive collation for names and titles, but about five
/// times cheaper per row on a Task table of tens of thousands of rows (the rule the Asset search already uses, architecture 14).
/// </summary>
internal static class TextMatch
{
    /// <summary>The binary collation the lower-cased column is compared in.</summary>
    public const string Collation = "Latin1_General_100_BIN2";

    /// <summary>The LIKE escape character (<c>ESCAPE '\'</c>).</summary>
    public const string Escape = "\\";

    /// <summary><c>%term%</c> lower-cased, with <c>\</c>, <c>%</c>, <c>_</c> and <c>[</c> escaped so they match literally.</summary>
    public static string ContainsPattern(string text)
    {
        var sb = new StringBuilder(text.Length + 6).Append('%');
        foreach (var c in text.ToLowerInvariant())
        {
            if (c is '\\' or '%' or '_' or '[')
                sb.Append('\\');
            sb.Append(c);
        }

        return sb.Append('%').ToString();
    }
}
