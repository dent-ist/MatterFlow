using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi;

namespace LptHub.Notes.Api;

/// <summary>
/// Describes the multipart body of the image upload as one inline binary field named <c>file</c> (the form model's <c>IFormFile</c> property would otherwise be published as a separate component,
/// which the generated client does not recognise as a file upload; the same treatment as <c>parse-email</c>).
/// </summary>
internal static class NoteImagesOpenApi
{
    private const string Path = "/api/v1/matters/{matterId}/note-images";

    public static IServiceCollection AddNoteImagesOpenApi(this IServiceCollection services) =>
        services.Configure<OpenApiOptions>("v1", (OpenApiOptions options) => options.AddDocumentTransformer((document, _, _) =>
        {
            if (document.Paths.TryGetValue(Path, out var item)
                && item.Operations is { } operations
                && operations.TryGetValue(HttpMethod.Post, out var operation)
                && operation.RequestBody is OpenApiRequestBody { Content: { } content })
            {
                content["multipart/form-data"] = new OpenApiMediaType
                {
                    Schema = new OpenApiSchema
                    {
                        Type = JsonSchemaType.Object,
                        Required = new HashSet<string> { "file" },
                        Properties = new Dictionary<string, IOpenApiSchema>
                        {
                            ["file"] = new OpenApiSchema { Type = JsonSchemaType.String, Format = "binary", Description = "The image: PNG or JPEG, at most 2 MB." },
                        },
                    },
                };
            }

            document.Components?.Schemas?.Remove("IFormFile");
            return Task.CompletedTask;
        }));
}
