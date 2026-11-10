using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi;

namespace MatterFlow.Configuration.Api;

/// <summary>
/// Describes the multipart body of <c>PUT /api/v1/admin/settings/branding/icon</c> (the action reads the form itself so it can answer an oversized
/// or damaged upload with a stable problem code): one binary field <c>file</c> and the text field <c>rowVersion</c>.
/// </summary>
internal static class BrandingOpenApi
{
    private const string Path = "/api/v1/admin/settings/branding/icon";

    public static IServiceCollection AddBrandingOpenApi(this IServiceCollection services) =>
        services.Configure<OpenApiOptions>("v1", (OpenApiOptions options) => options.AddDocumentTransformer((document, _, _) =>
        {
            if (document.Paths.TryGetValue(Path, out var item)
                && item.Operations is { } operations
                && operations.TryGetValue(HttpMethod.Put, out var operation))
            {
                operation.RequestBody = new OpenApiRequestBody
                {
                    Required = true,
                    Content = new Dictionary<string, OpenApiMediaType>
                    {
                        ["multipart/form-data"] = new OpenApiMediaType
                        {
                            Schema = new OpenApiSchema
                            {
                                Type = JsonSchemaType.Object,
                                Required = new HashSet<string> { "file", "rowVersion" },
                                Properties = new Dictionary<string, IOpenApiSchema>
                                {
                                    ["file"] = new OpenApiSchema { Type = JsonSchemaType.String, Format = "binary", Description = "The icon: PNG, SVG or ICO, square, at most 256 KB." },
                                    ["rowVersion"] = new OpenApiSchema { Type = JsonSchemaType.String, Description = "The icon's row version from the last read; empty when no custom icon existed." },
                                },
                            },
                        },
                    },
                };
            }

            return Task.CompletedTask;
        }));
}
