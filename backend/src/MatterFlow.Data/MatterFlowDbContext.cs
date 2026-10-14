using MatterFlow.SharedKernel.ValueObjects;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Data;

/// <summary>
/// The single DbContext (ADR 001). Each module contributes <c>IEntityTypeConfiguration&lt;T&gt;</c> classes in its own
/// assembly, discovered automatically (see <see cref="ModuleAssemblies"/>); cross-module relationships live in
/// CrossModuleRelationships.cs. No EF migrations (ADR 003): the schema is the numbered SQL scripts.
/// </summary>
public class MatterFlowDbContext : DbContext
{
    public MatterFlowDbContext(DbContextOptions<MatterFlowDbContext> options)
        : base(options)
    {
    }

    /// <summary>For derived contexts (tests add throw-away entities this way) that bring their own typed options.</summary>
    protected MatterFlowDbContext(DbContextOptions options)
        : base(options)
    {
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<BusinessNumber>()
            .HaveConversion<BusinessNumberConverter>()
            .HaveColumnType("char(5)");
        configurationBuilder.Properties<DateTime>().HaveColumnType("datetime2");
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        foreach (var assembly in ModuleAssemblies.All)
            modelBuilder.ApplyConfigurationsFromAssembly(assembly);

        ModelConventions.Apply(modelBuilder);
    }
}
