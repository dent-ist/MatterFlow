using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace MatterFlow.Configuration.Application.Lookups;

/// <summary>
/// Startup seeding for the configuration lookups, run after the schema scripts and idempotent (architecture 4.6): default priorities
/// and asset link roles are created on first install only (so admin edits are never overwritten), and the five fixed status
/// rows (seeded by the schema script) are verified.
/// </summary>
public sealed class ConfigurationSeeder(DbContext db, ILogger<ConfigurationSeeder> logger)
{
    private static readonly (string Label, string Color)[] DefaultPriorities =
    [
        ("Critical", PriorityColors.Critical),
        ("High", PriorityColors.High),
        ("Normal", PriorityColors.Normal),
        ("Low", PriorityColors.Low),
    ];

    private static readonly string[] DefaultLinkRoles = ["Source", "Destination", "Subject", "Result"];

    private const string DefaultPriorityLabel = "Normal";

    public async Task SeedAsync(CancellationToken ct = default)
    {
        await SeedPrioritiesAsync(ct);
        await SeedAssetLinkRolesAsync(ct);
        await VerifyStatusLabelsAsync(ct);
    }

    public async Task SeedPrioritiesAsync(CancellationToken ct)
    {
        if (await db.Set<Priority>().AnyAsync(ct))
        {
            // Self-heal the invariant if an admin database edit left no default: promote the most urgent active priority.
            if (!await db.Set<Priority>().AnyAsync(p => p.IsDefault, ct))
            {
                var candidate = await db.Set<Priority>().Where(p => p.IsActive).OrderBy(p => p.SortOrder).FirstOrDefaultAsync(ct);
                if (candidate is not null)
                {
                    candidate.IsDefault = true;
                    await db.SaveChangesAsync(ct);
                    logger.LogWarning("No default priority existed; promoted {Label}.", candidate.Label);
                }
            }

            return;
        }

        for (var i = 0; i < DefaultPriorities.Length; i++)
        {
            var (label, color) = DefaultPriorities[i];
            db.Set<Priority>().Add(new Priority
            {
                Label = label,
                Color = color,
                SortOrder = i + 1,
                IsActive = true,
                IsDefault = label == DefaultPriorityLabel,
            });
        }

        await db.SaveChangesAsync(ct);
        logger.LogInformation("Seeded {Count} default priorities.", DefaultPriorities.Length);
    }

    public async Task SeedAssetLinkRolesAsync(CancellationToken ct)
    {
        if (await db.Set<AssetLinkRole>().AnyAsync(ct))
            return;

        for (var i = 0; i < DefaultLinkRoles.Length; i++)
            db.Set<AssetLinkRole>().Add(new AssetLinkRole { Name = DefaultLinkRoles[i], SortOrder = i + 1, IsActive = true });

        await db.SaveChangesAsync(ct);
        logger.LogInformation("Seeded {Count} default asset link roles.", DefaultLinkRoles.Length);
    }

    /// <summary>The code set is fixed and inserted by the schema script; a trigger forbids inserting it here, so only report a gap.</summary>
    public async Task VerifyStatusLabelsAsync(CancellationToken ct)
    {
        var present = await db.Set<TaskStatusLabel>().Select(s => s.StatusCode).ToListAsync(ct);
        foreach (var missing in TaskStatusCodes.All.Except(present, StringComparer.Ordinal))
            logger.LogError("Status label row {Code} is missing; restore it from 07-configuration-basics.sql.", missing);
    }
}

public static class ConfigurationSeederExtensions
{
    /// <summary>Runs the Configuration startup seed in its own scope. Call after schema migrations.</summary>
    public static async Task SeedConfigurationAsync(this IServiceProvider services, CancellationToken ct = default)
    {
        await using var scope = services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<ConfigurationSeeder>().SeedAsync(ct);
    }
}
