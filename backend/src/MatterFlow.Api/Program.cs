using MatterFlow.Api;
using MatterFlow.Data.SchemaMigrations;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddMatterFlowModules();
builder.Services.AddHealthChecks();
builder.Services.AddSchemaMigrations(builder.Configuration);

var app = builder.Build();

// Schema scripts run before the host listens, so no request can hit an old schema (architecture 4.3).
await app.Services.RunSchemaMigrationsAsync();

app.MapHealthChecks("/health/live");
app.MapControllers();

app.Run();

// Exposed for WebApplicationFactory<Program> in integration tests.
public partial class Program;
