using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Text;

namespace MatterFlow.WorkManagement.Domain;

/// <summary>How a Task description is stored (column <c>DescriptionFormat</c>).</summary>
public enum TaskDescriptionFormat
{
    /// <summary>Plain text written before descriptions became rich text; shown escaped, with its line breaks.</summary>
    Text = 0,

    /// <summary>Sanitized rich text (basic formatting and tables, decision R).</summary>
    Html = 1,
}

public static class TaskDescriptionFormatExtensions
{
    public static string ToCode(this TaskDescriptionFormat format) => format == TaskDescriptionFormat.Html ? "HTML" : "TEXT";

    public static TaskDescriptionFormat FromCode(string? code) => string.Equals(code, "HTML", StringComparison.Ordinal) ? TaskDescriptionFormat.Html : TaskDescriptionFormat.Text;
}

/// <summary>The outcome of preparing a description for storage: the sanitized HTML (null when empty) or the field error.</summary>
public sealed record PreparedDescription(string? Html, FieldError? Error);

/// <summary>
/// Rules for the rich-text Task description (decision R). The request may carry HTML (from the editor, an email, an API client) or plain text;
/// plain text is escaped into paragraphs, HTML is sanitized by <see cref="RichHtml"/>. What is stored is always the sanitized form.
/// </summary>
public static class TaskDescription
{
    /// <summary>Most visible characters (plain text) a description may have; the same limit plain-text descriptions always had.</summary>
    public const int MaxTextLength = 20_000;

    /// <summary>Longest accepted request value (characters), before sanitizing; pasted Outlook markup is far heavier than its text.</summary>
    public const int MaxInputLength = 300_000;

    /// <summary>Longest stored HTML (characters).</summary>
    public const int MaxHtmlLength = 100_000;

    public const string HtmlTooLarge = "HTML_TOO_LARGE";

    public const string TableTooLarge = "TABLE_TOO_LARGE";

    public const string TooComplex = "TOO_COMPLEX";

    /// <summary>Sanitizes the request value. Blank gives <c>(null, null)</c>.</summary>
    public static PreparedDescription Prepare(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
            return new PreparedDescription(null, null);

        var html = RichHtml.LooksLikeHtml(input) ? input : RichHtml.FromPlainText(input);
        var problem = RichHtml.TrySanitize(html, RichHtmlLimits.Description, out var clean);
        switch (problem)
        {
            case RichHtmlProblem.TooLarge:
                return Fail(HtmlTooLarge, "The description is too large. Remove some content or paste less formatting.");
            case RichHtmlProblem.TooManyCells:
                return Fail(TableTooLarge, $"A description can have at most {RichHtmlLimits.Description.MaxTableCells} table cells.");
            case RichHtmlProblem.TooComplex or RichHtmlProblem.Unstable:
                return Fail(TooComplex, "The description has too many tags or is nested too deeply. Simplify the formatting and try again.");
        }

        if (clean.Length == 0)
            return new PreparedDescription(null, null);

        // The length counts what people read, so a table with heavy markup is not penalised for its tags.
        return RichText.ToPlainText(clean).Length > MaxTextLength
            ? Fail("TOO_LONG", $"A description may have at most {MaxTextLength} characters.")
            : new PreparedDescription(clean, null);
    }

    /// <summary>The text of a stored description for audit trails, summaries and exports: HTML becomes plain text, plain text stays.</summary>
    public static string ToPlainText(string? description, TaskDescriptionFormat format) =>
        description is null ? string.Empty : format == TaskDescriptionFormat.Html ? RichText.ToPlainText(description) : description;

    private static PreparedDescription Fail(string code, string message) => new(null, new FieldError(code, message));
}
