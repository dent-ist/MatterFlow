using System.Globalization;
using System.Text;

namespace MatterFlow.WorkViews.Application.Queries;

/// <summary>
/// Plain-list export (PM v2, #879): the rows of a list as CSV or tab-separated text. It is a list export, not a status report: no layout, no
/// narrative, no schedule. CSV is UTF-8 with a byte order mark, dates are ISO 8601, and a cell that starts with <c>=</c>, <c>+</c>, <c>-</c> or <c>@</c>
/// (or a tab or carriage return) gets a leading <c>'</c> so a spreadsheet never runs it as a formula.
/// </summary>
public static class ListExport
{
    /// <summary>The most rows one export carries; a longer list is refused with a message, never cut.</summary>
    public const int RowCap = 10_000;

    public const string Csv = "csv";
    public const string Text = "text";

    /// <summary>The surface name written to the audit event for the Task Queue.</summary>
    public const string SurfaceTaskQueue = "task-queue";

    private static readonly char[] FormulaStarts = ['=', '+', '-', '@', '\t', '\r'];

    /// <summary>The cell as it is written: a leading quote before a formula start, then CSV quoting where needed.</summary>
    public static string CsvCell(string? value)
    {
        var text = value ?? string.Empty;
        if (text.Length > 0 && Array.IndexOf(FormulaStarts, text[0]) >= 0)
            text = "'" + text;
        return text.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? "\"" + text.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : text;
    }

    /// <summary>A cell of the tab-separated text: tabs and line breaks become spaces so every row stays one line; the formula guard applies here too (the text is pasted into a spreadsheet).</summary>
    public static string TextCell(string? value)
    {
        var text = (value ?? string.Empty).Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
        return text.Length > 0 && (text[0] is '=' or '+' or '-' or '@') ? "'" + text : text;
    }

    /// <summary>The whole document: the header row and the rows. CSV starts with the UTF-8 byte order mark (written by the caller as bytes) and uses CRLF line ends.</summary>
    public static string Build(string format, IReadOnlyList<string> header, IEnumerable<IReadOnlyList<string?>> rows)
    {
        var csv = format == Csv;
        var sb = new StringBuilder();
        string Line(IEnumerable<string?> cells) => string.Join(csv ? "," : "\t", cells.Select(c => csv ? CsvCell(c) : TextCell(c)));
        sb.Append(Line(header)).Append(csv ? "\r\n" : "\n");
        foreach (var row in rows)
            sb.Append(Line(row)).Append(csv ? "\r\n" : "\n");
        return sb.ToString();
    }

    public static string Iso(DateTime? utc) => utc is { } v ? DateTime.SpecifyKind(v, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture) : string.Empty;

    public static string Iso(DateOnly? date) => date is { } d ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : string.Empty;

    /// <summary>Only the two known formats; anything else is csv.</summary>
    public static string FormatOf(string? requested) => string.Equals(requested?.Trim(), Text, StringComparison.OrdinalIgnoreCase) ? Text : Csv;

    public static string ContentType(string format) => format == Csv ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8";
}
