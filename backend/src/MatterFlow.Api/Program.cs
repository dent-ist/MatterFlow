using System.Text.Json.Serialization;
using MatterFlow.Api;
using MatterFlow.Api.Http;
using MatterFlow.Api.OpenApi;
using MatterFlow.Api.Security;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);

// No `Server: Kestrel` banner (SEC-08). Request bodies are capped by RequestBodyLimitMiddleware (SEC-19).
builder.WebHost.ConfigureKestrel(o => o.AddServerHeader = false);
builder.Services.AddHsts(o => o.MaxAge = TimeSpan.FromDays(365));

builder.Services.AddMatterFlowModules(builder.Configuration, builder.Environment);
builder.Services
    .AddControllers(o => o.Filters.Add<ErrorResultFilter>())
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
// Policies (e.g. Audit.View) are registered by the Identity/authorization module; the host only enables the middleware.
builder.Services.AddAuthorization();
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
builder.Services.AddSingleton<IAuthorizationMiddlewareResultHandler, AuthorizationResultHandler>();

var app = builder.Build();

// Schema scripts run before the host listens, so no request can hit an old schema (architecture 4.3).
// Skipped when the build-time OpenAPI generator (GetDocument.Insider) starts the app only to read its API description.
if (System.Reflection.Assembly.GetEntryAssembly()?.GetName().Name != "GetDocument.Insider")
{
    await app.Services.RunSchemaMigrationsAsync();

    // Startup seeds (permission catalog, starter roles, dev users) need the migrated schema (architecture 4.3, 4.6). They run whenever the
    // API has a database, also when a separate step migrated it (Migrations:Enabled=false), so new permission codes are synced after upgrades;
    // Seeds:Enabled=false turns them off (security review SEC-18).
    var configuration = app.Services.GetRequiredService<IConfiguration>();
    var hasDatabase = !string.IsNullOrWhiteSpace(configuration.GetConnectionString("MatterFlow"));
    var seedsEnabled = app.Services.GetRequiredService<MigrationsOptions>().Enabled || (hasDatabase && configuration.GetValue("Seeds:Enabled", true));
    if (seedsEnabled)
        await app.Services.RunModuleSeedsAsync();

    // Until the Task module registers the real guard, a Matter with open Tasks can be deactivated (security review SEC-23).
    await using (var guardScope = app.Services.CreateAsyncScope())
    {
        if (guardScope.ServiceProvider.GetRequiredService<MatterFlow.Organization.Contracts.IMatterTaskGuard>() is MatterFlow.Organization.Contracts.NoTasksMatterTaskGuard)
        {
            app.Logger.LogWarning("The placeholder IMatterTaskGuard is registered: Matters can be deactivated although they have open Tasks. The Task module must Replace it.");
        }
    }

    // The API's own database identity must not be able to rewrite the audit trail (security review SEC-04).
    if (seedsEnabled)
    {
        await AuditStoreGuard.VerifyAsync(app.Services);
        await DatabaseSettingsCheck.VerifyAsync(app.Services);
    }
}

// HSTS (browsers then refuse plain HTTP for a year) and the security headers come first so that error responses carry them too.
if (!app.Environment.IsDevelopment())
    app.UseHsts();
app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseMiddleware<RequestBodyLimitMiddleware>();

app.UseExceptionHandler();
app.UseStatusCodePages();

app.UseMiddleware<RequestForgeryGuard>();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

if (app.Environment.IsDevelopment())
    app.MapOpenApi("/openapi/{documentName}.json").AllowAnonymous();

app.MapHealthChecks("/health/live").AllowAnonymous();
app.MapControllers();

app.Run();

// Exposed for WebApplicationFactory<Program> in integration tests.
public partial class Program;
