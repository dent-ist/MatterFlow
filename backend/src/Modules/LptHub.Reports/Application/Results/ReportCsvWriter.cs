using System.Globalization;
using System.Text;

namespace LptHub.Reports.Application.Results;

/// <summary>
/// Writes rows of a <see cref="ResultTable"/> as CSV (issue #721, spec 5.2): UTF-8 with a byte order mark, comma, CRLF, RFC 4180 quoting, a header row,
/// ISO dates (a date-time that is an instant ends in <c>Z</c>), numbers in the invariant culture, Yes and No for booleans (the same words as the grid),
/// null as an empty cell. Text cells and headers that start with <c>=</c>, <c>+</c>, <c>-</c>, <c>@</c>, a tab or a carriage return get a leading
/// apostrophe so a spreadsheet never runs them as a formula; numbers are never touched, so a real negative number stays a number. The file is written
/// in batches straight to the stream, so a large result is never held as one string.
/// </summary>
public static class ReportCsvWriter
{
    public const string ContentType = "text/csv; charset=utf-8";

    private const int BatchRows = 1000;
    private static readonly char[] FormulaStarts = ['=', '+', '-', '@', '\t', '\r'];
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);
    private static readonly byte[] Bom = [0xEF, 0xBB, 0xBF];

    /// <summary>
    /// Writes the header and the rows at <paramref name="order"/> (row indexes, already filtered and sorted) for the columns at <paramref name="columns"/>
    /// (column indexes, in file order). Returns the number of data rows written.
    /// </summary>
    public static async Task<int> WriteAsync(Stream output, ResultTable table, IReadOnlyList<int> order, IReadOnlyList<int> columns, CancellationToken cancellationToken)
    {
        await output.WriteAsync(Bom, cancellationToken);
        var sb = new StringBuilder(64 * 1024);
        for (var c = 0; c < columns.Count; c++)
        {
            if (c > 0)
                sb.Append(',');
            sb.Append(Cell(table.Columns[columns[c]].Name, formulaGuard: true));
        }

        sb.Append("\r\n");

        var written = 0;
        foreach (var row in order)
        {
            for (var c = 0; c < columns.Count; c++)
            {
                if (c > 0)
                    sb.Append(',');
                var column = table.Columns[columns[c]];
                sb.Append(Cell(Format(table.Get(row, columns[c])), formulaGuard: column.Type == ReportColumnType.Text));
            }

            sb.Append("\r\n");
            written++;
            if (written % BatchRows == 0)
                await FlushAsync(output, sb, cancellationToken);
        }

        await FlushAsync(output, sb, cancellationToken);
        return written;
    }

    private static async Task FlushAsync(Stream output, StringBuilder sb, CancellationToken cancellationToken)
    {
        if (sb.Length == 0)
            return;
        await output.WriteAsync(Utf8.GetBytes(sb.ToString()), cancellationToken);
        sb.Clear();
    }

    /// <summary>A stored cell value as text: invariant numbers, Yes and No, the ISO text dates already are, empty for null.</summary>
    internal static string Format(object? value) => value switch
    {
        null => "",
        string s => s,
        bool b => b ? "Yes" : "No",
        long l => l.ToString(CultureInfo.InvariantCulture),
        decimal d => d.ToString(CultureInfo.InvariantCulture),
        double d => d.ToString("R", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? "",
    };

    /// <summary>
    /// True when a spreadsheet could take the text for a formula: it starts with a tab or carriage return, or its first character that is not white space is
    /// <c>=</c>, <c>+</c>, <c>-</c> or <c>@</c> (spec 12.3), so leading spaces do not hide a formula.
    /// </summary>
    internal static bool StartsLikeAFormula(string text)
    {
        if (text.Length == 0)
            return false;
        if (text[0] is '\t' or '\r')
            return true;
        foreach (var ch in text)
        {
            if (Array.IndexOf(FormulaStarts, ch) >= 0 && !char.IsWhiteSpace(ch))
                return true;
            if (!char.IsWhiteSpace(ch))
                return false;
        }

        return false;
    }

    /// <summary>One cell as written: the formula guard (text only), then RFC 4180 quoting where the text has a comma, quote, CR or LF.</summary>
    public static string Cell(string text, bool formulaGuard)
    {
        if (formulaGuard && StartsLikeAFormula(text))
            text = "'" + text;
        return text.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? "\"" + text.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : text;
    }
}
