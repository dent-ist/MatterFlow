using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace MatterFlow.Data.SchemaMigrations;

public static class SchemaMigrationExtensions
{
    /// <summary>Registers <see cref="MigrationsOptions"/> bound from the <c>Migrations</c> section.</summary>
    public static IServiceCollection AddSchemaMigrations(this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection(MigrationsOptions.SectionName);
        var options = new MigrationsOptions();
        if (bool.TryParse(section[nameof(MigrationsOptions.Enabled)], out var enabled))
        {
            options.Enabled = enabled;
        }

        options.ScriptsFolder = string.IsNullOrWhiteSpace(section[nameof(MigrationsOptions.ScriptsFolder)])
            ? null
            : section[nameof(MigrationsOptions.ScriptsFolder)];
        if (int.TryParse(section[nameof(MigrationsOptions.LockTimeoutSeconds)], out var lockTimeout))
        {
            options.LockTimeoutSeconds = lockTimeout;
        }

        if (int.TryParse(section[nameof(MigrationsOptions.CommandTimeoutSeconds)], out var commandTimeout))
        {
            options.CommandTimeoutSeconds = commandTimeout;
        }

        if (!string.IsNullOrWhiteSpace(section[nameof(MigrationsOptions.ConnectionStringName)]))
        {
            options.ConnectionStringName = section[nameof(MigrationsOptions.ConnectionStringName)]!;
        }

        services.AddSingleton(options);
        services.AddSingleton(configuration);
        return services;
    }

    /// <summary>
    /// Runs pending scripts when <c>Migrations:Enabled</c> is true. Call after Build() and before the host starts listening.
    /// Throws <see cref="SchemaMigrationException"/> on any problem.
    /// </summary>
    public static async Task RunSchemaMigrationsAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        var options = services.GetRequiredService<MigrationsOptions>();
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();
        if (!options.Enabled)
        {
            loggerFactory.CreateLogger("MatterFlow.SchemaMigrations").LogInformation("Schema migrations are disabled (Migrations:Enabled=false).");
            return;
        }

        var configuration = services.GetRequiredService<IConfiguration>();
        var connectionString = configuration.GetConnectionString(options.ConnectionStringName)
            ?? configuration.GetConnectionString("Default")
            ?? throw new SchemaMigrationException(
                $"No connection string found: set ConnectionStrings:{options.ConnectionStringName} (or ConnectionStrings:Default), or set Migrations:Enabled=false.");

        IMigrationScriptSource source = options.ScriptsFolder is null
            ? new EmbeddedMigrationScriptSource()
            : new FolderMigrationScriptSource(options.ScriptsFolder);

        var runner = new SchemaMigrationRunner(connectionString, source, options, loggerFactory.CreateLogger<SchemaMigrationRunner>());
        await runner.RunAsync(cancellationToken);
    }
}
