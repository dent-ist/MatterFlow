using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi;

namespace MatterFlow.Intake.Api;

/// <summary>
/// Describes the multipart body of <c>parse-email</c> as one inline binary field named <c>file</c> (the form model's <c>IFormFile</c>
/// property would otherwise be published as a separate component, which the generated client does not recognise as a file upload).
/// </summary>
internal static class IntakeOpenApi
{
    private const string Path = "/api/v1/intake/parse-email";

    public static IServiceCollection AddIntakeOpenApi(this IServiceCollection services) =>
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
                            ["file"] = new OpenApiSchema { Type = JsonSchemaType.String, Format = "binary", Description = "The .eml or .msg file (at most 10 MB)." },
                        },
                    },
                };
            }

            document.Components?.Schemas?.Remove("IFormFile");
            return Task.CompletedTask;
        }));
}
