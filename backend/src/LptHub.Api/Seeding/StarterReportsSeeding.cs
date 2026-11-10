using MatterFlow.Reports.Application.Starters;

namespace MatterFlow.Api.Seeding;

/// <summary>Settings of the starter reports seed (<c>Seed:StarterReports</c>, issue #724). Same meaning as <see cref="StarterConfigurationOptions"/>.</summary>
/// <param name="Enabled">Whether the seed runs at startup. Default: on in Development, off everywhere else.</param>
/// <param name="DryRun">Only log what would be created; write nothing.</param>
public sealed record StarterReportsOptions(bool Enabled, bool DryRun)
{
    public const string SectionName = "Seed:StarterReports";

    public static StarterReportsOptions From(IConfiguration configuration, IHostEnvironment environment)
    {
        var section = configuration.GetSection(SectionName);
        return new StarterReportsOptions(
            section.GetValue<bool?>("Enabled") ?? environment.IsDevelopment(),
            section.GetValue<bool?>("DryRun") ?? false);
    }
}

public static class StarterReportsSeedExtensions
{
    /// <summary>
    /// Runs the starter reports seed when <c>Seed:StarterReports:Enabled</c> is true (default: Development only), honouring <c>DryRun</c>. Call after schema
    /// migrations and the other seeds. A failing starter is logged and reported; it never stops the host. The seed needs no acting user: it writes the
    /// Reports tables with the application connection and audits as "system".
    /// </summary>
    public static async Task<StarterReportSeedReport?> SeedStarterReportsAsync(this IServiceProvider services, CancellationToken cancellationToken = default)
    {
        var options = StarterReportsOptions.From(services.GetRequiredService<IConfiguration>(), services.GetRequiredService<IHostEnvironment>());
        if (!options.Enabled)
            return null;

        await using var scope = services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<ReportStarterSeeder>().SeedAsync(options.DryRun, cancellationToken);
    }
}
