using MatterFlow.Api;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddMatterFlowModules();
builder.Services.AddHealthChecks();

var app = builder.Build();

app.MapHealthChecks("/health/live");
app.MapControllers();

app.Run();

// Exposed for WebApplicationFactory<Program> in integration tests.
public partial class Program;
