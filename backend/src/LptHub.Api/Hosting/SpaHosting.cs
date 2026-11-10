using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace MatterFlow.Api.Hosting;

/// <summary>
/// Serves the Angular production build from <c>wwwroot</c> on the same origin as the API (architecture section 2): static files with cache
/// headers, compression, and a fallback to <c>index.html</c> for client-side routes. Active when <c>Hosting:ServeSpa</c> is true, or when it is
/// unset, the environment is not Development and <c>wwwroot/index.html</c> exists (so an API-only run and the dev server proxy keep working).
/// </summary>
public static partial class SpaHosting
{
    public const string ServeSpaSetting = "Hosting:ServeSpa";
    public const string IndexFile = "index.html";

    /// <summary>Paths that belong to the server: they never fall back to <c>index.html</c>, so a wrong API URL stays a 404 problem response.</summary>
    private static readonly string[] ServerPrefixes = ["/api", "/health", "/openapi"];

    /// <summary>Content hashed by the Angular build (<c>main-ABC123XY.js</c>): the file name changes with the content, so it may be cached for good.</summary>
    [GeneratedRegex(@"-[A-Za-z0-9]{8}\.[A-Za-z0-9]+$")]
    private static partial Regex HashedFileName();

    public static bool IsEnabled(IConfiguration configuration, IWebHostEnvironment environment)
    {
        var configured = configuration.GetValue<bool?>(ServeSpaSetting);
        if (configured is not null)
            return configured.Value;

        return !environment.IsDevelopment() && environment.WebRootFileProvider.GetFileInfo(IndexFile).Exists;
    }

    /// <summary>Gzip and Brotli for text assets. JSON is left out on purpose: compressing secret-bearing API responses over HTTPS invites BREACH-style attacks.</summary>
    public static IServiceCollection AddMatterFlowSpaCompression(this IServiceCollection services) =>
        services.AddResponseCompression(o =>
        {
            o.EnableForHttps = true;
            o.MimeTypes = ["text/html", "text/css", "text/plain", "text/javascript", "application/javascript", "image/svg+xml", "application/manifest+json", "font/ttf", "font/otf"];
        });

    /// <summary>Compression and static files. Call after the error handling and before the API guards.</summary>
    public static void UseMatterFlowStaticFiles(this WebApplication app)
    {
        app.UseResponseCompression();
        app.UseStaticFiles(new StaticFileOptions
        {
            OnPrepareResponse = ctx => ApplyCacheHeaders(ctx.Context.Response.Headers, ctx.File.Name),
            ContentTypeProvider = CreateContentTypeProvider(),
        });
    }

    /// <summary>Client routes (no file extension) that match no endpoint answer with <c>index.html</c>.</summary>
    public static void MapMatterFlowSpaFallback(this WebApplication app)
    {
        app.MapFallback("{**path:nonfile}", async context =>
        {
            var path = context.Request.Path;
            if (ServerPrefixes.Any(p => path.StartsWithSegments(p, StringComparison.OrdinalIgnoreCase)))
            {
                // Same result as with no fallback at all: the status code pages middleware turns the empty 404 into a ProblemDetails body.
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            var file = context.RequestServices.GetRequiredService<IWebHostEnvironment>().WebRootFileProvider.GetFileInfo(IndexFile);
            if (!file.Exists)
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            ApplyCacheHeaders(context.Response.Headers, IndexFile);
            context.Response.ContentType = "text/html; charset=utf-8";
            if (HttpMethods.IsHead(context.Request.Method))
            {
                context.Response.ContentLength = file.Length;
                return;
            }

            await context.Response.SendFileAsync(file, context.RequestAborted);
        }).WithMetadata(new HttpMethodMetadata([HttpMethods.Get, HttpMethods.Head]));
    }

    /// <summary>Hashed build output is immutable for a year; everything else (index.html, config, icons) must be revalidated on each load so a new release is picked up at once.</summary>
    internal static void ApplyCacheHeaders(IHeaderDictionary headers, string fileName) =>
        headers[HeaderNames.CacheControl] = HashedFileName().IsMatch(fileName) && !fileName.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
            ? "public, max-age=31536000, immutable"
            : "no-cache";

    private static FileExtensionContentTypeProvider CreateContentTypeProvider()
    {
        var provider = new FileExtensionContentTypeProvider();
        provider.Mappings[".webmanifest"] = "application/manifest+json";
        provider.Mappings[".woff2"] = "font/woff2";
        return provider;
    }
}
