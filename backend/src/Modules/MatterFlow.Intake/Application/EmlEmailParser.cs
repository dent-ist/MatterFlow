using MimeKit;

namespace MatterFlow.Intake.Application;

/// <summary>Reads RFC 5322 / MIME messages (<c>.eml</c>) with MimeKit. Attachment parts and their names are never examined.</summary>
internal static class EmlEmailParser
{
    private static readonly ParserOptions Options = CreateOptions();

    private static ParserOptions CreateOptions()
    {
        var options = ParserOptions.Default.Clone();
        options.MaxMimeDepth = 24;
        options.MaxAddressGroupDepth = 4;
        options.AddressParserComplianceMode = RfcComplianceMode.Loose;
        return options;
    }

    public static ParsedEmailResponse Parse(Stream content, CancellationToken cancellationToken)
    {
        var message = MimeMessage.Load(Options, content, cancellationToken);
        var warnings = new List<string>();

        var subject = EmailText.SingleLine(message.Subject, EmailLimits.MaxSubjectChars);

        var (fromName, fromEmail) = Sender(message, warnings);
        var sentAt = SentAt(message, warnings);

        var text = message.TextBody;
        if (string.IsNullOrWhiteSpace(text))
        {
            var html = message.HtmlBody;
            text = string.IsNullOrWhiteSpace(html) ? string.Empty : HtmlToText.Convert(html);
        }

        var body = EmailText.Body(text, warnings);
        if (body.Length == 0)
            warnings.Add("No readable message body was found.");

        return new ParsedEmailResponse(subject, body, fromName, fromEmail, sentAt, EmailSource.Eml, warnings);
    }

    private static (string Name, string Email) Sender(MimeMessage message, List<string> warnings)
    {
        var mailboxes = message.From.Mailboxes.ToList();
        var mailbox = mailboxes.FirstOrDefault() ?? message.Sender;
        if (mailbox is null)
        {
            warnings.Add("The sender could not be read from the message.");
            return (string.Empty, string.Empty);
        }

        if (mailboxes.Count > 1)
            warnings.Add("The message has more than one sender; the first one was used.");

        var name = EmailText.SingleLine(mailbox.Name, EmailLimits.MaxNameChars);
        var email = EmailText.SingleLine(mailbox.Address, EmailLimits.MaxEmailChars);
        return (name, email);
    }

    private static DateTimeOffset? SentAt(MimeMessage message, List<string> warnings)
    {
        if (IsPlausible(message.Date))
            return message.Date.ToUniversalTime();

        // No usable Date header: the first (most recent) Received hop carries the time after the last semicolon.
        var received = message.Headers[HeaderId.Received];
        var semicolon = received?.LastIndexOf(';') ?? -1;
        if (received is not null && semicolon >= 0
            && DateTimeOffset.TryParse(received[(semicolon + 1)..].Trim(), System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var hop)
            && IsPlausible(hop))
        {
            warnings.Add("The message has no valid Date header; the time it was received was used.");
            return hop.ToUniversalTime();
        }

        warnings.Add("The sent date could not be read from the message.");
        return null;
    }

    private static bool IsPlausible(DateTimeOffset date) =>
        date.Year is >= 1990 and <= 2100;

    /// <summary>True when the bytes look like an RFC 822 message: plain text (no NULs) whose first line is a header field or an mbox "From " line.</summary>
    public static bool LooksLikeMessage(ReadOnlySpan<byte> head)
    {
        if (head.IndexOf((byte)0) >= 0)
            return false;

        var text = System.Text.Encoding.Latin1.GetString(head);
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.Length == 0)
                continue;

            if (line.StartsWith("From ", StringComparison.Ordinal))
                return true;

            var colon = line.IndexOf(':', StringComparison.Ordinal);
            if (colon <= 0 || colon > 78)
                return false;

            return line.AsSpan(0, colon).IndexOfAny(" \t") < 0 && !line.StartsWith('<');
        }

        return false;
    }
}
