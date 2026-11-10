using AngleSharp.Dom;
using AngleSharp.Html.Parser;
using MatterFlow.SharedKernel.Text;

namespace MatterFlow.Intake.Application;

/// <summary>
/// The HTML body of an email as a Task description candidate (decision R): sanitized by the shared <see cref="RichHtml"/> (basic formatting and
/// tables only), or null with a warning when it does not fit the limits so the plain-text body is used instead. Nothing is fetched or run.
/// </summary>
internal static class EmailHtml
{
    /// <summary>Sanitized HTML for the description, or null (nothing usable, or over a limit: a warning says which).</summary>
    public static string? Clean(string? html, List<string> warnings, bool dropHeaderLines = false)
    {
        if (string.IsNullOrWhiteSpace(html))
            return null;

        var problem = RichHtml.TrySanitize(html, RichHtmlLimits.Email, out var clean);
        switch (problem)
        {
            case RichHtmlProblem.None:
                break;
            case RichHtmlProblem.TooManyCells:
                warnings.Add($"The email has a table with more than {RichHtmlLimits.Email.MaxTableCells} cells, so its formatting was not kept. The plain text was used.");
                return null;
            default:
                warnings.Add("The email's formatting is too large or too complex to keep, so the plain text was used.");
                return null;
        }

        if (dropHeaderLines)
            clean = HeaderLines.Drop(clean);

        return clean.Length == 0 ? null : clean;
    }

    /// <summary>
    /// Removes the leading <c>From:</c>/<c>Sent:</c>/<c>To:</c>/<c>Cc:</c>/<c>Subject:</c> lines of a pasted email from sanitized HTML, as the
    /// plain-text parser removes them from the text (their values fill the form fields). Works on sanitized HTML only: a run of top-level
    /// paragraphs, or the lines of the first paragraph, that are header lines; stops at the first line that is not.
    /// </summary>
    internal static class HeaderLines
    {
        private static readonly string[] Labels = ["from", "sent", "date", "to", "cc", "bcc", "subject", "importance", "attachments"];

        public static string Drop(string cleanHtml)
        {
            var document = new HtmlParser().ParseDocument(string.Empty);
            var body = document.Body!;
            body.InnerHtml = cleanHtml;

            var removedAny = false;
            var sawFromOrSubject = false;
            foreach (var node in body.ChildNodes.ToList())
            {
                if (node is IText { Data: var data } text && string.IsNullOrWhiteSpace(data))
                {
                    text.Remove();
                    continue;
                }

                if (node is not IElement { LocalName: "p" } paragraph)
                    break;

                // Split the paragraph into lines at <br>; leading header lines are dropped, the rest stays.
                var lines = SplitLines(paragraph);
                var headerCount = 0;
                foreach (var line in lines)
                {
                    var label = LabelOf(line.Text);
                    if (label is null && line.Text.Length > 0)
                        break;
                    if (label is "from" or "subject")
                        sawFromOrSubject = true;
                    headerCount++;
                }

                if (headerCount == 0)
                    break;

                removedAny = true;
                if (headerCount >= lines.Count)
                {
                    paragraph.Remove();
                    continue;
                }

                foreach (var line in lines.Take(headerCount))
                {
                    foreach (var part in line.Nodes)
                        part.Parent?.RemoveChild(part);
                }

                break;
            }

            // Only a real header block counts: a body that merely starts with "To: do" is left alone.
            return removedAny && sawFromOrSubject ? body.InnerHtml.Trim() : cleanHtml;
        }

        private static string? LabelOf(string text)
        {
            var colon = text.IndexOf(':', StringComparison.Ordinal);
            if (colon is <= 0 or > 12)
                return null;

            var label = text[..colon].Trim().TrimEnd('*').ToLowerInvariant();
            return Labels.Contains(label, StringComparer.Ordinal) ? label : null;
        }

        private sealed record Line(string Text, List<INode> Nodes);

        private static List<Line> SplitLines(IElement paragraph)
        {
            var lines = new List<Line>();
            var nodes = new List<INode>();
            var text = new System.Text.StringBuilder();
            foreach (var child in paragraph.ChildNodes.ToList())
            {
                nodes.Add(child);
                if (child is IElement { LocalName: "br" })
                {
                    lines.Add(new Line(text.ToString().Trim(), nodes));
                    nodes = [];
                    text.Clear();
                }
                else
                {
                    text.Append(child.TextContent);
                }
            }

            if (nodes.Count > 0)
                lines.Add(new Line(text.ToString().Trim(), nodes));
            return lines;
        }
    }
}
