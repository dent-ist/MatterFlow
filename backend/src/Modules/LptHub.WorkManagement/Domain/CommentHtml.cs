using MatterFlow.SharedKernel.Text;

namespace MatterFlow.WorkManagement.Domain;

/// <summary>
/// Task comment bodies (decision D, relaxed for tables by decision R): the comment limits applied to the shared sanitizer
/// <see cref="RichHtml"/>. The result is the only form that is ever stored or returned.
/// </summary>
public static class CommentHtml
{
    /// <summary>Largest accepted body (characters, before and after sanitizing).</summary>
    public const int MaxLength = 20_000;

    /// <summary>Returns the sanitized HTML ("" when nothing is left). Throws <see cref="CommentTooComplexException"/> for hostile structure.</summary>
    public static string Sanitize(string? html)
    {
        try
        {
            return RichHtml.Sanitize(html, RichHtmlLimits.Comment);
        }
        catch (RichHtmlTooComplexException)
        {
            throw new CommentTooComplexException();
        }
    }

    /// <summary>The visible text of sanitized HTML.</summary>
    public static string ToPlainText(string? html) => RichHtml.ToPlainText(html);
}

/// <summary>Guard for comment HTML: the shared structural pre-scan with the comment limits.</summary>
public static class CommentHtmlGuard
{
    /// <summary>True when the input has more tags or deeper nesting than a comment may have.</summary>
    public static bool IsTooComplex(string? html) => RichHtmlGuard.IsTooComplex(html, RichHtmlLimits.Comment);
}

/// <summary>The comment HTML has more tags or deeper nesting than <see cref="CommentHtmlGuard"/> allows.</summary>
public sealed class CommentTooComplexException() : InvalidOperationException("The comment markup is too complex.");
