using MatterFlow.Data.SchemaMigrations;
using Microsoft.Extensions.Hosting;

namespace MatterFlow.Api.Hosting;

/// <summary>
/// <c>MatterFlow.Api.exe --migrate-only</c> (or <c>MATTERFLOW_MIGRATE_ONLY=true</c>): applies the pending schema scripts with the
/// <c>ConnectionStrings:Migrations</c> login and exits with 0 (up to date) or 1 (failed), without starting the web host, seeds or the
/// audit-store guard. The DBA runs it before swapping binaries (architecture 4.3 item 9, docs/runbook.md section 7). The normal startup
/// migration is unchanged.
/// </summary>
public static class MigrateOnlyCommand
{
    public const string Switch = "--migrate-only";
    public const string EnvironmentVariable = "MATTERFLOW_MIGRATE_ONLY";

    public static bool IsRequested(string[] args, Func<string, string?>? getEnvironmentVariable = null)
    {
        if (args.Contains(Switch, StringComparer.OrdinalIgnoreCase))
            return true;

        var value = (getEnvironmentVariable ?? Environment.GetEnvironmentVariable)(EnvironmentVariable);
        return (bool.TryParse(value, out var enabled) && enabled) || value == "1";
    }

    /// <summary>Returns the process exit code. Configuration sources are the same as the web host's (appsettings, environment, command line).</summary>
    public static async Task<int> RunAsync(string[] args, CancellationToken cancellationToken = default)
    {
        // The configuration command-line provider would read the value of a bare switch from the next argument, so the switch is removed first.
        var configurationArgs = args.Where(a => !a.Equals(Switch, StringComparison.OrdinalIgnoreCase)).ToArray();
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
        {
            Args = configurationArgs,
            // Same environment name as the web host (ASPNETCORE_ENVIRONMENT, so appsettings.<Environment>.json is found) and the settings files next to the binaries, wherever the command is run from.
            EnvironmentName = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"),
            ContentRootPath = AppContext.BaseDirectory,
        });
        builder.Services.AddSchemaMigrations(builder.Configuration);
        using var host = builder.Build();
        var logger = host.Services.GetRequiredService<ILoggerFactory>().CreateLogger("MatterFlow.MigrateOnly");

        try
        {
            // The command exists to migrate, so Migrations:Enabled=false (a switch for the web host) does not apply here.
            host.Services.GetRequiredService<MigrationsOptions>().Enabled = true;
            logger.LogInformation("Applying pending schema scripts (migrate-only).");
            await host.Services.RunSchemaMigrationsAsync(cancellationToken);
            logger.LogInformation("Migrate-only finished: the schema is up to date.");
            return 0;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Migrate-only failed: {Message}", ex.Message);
            return 1;
        }
    }
}
