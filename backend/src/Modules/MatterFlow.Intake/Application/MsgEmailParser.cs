using System.Text;
using MimeKit;
using MsgReader.Outlook;

namespace MatterFlow.Intake.Application;

/// <summary>Reads Outlook <c>.msg</c> (OLE compound file) with MsgReader. Reads from a stream only; attachments are never touched.</summary>
internal static class MsgEmailParser
{
    private static readonly byte[] OleSignature = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

    public static bool HasOleSignature(ReadOnlySpan<byte> head) => head.StartsWith(OleSignature);

    public static ParsedEmailResponse Parse(Stream content, CancellationToken cancellationToken = default)
    {
        using var message = new Storage.Message(content, FileAccess.Read);
        if (message.Type is not (MessageType.Email or MessageType.EmailClearSigned or MessageType.EmailEncryptedAndMaybeSigned or MessageType.Unknown))
            throw new InvalidDataException("The .msg file is not an email.");

        var warnings = new List<string>();
        var subject = EmailText.SingleLine(message.Subject, EmailLimits.MaxSubjectChars);
        var (fromName, fromEmail) = Sender(message, warnings);

        var sent = message.SentOn ?? message.ReceivedOn;
        DateTimeOffset? sentAt = sent is { } value && value.Year is >= 1990 and <= 2100 ? value.ToUniversalTime() : null;
        if (sentAt is null)
            warnings.Add("The sent date could not be read from the message.");

        var text = message.BodyText;
        if (string.IsNullOrWhiteSpace(text))
            text = HtmlToText.Convert(message.BodyHtml, cancellationToken: cancellationToken);

        var body = EmailText.Body(text, warnings);
        if (body.Length == 0)
            warnings.Add("No readable message body was found.");

        return new ParsedEmailResponse(subject, body, fromName, fromEmail, sentAt, EmailSource.Msg, warnings);
    }

    private static (string Name, string Email) Sender(Storage.Message message, List<string> warnings)
    {
        var name = EmailText.SingleLine(message.Sender?.DisplayName, EmailLimits.MaxNameChars);
        var email = EmailText.SingleLine(message.Sender?.Email, EmailLimits.MaxEmailChars);

        if (!email.Contains('@', StringComparison.Ordinal))
        {
            // Exchange-internal senders carry an X.500 address; the transport headers (when present) hold the SMTP one.
            var smtp = SmtpFromTransportHeaders(message.TransportMessageHeaders);
            if (smtp is not null)
            {
                email = EmailText.SingleLine(smtp.Address, EmailLimits.MaxEmailChars);
                if (name.Length == 0)
                    name = EmailText.SingleLine(smtp.Name, EmailLimits.MaxNameChars);
            }
            else
            {
                email = string.Empty;
                if (name.Length > 0)
                    warnings.Add("The sender's email address could not be resolved to an internet address; please type it.");
            }
        }

        if (name.Length == 0 && email.Length == 0)
            warnings.Add("The sender could not be read from the message.");

        return (name, email);
    }

    private static MailboxAddress? SmtpFromTransportHeaders(string? headers)
    {
        if (string.IsNullOrWhiteSpace(headers))
            return null;

        try
        {
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes(headers.TrimEnd() + "\r\n\r\n"));
            var list = HeaderList.Load(stream);
            return InternetAddressList.TryParse(list[HeaderId.From] ?? string.Empty, out var addresses)
                ? addresses.Mailboxes.FirstOrDefault(m => m.Address.Contains('@', StringComparison.Ordinal))
                : null;
        }
        catch (Exception ex) when (ex is FormatException or IOException or ArgumentException)
        {
            return null;
        }
    }
}
