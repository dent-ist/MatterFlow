namespace MatterFlow.SharedKernel.Text;

/// <summary>
/// Plain-text views of rich text, for places that must not carry markup: list and queue snippets, the audit trail, exports, summaries
/// (decision R). The sanitizer itself is <see cref="RichHtml"/>.
/// </summary>
public static class RichText
{
    /// <summary>The visible text of sanitized HTML: paragraphs, list items and table rows on their own lines, table cells separated by " | ".</summary>
    public static string ToPlainText(string? html) => RichHtml.ToPlainText(html);

    /// <summary>Plain text as sanitized-safe HTML: escaped, a blank line starts a paragraph, a single line break becomes a line break.</summary>
    public static string ToHtml(string? text) => RichHtml.FromPlainText(text);
}
