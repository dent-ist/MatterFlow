using MatterFlow.SharedKernel.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace MatterFlow.Data;

/// <summary>
/// Mapping conventions shared by every entity (schema is hand-written SQL, ADR 003, so these must match the scripts):
/// primary key column <c>&lt;Entity&gt;Id</c>; audit columns <c>CreatedAt/CreatedByUserId/ModifiedAt/ModifiedByUserId</c>;
/// <c>RowVersion</c> mapped as a SQL Server <c>rowversion</c> concurrency token.
/// </summary>
public static class ModelConventions
{
    public const string RowVersionColumn = "RowVersion";

    /// <summary>Applies the conventions to every entity in the model that derives from <see cref="Entity{TKey}"/>. Call after module configurations.</summary>
    public static void Apply(ModelBuilder modelBuilder)
    {
        foreach (var entityType in modelBuilder.Model.GetEntityTypes().ToList())
        {
            var clr = entityType.ClrType;
            if (!IsEntity(clr))
                continue;

            var builder = modelBuilder.Entity(clr);
            builder.HasKey(nameof(Entity<int>.Id));
            builder.Property(nameof(Entity<int>.Id)).HasColumnName(clr.Name + "Id");

            if (typeof(IAuditStamped).IsAssignableFrom(clr))
            {
                builder.Property(nameof(IAuditStamped.CreatedAtUtc)).HasColumnName("CreatedAt").IsRequired();
                builder.Property(nameof(IAuditStamped.CreatedByUserId)).HasColumnName("CreatedByUserId");
                builder.Property(nameof(IAuditStamped.ModifiedAtUtc)).HasColumnName("ModifiedAt");
                builder.Property(nameof(IAuditStamped.ModifiedByUserId)).HasColumnName("ModifiedByUserId");
                builder.Property(nameof(IAuditStamped.RowVersion))
                    .HasColumnName(RowVersionColumn)
                    .IsRowVersion()
                    .IsRequired();
            }
        }
    }

    private static bool IsEntity(Type type)
    {
        for (var t = type; t is not null && t != typeof(object); t = t.BaseType)
        {
            if (t.IsGenericType && t.GetGenericTypeDefinition() == typeof(Entity<>))
                return true;
        }

        return false;
    }
}
