using System.Text.Json.Serialization;
using MatterFlow.Api;
using MatterFlow.Api.Http;
using MatterFlow.Api.OpenApi;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddMatterFlowModules();
builder.Services
    .AddControllers()
    .AddApplicationPart(typeof(Program).Assembly)
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        o.JsonSerializerOptions.NumberHandling = JsonNumberHandling.Strict;
    })
    .ConfigureApiBehaviorOptions(o =>
    {
        o.InvalidModelStateResponseFactory = ctx =>
        {
            var problem = Problems.FromModelState(ctx.HttpContext, ctx.ModelState);
            return new ObjectResult(problem) { StatusCode = problem.Status, ContentTypes = { Problems.ContentType } };
        };
    });
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.SerializerOptions.NumberHandling = JsonNumberHandling.Strict; // keeps numbers as plain integers in the OpenAPI schemas
});
builder.Services.AddHealthChecks();
builder.Services.AddSchemaMigrations(builder.Configuration);
builder.Services.AddUserTimeZone();
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddProblemDetails(o =>
{
    // Framework-generated problems (404, 401, 415, ...) get the same stable code/traceId extensions.
    o.CustomizeProblemDetails = ctx =>
    {
        if (!ctx.ProblemDetails.Extensions.ContainsKey("code"))
        {
            var status = ctx.ProblemDetails.Status ?? ctx.HttpContext.Response.StatusCode;
            var code = Problems.CodeForStatus(status);
            ctx.ProblemDetails.Type = Problems.TypeUri(code);
            Problems.Decorate(ctx.ProblemDetails, ctx.HttpContext, code);
        }
    };
});
builder.Services.AddMatterFlowOpenApi();

var app = builder.Build();

// Schema scripts run before the host listens, so no request can hit an old schema (architecture 4.3).
// Skipped when the build-time OpenAPI generator (GetDocument.Insider) starts the app only to read its API description.
if (System.Reflection.Assembly.GetEntryAssembly()?.GetName().Name != "GetDocument.Insider")
    await app.Services.RunSchemaMigrationsAsync();

app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
    app.MapOpenApi("/openapi/{documentName}.json");

app.MapHealthChecks("/health/live");
app.MapControllers();

app.Run();

// Exposed for WebApplicationFactory<Program> in integration tests.
public partial class Program;
