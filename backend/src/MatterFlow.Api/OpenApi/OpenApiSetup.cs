using System.Text.Json.Nodes;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace MatterFlow.Api.OpenApi;

/// <summary>OpenAPI document generation (architecture section 11): one "v1" document, committed to contracts/openapi/v1.json.</summary>
public static class OpenApiSetup
{
    public const string DocumentName = "v1";

    public static IServiceCollection AddMatterFlowOpenApi(this IServiceCollection services)
    {
        services.AddOpenApi(DocumentName, options =>
        {
            options.AddDocumentTransformer((document, _, _) =>
            {
                document.Info = new OpenApiInfo { Title = "MatterFlow API", Version = "v1" };
                return Task.CompletedTask;
            });
            options.AddSchemaTransformer(ErrorCodeEnumTransformer);
        });
        return services;
    }

    /// <summary>Makes the stable error codes a closed enum on <c>ApiProblemDetails.code</c> and <c>ApiFieldError.code</c> stays free-form.</summary>
    private static Task ErrorCodeEnumTransformer(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken cancellationToken)
    {
        if (context.JsonTypeInfo.Type == typeof(Http.ApiProblemDetails) && schema.Properties is not null && schema.Properties.TryGetValue("code", out var code) && code is OpenApiSchema codeSchema)
        {
            codeSchema.Enum = ErrorCodes.All.Select(c => (JsonNode)JsonValue.Create(c)!).ToList();
            codeSchema.Description = "Stable machine-readable error code.";
        }

        return Task.CompletedTask;
    }
}
