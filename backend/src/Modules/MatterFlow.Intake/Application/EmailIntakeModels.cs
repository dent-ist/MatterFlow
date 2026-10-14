using System.Text.Json.Serialization;

namespace MatterFlow.Intake.Application;

/// <summary>Where the parsed values came from.</summary>
public enum EmailSource
{
    [JsonStringEnumMemberName("eml")]
    Eml,

    [JsonStringEnumMemberName("msg")]
    Msg,

    [JsonStringEnumMemberName("text")]
    Text,
}

/// <summary>JSON body of the paste variant of <c>POST /api/v1/intake/parse-email</c>.</summary>
public sealed record ParsePastedTextRequest(string? PastedText);

/// <summary>
/// The values extracted from an email. Nothing of the email is stored: attachments and their file names are never read, and the
/// original is discarded when the request ends. Empty strings / null mean "not found"; the caller lets the user fill them in.
/// </summary>
/// <param name="Subject">Subject (title candidate), at most 300 characters.</param>
/// <param name="Body">Plain-text body (description candidate), at most 20,000 characters.</param>
/// <param name="FromName">Sender display name; empty when unknown.</param>
/// <param name="FromEmail">Sender SMTP address; empty when unknown.</param>
/// <param name="SentAt">Sent date in UTC; null when the email has none or it could not be read.</param>
/// <param name="Source">Which input produced the values.</param>
/// <param name="Warnings">Human-readable notes, e.g. a truncated body or a missing sender.</param>
public sealed record ParsedEmailResponse(
    string Subject,
    string Body,
    string FromName,
    string FromEmail,
    DateTimeOffset? SentAt,
    EmailSource Source,
    IReadOnlyList<string> Warnings);

/// <summary>Intake settings (<c>Intake</c> configuration section).</summary>
public sealed class IntakeOptions
{
    public const string SectionName = "Intake";

    /// <summary>Largest accepted email file or pasted text, in bytes (default 10 MB).</summary>
    public long MaxEmailBytes { get; set; } = 10 * 1024 * 1024;

    /// <summary>Longest time one parse may take.</summary>
    public TimeSpan ParseTimeout { get; set; } = TimeSpan.FromSeconds(15);

    /// <summary>How many uploaded emails the whole server parses at the same time; further requests wait in the queue (SEC-02).</summary>
    public int MaxConcurrentParses { get; set; } = 2;

    /// <summary>How many uploads may wait for a free parse slot before the server answers 429.</summary>
    public int MaxQueuedParses { get; set; } = 4;

    /// <summary>Upload requests one user may make per minute.</summary>
    public int RequestsPerMinutePerUser { get; set; } = 30;

    /// <summary>Longest accepted value, in bytes, of a header that is decoded (Subject, From, Date, ...) in an <c>.eml</c>.</summary>
    public int MaxHeaderBytes { get; set; } = 64 * 1024;
}

/// <summary>Output limits of the parsers.</summary>
internal static class EmailLimits
{
    public const int MaxBodyChars = 20_000;
    public const int MaxSubjectChars = 300;
    public const int MaxNameChars = 200;
    public const int MaxEmailChars = 320;

    /// <summary>Limit on text produced from HTML before the body cut-off, so a hostile document cannot make us build a huge string.</summary>
    public const int MaxHtmlTextChars = 200_000;
}
