using System.Globalization;
using System.Text.RegularExpressions;
using LptHub.Notes.Domain;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Text;

namespace LptHub.Notes.Application;

/// <summary>A reference found in a note body: a kind (<see cref="NoteLinkTarget"/>) and the id of the target.</summary>
/// <param name="Embed">True when the note is shown inline (<c>data-embed-id</c>) instead of as a chip.</param>
internal readonly record struct NoteReference(string Target, int Id, bool Embed);

/// <summary>What the server derives from a saved body.</summary>
internal sealed record NoteContentResult(string Html, string Text, string Title, string Snippet, IReadOnlyList<NoteReference> References);

/// <summary>The rules for the body of a note and of a template: sanitising, title (the first line), snippet, plain text for search and the references it contains.</summary>
internal static partial class NoteContent
{
    public const int MaxTitleLength = 300;
    public const int MaxSnippetLength = 300;
    public const int MaxReferences = 200;

    /// <summary>Shown for a note whose body has no text yet.</summary>
    public const string UntitledTitle = "Untitled note";

    /// <summary>Sanitises the body. An empty body is allowed (a new note). Too large or too complex input is a field error on <c>bodyHtml</c>.</summary>
    public static Result<NoteContentResult> Process(string? bodyHtml)
    {
        var problem = RichHtml.TrySanitize(bodyHtml, RichHtmlLimits.Note, out var clean, RichHtmlProfile.Note);
        switch (problem)
        {
            case RichHtmlProblem.None:
                break;
            case RichHtmlProblem.TooLarge:
                return Error.Validation("bodyHtml", "HTML_TOO_LARGE", "The note is too large. Split it into two notes.");
            case RichHtmlProblem.TooManyCells:
                return Error.Validation("bodyHtml", "TABLE_TOO_LARGE", "The note has too many table cells. Split the table.");
            default:
                return Error.Validation("bodyHtml", "TOO_COMPLEX", "The note's formatting is too complex. Remove nested formatting and try again.");
        }

        var text = RichHtml.ToPlainText(clean);
        var refs = ExtractReferences(clean);
        if (refs.Count > MaxReferences)
            return Error.Validation("bodyHtml", "TOO_MANY_REFERENCES", $"A note can refer to at most {MaxReferences} items.");

        return new NoteContentResult(clean, text, TitleOf(text), SnippetOf(text), refs);
    }

    /// <summary>The title is the first non-empty line of the text, cut to <see cref="MaxTitleLength"/>.</summary>
    public static string TitleOf(string plainText)
    {
        foreach (var line in plainText.Split('\n'))
        {
            var trimmed = CollapseSpaces(line);
            if (trimmed.Length > 0)
                return trimmed.Length <= MaxTitleLength ? trimmed : trimmed[..MaxTitleLength].TrimEnd();
        }

        return string.Empty;
    }

    /// <summary>The text after the first line on one line, cut to <see cref="MaxSnippetLength"/>.</summary>
    public static string SnippetOf(string plainText)
    {
        var lines = plainText.Split('\n').Select(CollapseSpaces).Where(l => l.Length > 0).Skip(1);
        var joined = string.Join(" ", lines);
        return joined.Length <= MaxSnippetLength ? joined : joined[..MaxSnippetLength].TrimEnd();
    }

    /// <summary>The distinct references of a sanitised body, in document order. A note shown inline is also a link to that note.</summary>
    public static IReadOnlyList<NoteReference> ExtractReferences(string sanitisedHtml)
    {
        var found = new List<NoteReference>();
        foreach (Match m in ReferencePattern().Matches(sanitisedHtml))
        {
            var attribute = m.Groups["attr"].Value;
            var id = int.Parse(m.Groups["id"].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture);
            var reference = attribute switch
            {
                "data-asset-id" => new NoteReference(NoteLinkTarget.Asset, id, false),
                "data-project-id" => new NoteReference(NoteLinkTarget.Project, id, false),
                "data-matter-id" => new NoteReference(NoteLinkTarget.Matter, id, false),
                "data-note-id" => new NoteReference(NoteLinkTarget.Note, id, false),
                "data-embed-id" => new NoteReference(NoteLinkTarget.Note, id, true),
                _ => new NoteReference(NoteLinkTarget.User, id, false),
            };
            if (!found.Contains(reference))
                found.Add(reference);
        }

        return found;
    }

    /// <summary>The distinct (target, id) pairs to store as links.</summary>
    public static IReadOnlyList<(string Target, int Id)> Links(IEnumerable<NoteReference> references) =>
        [.. references.Select(r => (r.Target, r.Id)).Distinct()];

    /// <summary>Replaces every reference span by its text (templates are not tied to a matter, so they carry no references).</summary>
    public static string StripReferences(string sanitisedHtml) => ReferenceSpanPattern().Replace(sanitisedHtml, "${text}");

    private static string CollapseSpaces(string line) => SpacePattern().Replace(line, " ").Trim();

    [GeneratedRegex("""<span (?<attr>data-(?:asset|project|matter|note|user|embed)-id)="(?<id>\d{1,10})">""", RegexOptions.CultureInvariant)]
    private static partial Regex ReferencePattern();

    [GeneratedRegex("""<span data-(?:asset|project|matter|note|user|embed)-id="\d{1,10}">(?<text>[^<]*)</span>""", RegexOptions.CultureInvariant)]
    private static partial Regex ReferenceSpanPattern();

    [GeneratedRegex(@"[ \t ]+", RegexOptions.CultureInvariant)]
    private static partial Regex SpacePattern();
}
