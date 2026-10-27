using MatterFlow.Configuration.Application.Settings;
using MatterFlow.Configuration.Domain.Settings;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Net.Http.Headers;

namespace MatterFlow.Configuration.Api;

/// <summary>
/// The public branding endpoints (epic #850, design section 5): the application name and the custom icon, readable without signing in so the
/// sign-in and error pages and the browser tab icon can show them. They return nothing but the name and the icon and set no cookie. They are
/// the only <c>/api</c> responses that may be cached by shared caches (see <c>SecurityHeadersMiddleware</c>); every other path stays <c>no-store</c>.
/// </summary>
[ApiController]
[Route("api/v1/branding")]
[Produces("application/json")]
public class BrandingController(BrandingService branding) : ControllerBase
{
    /// <summary><c>Cache-Control</c> of the name and version: a minute in the browser, then revalidate with the ETag.</summary>
    internal const string ViewCacheControl = "public, max-age=60, must-revalidate";

    /// <summary><c>Cache-Control</c> of the icon: an hour; the app always asks for <c>?v=&lt;version&gt;</c>, so a changed icon is a new URL.</summary>
    internal const string IconCacheControl = "public, max-age=3600";

    /// <summary>Policy of an SVG icon response: nothing loads, nothing runs, and the document is sandboxed even if someone opens the URL directly.</summary>
    internal const string SvgContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'";

    /// <summary>The application name, the custom icon address (null while the built-in icons are used) and the version. Anonymous; ETag and <c>304</c>.</summary>
    [HttpGet(Name = "GetBranding")]
    [AllowAnonymous]
    [ProducesResponseType<BrandingView>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var view = await branding.GetPublicAsync(cancellationToken);
        var etag = ETagOf(view.Version);
        Response.Headers.ETag = etag;
        Response.Headers.CacheControl = ViewCacheControl;
        return Matches(Request, etag) ? StatusCode(StatusCodes.Status304NotModified) : Ok(view);
    }

    /// <summary>
    /// The custom icon bytes with the type found by content when it was uploaded. Anonymous. <c>404</c> when no custom icon is set (the built-in
    /// files stay in use). An SVG is served with a sandbox policy as a second line of defence.
    /// </summary>
    [HttpGet("icon", Name = "GetBrandingIcon")]
    [AllowAnonymous]
    [Produces("image/png", "image/svg+xml", "image/x-icon")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status304NotModified)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetIcon(CancellationToken cancellationToken)
    {
        var icon = await branding.GetIconAsync(cancellationToken);
        if (icon is null)
            return NotFound();

        var etag = ETagOf(icon.Version);
        Response.Headers.ETag = etag;
        Response.Headers.CacheControl = IconCacheControl;
        Response.Headers.ContentDisposition = "inline";
        if (icon.ContentType == IconInspector.SvgContentType)
            Response.Headers.ContentSecurityPolicy = SvgContentSecurityPolicy;
        if (Matches(Request, etag))
            return StatusCode(StatusCodes.Status304NotModified);

        return File(icon.Bytes, icon.ContentType);
    }

    private static string ETagOf(string version) => "\"" + version + "\"";

    /// <summary>True when <c>If-None-Match</c> names this version (a weak tag counts too, as the comparison for <c>304</c> is weak) or is <c>*</c>.</summary>
    private static bool Matches(HttpRequest request, string etag) =>
        request.GetTypedHeaders().IfNoneMatch.Any(v => v.Tag == "*" || string.Equals(v.Tag.Value, etag, StringComparison.Ordinal));
}

/// <summary>
/// Administration of the branding (Administration &gt; Settings &gt; Branding): read, change and reset the application name and icon. Needs
/// <c>Settings.Manage</c>. Writes are audited and use row versions (<c>409 CONCURRENCY_CONFLICT</c>). Failures are problem+json with a stable
/// <c>BRANDING_NAME_*</c> or <c>BRANDING_ICON_*</c> code and a field error on <c>appName</c> or <c>file</c>.
/// </summary>
[ApiController]
[Route("api/v1/admin/settings/branding")]

public class SettingsBrandingController(BrandingService branding) : ControllerBase
{
    /// <summary>Largest request body of an icon upload (the file is at most 256 KB; the rest is the multipart envelope).</summary>
    internal const long MaxRequestBytes = IconInspector.HardStopBytes + 4096;

    /// <summary>The current branding with row versions, the last change and the limits.</summary>
    [HttpGet(Name = "GetBrandingSettings")]
    [Authorize(Policy = ConfigurationPolicies.SettingsManage)]
    [ProducesResponseType<BrandingAdminView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<BrandingAdminView>> Get(CancellationToken cancellationToken) => await branding.GetAdminAsync(cancellationToken);

    /// <summary>Changes the application name. 400 <c>BRANDING_NAME_*</c>, 409 when someone changed it meanwhile.</summary>
    [HttpPut("name", Name = "SetBrandingName")]
    [Authorize(Policy = ConfigurationPolicies.SettingsManage)]
    [ProducesResponseType<BrandingAdminView>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetName([FromBody] SetBrandingNameRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await branding.SetNameAsync(request, cancellationToken));

    /// <summary>
    /// Uploads the application icon: <c>multipart/form-data</c> with the field <c>file</c> (PNG, SVG or ICO, at most 256 KB) and the field
    /// <c>rowVersion</c> (empty when no custom icon existed). The request body is capped at 300 KB before it is read.
    /// </summary>
    [HttpPut("icon", Name = "SetBrandingIcon")]
    [Authorize(Policy = ConfigurationPolicies.SettingsManage)]
    [Consumes("multipart/form-data")]
    [BrandingUploadLimits]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxRequestBytes, MemoryBufferThreshold = (int)MaxRequestBytes, ValueCountLimit = 4, MultipartHeadersCountLimit = 8)]
    [ProducesResponseType<BrandingAdminView>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetIcon(CancellationToken cancellationToken)
    {
        IFormCollection form;
        try
        {
            form = await Request.ReadFormAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is InvalidDataException || ex.InnerException is InvalidDataException || ex is BadHttpRequestException { StatusCode: StatusCodes.Status413PayloadTooLarge })
        {
            return this.Problem(TooLargeError);
        }
        catch (Exception ex) when (ex is BadHttpRequestException or IOException or InvalidOperationException { Source: "Microsoft.AspNetCore.Http" })
        {
            return this.Problem(IconError(ErrorCodes.BrandingIconCorrupt, "The upload could not be read. Choose the file again."));
        }

        if (form.Files.GetFile("file") is not { Length: > 0 } file)
            return this.Problem(IconError(ErrorCodes.BrandingIconTypeUnsupported, "Choose a PNG, SVG or ICO file."));
        if (file.Length > IconInspector.MaxBytes)
            return this.Problem(IconError(ErrorCodes.BrandingIconTooLarge, "The icon is larger than 256 KB."));

        byte[] bytes;
        await using (var stream = file.OpenReadStream())
        {
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer, cancellationToken);
            bytes = buffer.ToArray();
        }

        return this.ToActionResult(await branding.SetIconAsync(bytes, form["rowVersion"].ToString(), cancellationToken));
    }

    /// <summary>Resets the name to the default (<c>MatterFlow</c>) by deleting the stored value.</summary>
    [HttpDelete("name", Name = "ResetBrandingName")]
    [Authorize(Policy = ConfigurationPolicies.SettingsManage)]
    [ProducesResponseType<BrandingAdminView>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ResetName([FromQuery] string? rowVersion, CancellationToken cancellationToken) =>
        this.ToActionResult(await branding.ResetNameAsync(rowVersion, cancellationToken));

    /// <summary>Resets the icon to the built-in files by deleting the stored value.</summary>
    [HttpDelete("icon", Name = "ResetBrandingIcon")]
    [Authorize(Policy = ConfigurationPolicies.SettingsManage)]
    [ProducesResponseType<BrandingAdminView>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ResetIcon([FromQuery] string? rowVersion, CancellationToken cancellationToken) =>
        this.ToActionResult(await branding.ResetIconAsync(rowVersion, cancellationToken));

    internal static readonly Error TooLargeError = new(
        ErrorType.PayloadTooLarge,
        ErrorCodes.BrandingIconTooLarge,
        "The icon is larger than 256 KB.",
        new Dictionary<string, IReadOnlyList<FieldError>> { ["file"] = [new FieldError(ErrorCodes.BrandingIconTooLarge, "The icon is larger than 256 KB.")] });

    private static Error IconError(string code, string message) => Error.Validation("file", code, message, code);
}

/// <summary>
/// Caps the icon upload before anything reads it: the request body may be at most 300 KB (plus the multipart envelope); a larger declared length is
/// answered with a <c>413</c> problem without reading a byte. Also keeps MVC from parsing the form itself (the action reads it inside a guard),
/// so a damaged or oversized body never turns into a generic model-state error.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
internal sealed class BrandingUploadLimitsAttribute : Attribute, IAsyncResourceFilter
{
    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var http = context.HttpContext;
        var feature = http.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false })
            feature.MaxRequestBodySize = SettingsBrandingController.MaxRequestBytes;

        if (http.Request.ContentLength > SettingsBrandingController.MaxRequestBytes)
        {
            context.Result = new ProblemCarrier { ControllerContext = new ControllerContext(context) }.Problem(SettingsBrandingController.TooLargeError);
            return;
        }

        for (var i = context.ValueProviderFactories.Count - 1; i >= 0; i--)
        {
            if (context.ValueProviderFactories[i] is Microsoft.AspNetCore.Mvc.ModelBinding.FormValueProviderFactory or Microsoft.AspNetCore.Mvc.ModelBinding.FormFileValueProviderFactory)
                context.ValueProviderFactories.RemoveAt(i);
        }

        await next();
    }

    private sealed class ProblemCarrier : ControllerBase;
}
