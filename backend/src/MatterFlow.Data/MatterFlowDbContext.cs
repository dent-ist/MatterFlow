using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Data;

/// <summary>
/// The single DbContext (ADR 001). Module entity configurations and cross-module relationships
/// (CrossModuleRelationships.cs) are added here by the owning developers. No EF migrations (ADR 003).
/// </summary>
public class MatterFlowDbContext(DbContextOptions<MatterFlowDbContext> options) : DbContext(options)
{
}
