using System.ComponentModel.DataAnnotations;
using System.Reflection;
using MatterFlow.Identity;
using Shouldly;

namespace MatterFlow.ArchitectureTests;

/// <summary>
/// Optimistic concurrency contract (architecture 10, risk R-05, security review SEC-09): every request that changes an existing record
/// carries a mandatory <c>RowVersion</c>, so two administrators cannot silently overwrite each other.
/// </summary>
public class RowVersionRulesTests
{
    /// <summary>Update-style requests that deliberately have no row version (set semantics on a membership, idempotent toggles on a link table).</summary>
    private static readonly HashSet<string> NoRowVersionByDesign =
    [
        "SetPrimaryPodRequest", // sets a flag on a pod membership row; last write wins by design
        "ReorderRequest", // reorders a list; the order is the whole payload
    ];

    private static IEnumerable<Type> RequestTypes()
    {
        var assemblies = new List<Assembly> { typeof(Program).Assembly, typeof(IdentityModule).Assembly };
        foreach (var name in new[] { "Audit", "Configuration", "Organization", "Assets", "WorkflowEngine", "WorkManagement", "WorkViews", "Search", "Intake" })
            assemblies.Add(Assembly.Load($"MatterFlow.{name}"));

        return assemblies
            .SelectMany(a => a.GetTypes())
            .Where(t => t.IsPublic && t.Name.EndsWith("Request", StringComparison.Ordinal) && !t.Name.StartsWith("Create", StringComparison.Ordinal));
    }

    private static PropertyInfo? RowVersionOf(Type type) => type.GetProperty("RowVersion", BindingFlags.Public | BindingFlags.Instance);

    private static bool IsRequiredString(PropertyInfo property)
    {
        if (property.PropertyType != typeof(string))
            return false;

        // Positional records put [Required] on the parameter ("property:" target) or the property; classes put it on the property.
        var hasRequired = property.GetCustomAttribute<RequiredAttribute>() is not null
            || property.DeclaringType!.GetConstructors().SelectMany(c => c.GetParameters())
                .Any(p => string.Equals(p.Name, property.Name, StringComparison.OrdinalIgnoreCase) && p.GetCustomAttribute<RequiredAttribute>() is not null);
        var nullable = new NullabilityInfoContext().Create(property).WriteState == NullabilityState.Nullable;
        return hasRequired && !nullable;
    }

    [Fact]
    public void Request_types_are_found()
    {
        RequestTypes().Select(t => t.Name).ShouldContain("UpdateRoleRequest");
        RequestTypes().Select(t => t.Name).ShouldContain("SaveFormDraftRequest");
    }

    [Fact]
    public void Update_requests_carry_a_required_non_nullable_row_version()
    {
        var offenders = RequestTypes()
            .Where(t => t.Name.StartsWith("Update", StringComparison.Ordinal) || t.Name.StartsWith("Save", StringComparison.Ordinal)
                || t.Name.StartsWith("Set", StringComparison.Ordinal) || t.Name.EndsWith("ActionRequest", StringComparison.Ordinal)
                || t.Name.StartsWith("Change", StringComparison.Ordinal))
            .Where(t => !NoRowVersionByDesign.Contains(t.Name))
            .Where(t => RowVersionOf(t) is not { } property || !IsRequiredString(property))
            .Select(t => t.FullName)
            .Order()
            .ToList();

        offenders.ShouldBeEmpty("These update requests need a [Required] non-nullable RowVersion: " + string.Join(", ", offenders));
    }

    [Fact]
    public void A_row_version_that_exists_is_never_optional()
    {
        var offenders = RequestTypes()
            .Where(t => RowVersionOf(t) is { } property && !IsRequiredString(property))
            .Select(t => t.FullName)
            .Order()
            .ToList();

        offenders.ShouldBeEmpty("RowVersion must be [Required] and non-nullable on: " + string.Join(", ", offenders));
    }
}
