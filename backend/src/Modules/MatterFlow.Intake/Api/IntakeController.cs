using MatterFlow.Identity.Contracts;
using MatterFlow.Intake.Application;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace MatterFlow.Intake.Api;

/// <summary>Multipart body of the file variant of <c>parse-email</c>.</summary>
public sealed class ParseEmailFileForm
{
    /// <summary>The <c>.eml</c> or <c>.msg</c> file (at most 10 MB).</summary>
    public IFormFile? File { get; set; }
}

/// <summary>
/// Create-from-email intake (architecture section 13): parse and discard. Nothing is stored: the file or text is read in memory, the
/// extracted values are returned and the original is dropped when the request ends.
/// </summary>
[ApiController]
[Route("api/v1/intake")]
[IntakeRequestLimits]
public class IntakeController(EmailParseService emails) : ControllerBase
{
    /// <summary>Hard ceiling of the upload size (the configured <c>Intake:MaxEmailBytes</c> may lower it).</summary>
    internal const long MaxUploadBytes = 10 * 1024 * 1024;

    private const string Policy = "Perm:" + Permissions.Task.Create;

    /// <summary>
    /// Reads an uploaded <c>.eml</c> or <c>.msg</c> (multipart field <c>file</c>, at most 10 MB) and returns subject, body, sender and
    /// sent date. Attachments and their names are ignored and nothing is stored.
    /// </summary>
    [HttpPost("parse-email", Name = "ParseEmailFile")]
    [Consumes("multipart/form-data")]
    [Authorize(Policy = Policy)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes + 1024 * 1024, MemoryBufferThreshold = (int)(MaxUploadBytes + 1024 * 1024), ValueCountLimit = 8, MultipartHeadersCountLimit = 16)]
    [ProducesResponseType<ParsedEmailResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ParseFile([FromForm] ParseEmailFileForm form, CancellationToken cancellationToken)
    {
        if (form.File is not { Length: > 0 } file)
            return this.Problem(Error.Validation("file", "REQUIRED", "Choose a .eml or .msg file."));

        await using var stream = file.OpenReadStream();
        return this.ToActionResult(await emails.ParseFileAsync(stream, file.FileName, cancellationToken));
    }

    /// <summary>Reads pasted email text (an Outlook header block plus body, or just a body) and returns the same values.</summary>
    [HttpPost("parse-email/text", Name = "ParseEmailText")]
    [Authorize(Policy = Policy)]
    [ProducesResponseType<ParsedEmailResponse>(StatusCodes.Status200OK, "application/json")]
    public IActionResult ParseText([FromBody] ParsePastedTextRequest request) =>
        this.ToActionResult(emails.ParsePastedText(request.PastedText, request.PastedHtml));

    /// <summary>
    /// The same pasted-text endpoint on the shared <c>parse-email</c> URL: one route accepts both a multipart upload and a JSON body
    /// <c>{ "pastedText": "..." }</c>. Hidden from the API description because one path cannot describe two request bodies for the
    /// generated client; <c>parse-email/text</c> is its documented twin.
    /// </summary>
    [HttpPost("parse-email", Name = "ParseEmailJson")]
    [Consumes("application/json")]
    [Authorize(Policy = Policy)]
    [ApiExplorerSettings(IgnoreApi = true)]
    public IActionResult ParseTextOnSharedRoute([FromBody] ParsePastedTextRequest request) => ParseText(request);
}

/// <summary>
/// Applies the size ceiling to the request, answers an oversized upload with a 413 problem before reading it, and turns failures of the
/// form reader (limits exceeded, truncated or malformed multipart) into problems that never echo content.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
internal sealed class IntakeRequestLimitsAttribute : Attribute, IAsyncResourceFilter, IExceptionFilter
{
    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        var feature = context.HttpContext.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false })
            feature.MaxRequestBodySize = IntakeController.MaxUploadBytes + 2 * 1024 * 1024;

        if (request.ContentLength > IntakeController.MaxUploadBytes + 2 * 1024 * 1024)
        {
            context.Result = Problem(context, Tooling.PayloadTooLarge);
            return;
        }

        await next();
    }

    public void OnException(ExceptionContext context)
    {
        var error = context.Exception switch
        {
            BadHttpRequestException { StatusCode: StatusCodes.Status413PayloadTooLarge } => Tooling.PayloadTooLarge,
            InvalidDataException => Tooling.PayloadTooLarge,
            BadHttpRequestException or IOException or InvalidOperationException { Source: "Microsoft.AspNetCore.Http" } => Tooling.Unreadable,
            _ => null,
        };

        if (error is null)
            return;

        context.Result = Problem(context, error);
        context.ExceptionHandled = true;
    }

    private static IActionResult Problem(ActionContext context, Error error)
    {
        var controller = new ProblemCarrier { ControllerContext = new ControllerContext(context) };
        return controller.Problem(error);
    }

    private sealed class ProblemCarrier : ControllerBase;

    private static class Tooling
    {
        public static readonly Error PayloadTooLarge = new(ErrorType.PayloadTooLarge, ErrorCodes.PayloadTooLarge, "The email is larger than 10 MB. Save a smaller message or paste the text instead.");

        public static readonly Error Unreadable = new(ErrorType.Validation, ErrorCodes.EmailParseFailed, "The upload could not be read. Paste the email text instead.");
    }
}
