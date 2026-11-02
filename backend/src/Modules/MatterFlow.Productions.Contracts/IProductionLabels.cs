namespace MatterFlow.Productions.Contracts;

/// <summary>A production or production spec as the audit display names it.</summary>
public sealed record ProductionLabel(int Id, int MatterId, string Name);

/// <summary>Names of productions and production specs for the audit browser and the Activities feed. The caller applies the sensitive-matter rule with <c>MatterId</c>.</summary>
public interface IProductionLabels
{
    Task<IReadOnlyList<ProductionLabel>> ProductionsAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProductionLabel>> SpecsAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default);
}
