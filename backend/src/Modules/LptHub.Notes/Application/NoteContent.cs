using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;
using LptHub.Notes.Domain;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Text;

namespace LptHub.Notes.Application;

/// <summary>A reference found in a note body: a kind (<see cref="NoteLinkTarget"/>) and the id of the target.</summary>
/// <param name="Embed">True when the note is shown inline (<c>data-embed-id</c>) instead of as a chip.</param>
internal readonly record struct NoteReference(string Target, int Id, bool Embed);

/// <summary>What the server derives from a saved body. <paramref name="Text"/> is the search text (visible text plus the alt texts of the images); <paramref name="ImageIds"/> the distinct images, in order.</summary>
internal sealed record NoteContentResult(string Html, string Text, string Title, string Snippet, IReadOnlyList<NoteReference> References, IReadOnlyList<int> ImageIds);

/// <summary>The rules for the body of a note and of a template: sanitising, title (the first line), snippet, plain text for search and the references it contains.</summary>
internal static partial class NoteContent
{
    public const int MaxTitleLength = 300;
    public const int MaxSnippetLength = 300;
    public const int MaxReferences = 200;

    /// <summary>Images (distinct) in one note; separate from <see cref="MaxReferences"/>.</summary>
    public const int MaxImages = 20;

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
        var imageIds = ImageIdsOf(refs);
        if (refs.Count - imageIds.Count > MaxReferences)
            return Error.Validation("bodyHtml", "TOO_MANY_REFERENCES", $"A note can refer to at most {MaxReferences} items.");
        if (imageIds.Count > MaxImages)
            return Error.Validation("bodyHtml", "TOO_MANY_IMAGES", $"A note can hold up to {MaxImages} images. Remove one first.", "TOO_MANY_IMAGES");

        return new NoteContentResult(clean, SearchText(text, clean), TitleOf(text), SnippetOf(text), refs, imageIds);
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

    /// <summary>The visible text, then the alt text of every image on its own line: the Notes search finds a note by what its pictures are called. The title and the snippet never use them.</summary>
    private static string SearchText(string text, string sanitisedHtml)
    {
        var alts = ImagePattern().Matches(sanitisedHtml).Select(m => WebUtility.HtmlDecode(m.Groups["alt"].Value)).Where(a => a.Length > 0).ToList();
        return alts.Count == 0 ? text : (text.Length == 0 ? string.Empty : text + "\n") + string.Join("\n", alts);
    }

    /// <summary>The distinct image ids of the references, in document order.</summary>
    public static IReadOnlyList<int> ImageIdsOf(IEnumerable<NoteReference> references) =>
        [.. references.Where(r => r.Target == NoteLinkTarget.Image).Select(r => r.Id).Distinct()];

    /// <summary>The body with image ids replaced (an image copied for this note); every other byte stays, so the result is still a sanitised body.</summary>
    public static string ReplaceImageIds(string sanitisedHtml, IReadOnlyDictionary<int, int> map) =>
        ImageIdPattern().Replace(sanitisedHtml, m =>
            map.TryGetValue(int.Parse(m.Groups["id"].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture), out var replacement)
                ? $"<img data-image-id=\"{replacement.ToString(CultureInfo.InvariantCulture)}\""
                : m.Value);

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
                "data-image-id" => new NoteReference(NoteLinkTarget.Image, id, false),
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

    /// <summary>Replaces every reference span by its text and removes every image (templates are not tied to a matter, so they carry no references and no images).</summary>
    public static string StripReferences(string sanitisedHtml) => StripReferences(sanitisedHtml, out _);

    /// <summary>The same, and says how many images were removed (the "2 images were left out of the template" message).</summary>
    public static string StripReferences(string sanitisedHtml, out int imagesRemoved) => StripImages(ReferenceSpanPattern().Replace(sanitisedHtml, "${text}"), out imagesRemoved);

    /// <summary>Removes every <c>img</c> and says how many (one per picture in the text, as the person counts them).</summary>
    public static string StripImages(string sanitisedHtml, out int removed)
    {
        removed = ImageTagPattern().Matches(sanitisedHtml).Count;
        return removed == 0 ? sanitisedHtml : ImageTagPattern().Replace(sanitisedHtml, string.Empty);
    }

    private static string CollapseSpaces(string line) => SpacePattern().Replace(line, " ").Trim();

    [GeneratedRegex("""<(?:span|img) (?<attr>data-(?:asset|project|matter|note|user|embed|image)-id)="(?<id>\d{1,10})"[ >]""", RegexOptions.CultureInvariant)]
    private static partial Regex ReferencePattern();

    [GeneratedRegex("""<img data-image-id="(?<id>\d{1,10})" alt="(?<alt>[^"]*)"[^>]*>""", RegexOptions.CultureInvariant)]
    private static partial Regex ImagePattern();

    [GeneratedRegex("""<img data-image-id="(?<id>\d{1,10})"(?=[ >])""", RegexOptions.CultureInvariant)]
    private static partial Regex ImageIdPattern();

    [GeneratedRegex("""<img data-image-id="\d{1,10}"[^>]*>""", RegexOptions.CultureInvariant)]
    private static partial Regex ImageTagPattern();

    [GeneratedRegex("""<span data-(?:asset|project|matter|note|user|embed)-id="\d{1,10}">(?<text>[^<]*)</span>""", RegexOptions.CultureInvariant)]
    private static partial Regex ReferenceSpanPattern();

    [GeneratedRegex(@"[ \t ]+", RegexOptions.CultureInvariant)]
    private static partial Regex SpacePattern();
}
