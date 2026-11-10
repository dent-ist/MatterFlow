using System.Text;
using MatterFlow.Intake.Application;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.Extensions.Options;
using Shouldly;

namespace MatterFlow.UnitTests.Intake;

/// <summary>Parsing of uploaded .eml / .msg through the service: the five spike samples with their expected values, encodings, hostile input.</summary>
public class EmailParseServiceTests
{
    private static EmailParseService Service(Action<IntakeOptions>? configure = null)
    {
        var options = new IntakeOptions();
        configure?.Invoke(options);
        return new EmailParseService(Options.Create(options), UserTimeZone.Resolve(null));
    }

    private static string SamplePath(string name) => Path.Combine(AppContext.BaseDirectory, "Intake", "samples", name);

    private static async Task<Result<ParsedEmailResponse>> ParseAsync(byte[] bytes, string fileName, EmailParseService? service = null)
    {
        await using var stream = new MemoryStream(bytes);
        return await (service ?? Service()).ParseFileAsync(stream, fileName, CancellationToken.None);
    }

    private static Task<Result<ParsedEmailResponse>> ParseSampleAsync(string name) => ParseAsync(File.ReadAllBytes(SamplePath(name)), name);

    [Fact]
    public async Task Plain_text_sample()
    {
        var result = await ParseSampleAsync("01-plain.eml");

        var email = result.Value;
        email.Source.ShouldBe(EmailSource.Eml);
        email.Subject.ShouldBe("Production volume 7 - request for load file");
        email.FromName.ShouldBe("Jane Doe");
        email.FromEmail.ShouldBe("jane.doe@example-firm.test");
        email.SentAt.ShouldBe(new DateTimeOffset(2026, 10, 12, 13, 15, 0, TimeSpan.Zero));
        email.Body.ShouldBe(
            "Hi team,\n\nPlease prepare the load file for production volume 7 for matter 10234-0002.\nWe need it by Friday.\n\nThanks,\nJane");
        email.Warnings.ShouldBeEmpty();
    }

    [Fact]
    public async Task Html_only_sample_becomes_text_without_script_or_style()
    {
        var email = (await ParseSampleAsync("02-html-only.eml")).Value;

        email.Subject.ShouldBe("HTML only: review set update");
        email.FromName.ShouldBe("Doe, Jane");
        email.FromEmail.ShouldBe("jane.doe@example-firm.test");
        email.SentAt.ShouldBe(new DateTimeOffset(2026, 10, 13, 14, 2, 30, TimeSpan.Zero));
        email.Body.ShouldBe(
            "Review set update\n\nPlease add the new custodians to the review set.\n\n- Custodian A\n- Custodian B\n\nSee the tracker (https://example.test/doc).");
        email.Body.ShouldNotContain("alert");
        email.Body.ShouldNotContain("color:red");
    }

    [Fact]
    public async Task Attachment_sample_prefers_plain_text_and_never_mentions_the_attachment()
    {
        var email = (await ParseSampleAsync("03-multipart-attachment.eml")).Value;

        email.Subject.ShouldBe("Search term report attached");
        email.FromName.ShouldBe("Raj Patel");
        email.FromEmail.ShouldBe("raj.patel@example-firm.test");
        email.SentAt.ShouldBe(new DateTimeOffset(2026, 10, 14, 13, 0, 0, TimeSpan.Zero));
        email.Body.ShouldBe("Report attached. Hit counts are in the second tab.");
        string.Join(' ', email.Warnings).ShouldNotContain("xlsx");
    }

    [Fact]
    public async Task Utf8_encoded_words_and_base64_body_sample()
    {
        var email = (await ParseSampleAsync("04-utf8-subject.eml")).Value;

        email.Subject.ShouldBe("Aktenüberprüfung – 文书確認 📂");
        email.FromName.ShouldBe("Jürgen Müller");
        email.FromEmail.ShouldBe("juergen.mueller@example-firm.test");
        email.SentAt.ShouldBe(new DateTimeOffset(2026, 10, 15, 8, 30, 0, TimeSpan.Zero));
        email.Body.ShouldBe("Grüße aus Zürich. 文书確認 – please confirm receipt. Café · naïve.");
    }

    [Fact]
    public async Task Forwarded_chain_keeps_the_whole_body_and_the_outer_sender()
    {
        var email = (await ParseSampleAsync("05-forwarded-chain.eml")).Value;

        email.Subject.ShouldBe("FW: FW: Custodian interview schedule");
        email.FromName.ShouldBe("Maria Gomez");
        email.FromEmail.ShouldBe("maria.gomez@example-firm.test");
        email.SentAt.ShouldBe(new DateTimeOffset(2026, 10, 16, 23, 45, 0, TimeSpan.Zero));
        email.Body.ShouldStartWith("Forwarding for action - please create a task for the interviews.");
        email.Body.ShouldContain("From: Partner One <partner.one@example-firm.test>");
        email.Body.ShouldContain("From: Client Contact <contact@client.test>");
        email.Body.ShouldEndWith("Interviews are proposed for the week of Oct 26.");
    }

    [Fact]
    public async Task Missing_from_and_date_give_warnings_not_failures()
    {
        var eml = "Subject: No sender\r\nContent-Type: text/plain\r\n\r\nJust a body.\r\n";

        var email = (await ParseAsync(Encoding.ASCII.GetBytes(eml), "x.eml")).Value;

        email.Subject.ShouldBe("No sender");
        email.FromName.ShouldBeEmpty();
        email.FromEmail.ShouldBeEmpty();
        email.SentAt.ShouldBeNull();
        email.Body.ShouldBe("Just a body.");
        email.Warnings.Count.ShouldBe(2);
    }

    [Fact]
    public async Task Missing_date_falls_back_to_the_received_header()
    {
        var eml = "From: A <a@x.test>\r\nSubject: s\r\nReceived: from mx by y; Tue, 13 Oct 2026 14:02:30 +0000\r\n\r\nbody\r\n";

        var email = (await ParseAsync(Encoding.ASCII.GetBytes(eml), "x.eml")).Value;

        email.SentAt.ShouldBe(new DateTimeOffset(2026, 10, 13, 14, 2, 30, TimeSpan.Zero));
        email.Warnings.ShouldContain(w => w.Contains("Date header"));
    }

    [Fact]
    public async Task Long_body_is_cut_with_a_warning_and_long_subject_is_cut()
    {
        var eml = $"From: A <a@x.test>\r\nSubject: {new string('s', 1000)}\r\nDate: Mon, 12 Oct 2026 09:15:00 -0400\r\n\r\n{new string('x', 50_000)}\r\n";

        var email = (await ParseAsync(Encoding.ASCII.GetBytes(eml), "x.eml")).Value;

        email.Body.Length.ShouldBe(20_000);
        email.Subject.Length.ShouldBe(300);
        email.Warnings.ShouldContain(w => w.Contains("shortened"));
    }

    [Fact]
    public async Task Control_characters_and_header_injection_in_the_subject_are_flattened()
    {
        var eml = "From: A <a@x.test>\r\nSubject: one\u0007 two\r\n three\r\nDate: Mon, 12 Oct 2026 09:15:00 +0000\r\n\r\nbody\r\n";

        var email = (await ParseAsync(Encoding.ASCII.GetBytes(eml), "x.eml")).Value;

        email.Subject.ShouldBe("one two three");
    }

    [Fact]
    public async Task Deeply_nested_multipart_does_not_overflow_or_hang()
    {
        var sb = new StringBuilder("From: A <a@x.test>\r\nSubject: nested\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b0\r\n\r\n");
        for (var i = 0; i < 2000; i++)
            sb.Append("--b").Append(i).Append("\r\nContent-Type: multipart/mixed; boundary=b").Append(i + 1).Append("\r\n\r\n");

        sb.Append("--b2000\r\nContent-Type: text/plain\r\n\r\ndeep\r\n");

        var result = await ParseAsync(Encoding.ASCII.GetBytes(sb.ToString()), "x.eml");

        // Either outcome is acceptable; a crash or a hang is not.
        if (result.IsFailure)
            result.Error!.Code.ShouldBe(ErrorCodes.EmailParseFailed);
        else
            result.Value.Subject.ShouldBe("nested");
    }

    [Fact]
    public async Task Huge_header_value_is_bounded()
    {
        var eml = $"From: A <a@x.test>\r\nSubject: s\r\nX-Big: {new string('h', 2_000_000)}\r\nDate: Mon, 12 Oct 2026 09:15:00 +0000\r\n\r\nbody\r\n";

        var result = await ParseAsync(Encoding.ASCII.GetBytes(eml), "x.eml");

        result.Value.Body.ShouldBe("body");
    }

    // ---- SEC-02: hostile HTML and headers must cost (almost) nothing and the work must really stop

    [Fact]
    public async Task Hostile_nested_html_eml_of_150_kb_is_read_in_well_under_a_second()
    {
        // Reproduction of SEC-02: 30,000 nested <div> (150 KB) made HtmlAgilityPack burn a core for more than 15 s.
        var html = string.Concat(Enumerable.Repeat("<div>", 30_000)) + "payload" + string.Concat(Enumerable.Repeat("</div>", 100));
        var eml = "From: A <a@x.test>\r\nSubject: hostile\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n" + html + "\r\n";
        eml.Length.ShouldBeGreaterThan(150_000);

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var result = await ParseAsync(Encoding.ASCII.GetBytes(eml), "hostile.eml");
        stopwatch.Stop();

        stopwatch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(1));
        result.Value.Subject.ShouldBe("hostile");
        result.Value.Body.ShouldBe("payload");
    }

    [Fact]
    public async Task Hostile_nested_html_eml_of_a_megabyte_is_still_fast()
    {
        var html = string.Concat(Enumerable.Repeat("<div><span><b>", 70_000)); // about 1 MB, never closed
        var eml = "From: A <a@x.test>\r\nSubject: hostile\r\nContent-Type: text/html\r\n\r\n" + html + "tail\r\n";

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var result = await ParseAsync(Encoding.ASCII.GetBytes(eml), "hostile.eml");
        stopwatch.Stop();

        stopwatch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(3)); // generous: the unit suite runs CPU-heavy tests in parallel
        result.IsSuccess.ShouldBeTrue();
    }

    [Fact]
    public async Task A_huge_decoded_header_is_rejected_before_the_slow_decoder_runs()
    {
        var eml = $"From: A <a@x.test>\r\nSubject: {new string('s', 5_000_000)}\r\nDate: Mon, 12 Oct 2026 09:15:00 +0000\r\n\r\nbody\r\n";

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var result = await ParseAsync(Encoding.ASCII.GetBytes(eml), "x.eml");
        stopwatch.Stop();

        result.Error!.Code.ShouldBe(ErrorCodes.EmailParseFailed);
        stopwatch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task A_huge_folded_subject_is_rejected_too()
    {
        var folded = string.Join("\r\n ", Enumerable.Repeat(new string('s', 70), 2_000));
        var eml = $"From: A <a@x.test>\r\nSubject: {folded}\r\n\r\nbody\r\n";

        (await ParseAsync(Encoding.ASCII.GetBytes(eml), "x.eml")).Error!.Code.ShouldBe(ErrorCodes.EmailParseFailed);
    }

    [Fact]
    public void A_cancelled_html_conversion_stops_instead_of_finishing_in_the_background()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var html = string.Concat(Enumerable.Repeat("<p>x</p>", 50_000));

        Should.Throw<OperationCanceledException>(() => HtmlToText.Convert(html, cancellationToken: cts.Token));
    }

    [Fact]
    public async Task Oversized_input_is_payload_too_large()
    {
        var service = Service(o => o.MaxEmailBytes = 1000);

        var result = await ParseAsync(new byte[1001], "x.eml", service);

        result.Error!.Type.ShouldBe(ErrorType.PayloadTooLarge);
        result.Error.Code.ShouldBe(ErrorCodes.PayloadTooLarge);
    }

    [Theory]
    [InlineData("x.pdf")]
    [InlineData("x.zip")]
    [InlineData("noextension")]
    [InlineData("")]
    public async Task Other_extensions_are_unsupported(string name)
    {
        var result = await ParseAsync("From: a@x.test\r\n\r\nx"u8.ToArray(), name);

        result.Error!.Type.ShouldBe(ErrorType.UnsupportedMediaType);
    }

    [Fact]
    public async Task Binary_content_with_an_eml_extension_is_rejected()
    {
        var zip = new byte[] { 0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0, 1, 2, 3 };

        var result = await ParseAsync(zip, "evil.eml");

        result.Error!.Code.ShouldBe(ErrorCodes.EmailParseFailed);
    }

    [Fact]
    public async Task Empty_file_is_a_parse_failure()
    {
        (await ParseAsync([], "x.eml")).Error!.Code.ShouldBe(ErrorCodes.EmailParseFailed);
    }

    [Fact]
    public async Task Msg_extension_without_the_ole_signature_is_rejected()
    {
        var result = await ParseAsync(File.ReadAllBytes(SamplePath("01-plain.eml")), "fake.msg");

        result.Error!.Code.ShouldBe(ErrorCodes.EmailParseFailed);
    }

    [Fact]
    public async Task Corrupt_msg_is_a_parse_failure_without_content_in_the_message()
    {
        var bytes = new byte[600];
        new byte[] { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 }.CopyTo(bytes, 0);

        var result = await ParseAsync(bytes, "broken.msg");

        result.Error!.Code.ShouldBe(ErrorCodes.EmailParseFailed);
    }

    [Fact]
    public async Task Msg_file_is_read_by_content_even_with_the_wrong_extension()
    {
        var msg = MsgFixture.Build("Quarterly review", "Pat Lee", "pat.lee@example-firm.test", "Please schedule the review.\r\nThanks", new DateTime(2026, 10, 13, 9, 12, 0, DateTimeKind.Utc));

        var email = (await ParseAsync(msg, "mail.eml")).Value;

        email.Source.ShouldBe(EmailSource.Msg);
    }

    [Fact]
    public async Task Msg_sample_yields_subject_sender_date_and_body()
    {
        var msg = MsgFixture.Build("Quarterly review", "Pat Lee", "pat.lee@example-firm.test", "Please schedule the review.\r\nThanks", new DateTime(2026, 10, 13, 9, 12, 0, DateTimeKind.Utc));

        var result = await ParseAsync(msg, "mail.msg");

        var email = result.IsSuccess ? result.Value : throw new Xunit.Sdk.XunitException(result.Error!.Message);
        email.Source.ShouldBe(EmailSource.Msg);
        email.Subject.ShouldBe("Quarterly review");
        email.FromName.ShouldBe("Pat Lee");
        email.FromEmail.ShouldBe("pat.lee@example-firm.test");
        email.SentAt.ShouldBe(new DateTimeOffset(2026, 10, 13, 9, 12, 0, TimeSpan.Zero));
        email.Body.ShouldBe("Please schedule the review.\nThanks");
    }

    [Fact]
    public async Task Msg_with_non_ascii_text()
    {
        var msg = MsgFixture.Build("Aktenprüfung 文书", "Jürgen Müller", "j@example-firm.test", "Grüße 文书", new DateTime(2026, 10, 13, 9, 12, 0, DateTimeKind.Utc));

        var email = (await ParseAsync(msg, "mail.msg")).Value;

        email.Subject.ShouldBe("Aktenprüfung 文书");
        email.FromName.ShouldBe("Jürgen Müller");
        email.Body.ShouldBe("Grüße 文书");
    }

    [Fact]
    public async Task Msg_with_an_exchange_address_warns_and_leaves_the_email_empty()
    {
        var msg = MsgFixture.Build("Hello", "Pat Lee", "/O=FIRM/OU=EXCHANGE/CN=RECIPIENTS/CN=PLEE", "Body", new DateTime(2026, 10, 13, 9, 12, 0, DateTimeKind.Utc), addressType: "EX");

        var email = (await ParseAsync(msg, "mail.msg")).Value;

        email.FromName.ShouldBe("Pat Lee");
        email.FromEmail.ShouldBeEmpty();
        email.Warnings.ShouldContain(w => w.Contains("internet address"));
    }

    [Fact]
    public void Pasted_text_goes_through_the_paste_parser()
    {
        var result = Service().ParsePastedText("From: Jane Doe <jane@x.test>\nSent: Monday, October 12, 2026 9:15 AM\nSubject: Hello\n\nBody here");

        result.Value.Source.ShouldBe(EmailSource.Text);
        result.Value.Subject.ShouldBe("Hello");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n ")]
    public void Empty_pasted_text_is_a_validation_error(string? text)
    {
        var error = Service().ParsePastedText(text).Error!;

        error.Type.ShouldBe(ErrorType.Validation);
        error.FieldErrors!.ShouldContainKey("pastedText");
    }

    [Fact]
    public void Oversized_pasted_text_is_payload_too_large()
    {
        var service = Service(o => o.MaxEmailBytes = 100);

        service.ParsePastedText(new string('a', 101)).Error!.Type.ShouldBe(ErrorType.PayloadTooLarge);
    }
}
