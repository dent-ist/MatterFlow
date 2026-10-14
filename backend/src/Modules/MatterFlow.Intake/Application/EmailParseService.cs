using System.Text.RegularExpressions;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.Extensions.Options;

namespace MatterFlow.Intake.Application;

/// <summary>
/// Parses an uploaded <c>.eml</c> / <c>.msg</c> or pasted text into prefill values, entirely in memory. Nothing is written to disk or the
/// database, content is never logged, and failure messages never repeat content. The format is decided by the content (OLE signature or
/// RFC 822 look), not by the extension, because a drag from a mail client can carry the wrong name.
/// </summary>
public sealed class EmailParseService(IOptions<IntakeOptions> options, IUserTimeZone timeZone)
{
    private const int HeadBytes = 4096;

    private static readonly string[] AllowedExtensions = [".eml", ".msg"];

    private IntakeOptions Options => options.Value;

    /// <summary>Parses an uploaded file. <paramref name="content"/> is read once, up to <see cref="IntakeOptions.MaxEmailBytes"/>.</summary>
    public async Task<Result<ParsedEmailResponse>> ParseFileAsync(Stream content, string? fileName, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(fileName ?? string.Empty);
        if (!AllowedExtensions.Contains(extension, StringComparer.OrdinalIgnoreCase))
            return new Error(ErrorType.UnsupportedMediaType, ErrorCodes.UnsupportedMediaType, "Choose a .eml or .msg file, or paste the email text.");

        var read = await ReadCappedAsync(content, cancellationToken);
        if (read.IsFailure)
            return Result<ParsedEmailResponse>.Failure(read.Error!);

        var buffer = read.Value;
        if (buffer.Length == 0)
            return ParseFailed("The file is empty.");

        var head = buffer.AsSpan(0, Math.Min(HeadBytes, buffer.Length));
        var isMsg = MsgEmailParser.HasOleSignature(head);
        if (!isMsg && !EmlEmailParser.LooksLikeMessage(head))
            return ParseFailed("The file is not a readable .eml or .msg email.");

        if (extension.Equals(".msg", StringComparison.OrdinalIgnoreCase) && !isMsg)
            return ParseFailed("The file is not a valid .msg email.");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Options.ParseTimeout);
        try
        {
            // Parsing is CPU-bound; running it off the request thread lets the timeout fire even if the parser does not poll the token.
            return await Task.Run(
                    () =>
                    {
                        using var stream = new MemoryStream(buffer, writable: false);
                        return isMsg ? MsgEmailParser.Parse(stream) : EmlEmailParser.Parse(stream, timeout.Token);
                    },
                    timeout.Token)
                .WaitAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return ParseFailed("Reading the email took too long.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Deliberately no detail: exception messages from the parsers can quote content.
            return ParseFailed("The email could not be read.");
        }
    }

    /// <summary>Parses pasted text (a header block plus body, or just a body).</summary>
    public Result<ParsedEmailResponse> ParsePastedText(string? pastedText)
    {
        if (string.IsNullOrWhiteSpace(pastedText))
            return Error.Validation("pastedText", "REQUIRED", "Paste the email text first.");

        // A UTF-8 character is at most 4 bytes; compare cheaply without encoding the whole string.
        if (pastedText.Length > Options.MaxEmailBytes)
            return PayloadTooLarge();

        try
        {
            return PastedTextParser.Parse(pastedText, timeZone.Zone);
        }
        catch (Exception ex) when (ex is RegexMatchTimeoutException or ArgumentException)
        {
            return ParseFailed("The pasted text could not be read.");
        }
    }

    private async Task<Result<byte[]>> ReadCappedAsync(Stream content, CancellationToken cancellationToken)
    {
        var max = Options.MaxEmailBytes;
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await content.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > max)
                return PayloadTooLarge();

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    internal Error PayloadTooLarge() =>
        new(ErrorType.PayloadTooLarge, ErrorCodes.PayloadTooLarge, $"The email is larger than {Options.MaxEmailBytes / (1024 * 1024)} MB. Save a smaller message or paste the text instead.");

    private static Error ParseFailed(string message) => new(ErrorType.Validation, ErrorCodes.EmailParseFailed, message + " Paste the email text instead.");
}
