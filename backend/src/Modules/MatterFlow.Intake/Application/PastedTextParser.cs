using System.Globalization;
using System.Text.RegularExpressions;

namespace MatterFlow.Intake.Application;

/// <summary>
/// Deterministic parser for email text pasted from Outlook (docs/adr/outlook-dnd-spike.md section 6): a header block (<c>From:</c>,
/// <c>Sent:</c>/<c>Date:</c>, <c>To:</c>, <c>Cc:</c>, <c>Subject:</c>) among the first non-empty lines is split off, the rest is the body.
/// Only the first block is the message header; later blocks (replies, forwards) stay in the body. Without a recognised block
/// the whole text is the body and nothing else is filled in.
/// </summary>
internal static partial class PastedTextParser
{
    private const int HeaderSearchLines = 15;

    private static readonly (string Abbreviation, string Offset)[] UsZones =
    [
        ("EST", "-05:00"), ("EDT", "-04:00"), ("CST", "-06:00"), ("CDT", "-05:00"),
        ("MST", "-07:00"), ("MDT", "-06:00"), ("PST", "-08:00"), ("PDT", "-07:00"),
    ];

    [GeneratedRegex(@"^\s*\**(?<label>From|Sent|Date|To|Cc|Bcc|Subject)\**\s*:\**\s*(?<value>.*)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 250)]
    private static partial Regex HeaderLine();

    [GeneratedRegex(@"^\s*(?<name>""[^""]*""|[^<\[(""]*?)\s*[<\[(]\s*(?<email>[^\s<>\[\]()@,;]+@[^\s<>\[\]()@,;]+)\s*[>\])]", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 250)]
    private static partial Regex NameAndAddress();

    [GeneratedRegex(@"^\s*(?<email>[^\s<>\[\]()@,;""]+@[^\s<>\[\]()@,;""]+)\s*$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 250)]
    private static partial Regex BareAddress();

    [GeneratedRegex(@"(Z|UTC|GMT|[+-]\d{2}:?\d{2}|\b[ECMP][SD]T)\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 250)]
    private static partial Regex ExplicitZone();

    [GeneratedRegex(@"^[\s\-_=*.]*(Original Message|Forwarded message|Begin forwarded message)?[\s\-_=*.]*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 250)]
    private static partial Regex Separator();

    public static ParsedEmailResponse Parse(string text, TimeZoneInfo firmZone)
    {
        var warnings = new List<string>();
        var lines = text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Split('\n');

        var (start, end) = FindHeaderBlock(lines);
        if (start < 0)
            return new ParsedEmailResponse(string.Empty, EmailText.Body(text, warnings), string.Empty, string.Empty, null, EmailSource.Text, warnings);

        string subject = string.Empty, fromRaw = string.Empty, dateRaw = string.Empty;
        string? current = null;
        for (var i = start; i < end; i++)
        {
            var match = HeaderLine().Match(lines[i]);
            if (!match.Success)
            {
                if (lines[i].Trim().Length > 0 && current is "subject")
                    subject += " " + lines[i].Trim();
                continue;
            }

            current = match.Groups["label"].Value.ToLowerInvariant();
            var value = match.Groups["value"].Value.Trim();
            switch (current)
            {
                case "subject" when subject.Length == 0:
                    subject = value;
                    break;
                case "from" when fromRaw.Length == 0:
                    fromRaw = value;
                    break;
                case "sent" or "date" when dateRaw.Length == 0:
                    dateRaw = value;
                    break;
            }
        }

        var (name, email) = SplitAddress(fromRaw);
        DateTimeOffset? sentAt = TryParseDate(dateRaw, firmZone);
        if (sentAt is null && dateRaw.Length > 0)
            warnings.Add("The sent date in the pasted text could not be read.");

        // Text above the block is kept unless it is only a separator such as "-----Original Message-----".
        var before = string.Join('\n', lines.Take(start));
        var after = string.Join('\n', lines.Skip(end));
        var bodyText = Separator().IsMatch(before.Replace('\n', ' ')) ? after : before + "\n\n" + after;

        return new ParsedEmailResponse(
            EmailText.SingleLine(subject, EmailLimits.MaxSubjectChars),
            EmailText.Body(bodyText, warnings),
            EmailText.SingleLine(name, EmailLimits.MaxNameChars),
            EmailText.SingleLine(email, EmailLimits.MaxEmailChars),
            sentAt,
            EmailSource.Text,
            warnings);
    }

    /// <summary>Finds the first header block among the first non-empty lines; (-1, -1) when none qualifies. <c>end</c> is exclusive, past trailing blank lines.</summary>
    private static (int Start, int End) FindHeaderBlock(string[] lines)
    {
        var seen = 0;
        for (var i = 0; i < lines.Length && seen < HeaderSearchLines; i++)
        {
            if (lines[i].Trim().Length == 0)
                continue;

            seen++;
            if (!HeaderLine().IsMatch(lines[i]))
                continue;

            var labels = new HashSet<string>();
            var end = i;
            for (var j = i; j < lines.Length; j++)
            {
                var line = lines[j];
                if (line.Trim().Length == 0)
                {
                    // Outlook sometimes separates header lines with blank lines; tolerate them until the Subject line has been seen.
                    if (labels.Contains("subject") || !NextNonBlankIsHeader(lines, j))
                        break;
                    continue;
                }

                var match = HeaderLine().Match(line);
                if (match.Success)
                {
                    labels.Add(match.Groups["label"].Value.ToLowerInvariant());
                    end = j + 1;
                }
                else if (lines[j].StartsWith(' ') || lines[j].StartsWith('\t'))
                {
                    end = j + 1; // folded continuation
                }
                else
                {
                    break;
                }
            }

            if (labels.Contains("from") && (labels.Contains("sent") || labels.Contains("date") || labels.Contains("subject")))
                return (i, end);

            return (-1, -1); // only the first header-like block is considered
        }

        return (-1, -1);
    }

    private static bool NextNonBlankIsHeader(string[] lines, int from)
    {
        for (var k = from + 1; k < lines.Length; k++)
        {
            if (lines[k].Trim().Length > 0)
                return HeaderLine().IsMatch(lines[k]);
        }

        return false;
    }

    /// <summary>Splits <c>Name &lt;a@b&gt;</c>, <c>"Last, First" &lt;a@b&gt;</c>, <c>Name [a@b]</c>, a bare address or a bare name.</summary>
    internal static (string Name, string Email) SplitAddress(string raw)
    {
        raw = raw.Trim();
        if (raw.Length == 0)
            return (string.Empty, string.Empty);

        var full = NameAndAddress().Match(raw);
        if (full.Success)
            return (full.Groups["name"].Value.Trim().Trim('"').Trim(), full.Groups["email"].Value.Trim());

        var bare = BareAddress().Match(raw);
        if (bare.Success)
            return (string.Empty, bare.Groups["email"].Value);

        // Several recipients separated by ';' with no address: take the first name.
        var first = raw.Split(';')[0].Trim().Trim('"').Trim();
        return (first, string.Empty);
    }

    /// <summary>Parses Outlook, ISO and RFC 2822 dates; a date without a zone is read in the firm time zone. Null when unreadable.</summary>
    internal static DateTimeOffset? TryParseDate(string raw, TimeZoneInfo firmZone)
    {
        raw = raw.Trim();
        if (raw.Length == 0)
            return null;

        if (ExplicitZone().IsMatch(raw))
        {
            // North American abbreviations are not understood by the framework: replace them by their offset.
            foreach (var (abbreviation, offset) in UsZones)
            {
                if (raw.EndsWith(abbreviation, StringComparison.OrdinalIgnoreCase))
                {
                    raw = raw[..^abbreviation.Length].TrimEnd() + " " + offset;
                    break;
                }
            }

            if (DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var withZone))
                return withZone.ToUniversalTime();
        }

        if (!DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out var local))
            return null;

        var unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        if (firmZone.IsInvalidTime(unspecified))
            unspecified = unspecified.AddHours(1);

        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(unspecified, firmZone), TimeSpan.Zero);
    }
}
