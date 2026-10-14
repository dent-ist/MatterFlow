using MatterFlow.SharedKernel.Entities;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace MatterFlow.Data;

/// <summary>Stamps CreatedAt/By and ModifiedAt/By on <see cref="IAuditStamped"/> entities during SaveChanges. (AuditEvent generation is a separate interceptor.)</summary>
public sealed class AuditColumnsInterceptor(IClock clock, ICurrentUser currentUser) : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Stamp(eventData.Context, clock.UtcNow, currentUser.UserId);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Stamp(eventData.Context, clock.UtcNow, currentUser.UserId);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    /// <summary>Applies the stamps to every added/modified entry of <paramref name="context"/>.</summary>
    public static void Stamp(DbContext? context, DateTime utcNow, int? userId)
    {
        if (context is null)
            return;

        foreach (var entry in context.ChangeTracker.Entries<IAuditStamped>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.CreatedAtUtc = utcNow;
                    entry.Entity.CreatedByUserId = userId;
                    break;
                case EntityState.Modified when HasRealChanges(entry):
                    entry.Entity.ModifiedAtUtc = utcNow;
                    entry.Entity.ModifiedByUserId = userId;
                    break;
            }
        }
    }

    private static bool HasRealChanges(EntityEntry entry) =>
        entry.Properties.Any(p => p.IsModified && p.Metadata.Name != nameof(IAuditStamped.RowVersion));
}
