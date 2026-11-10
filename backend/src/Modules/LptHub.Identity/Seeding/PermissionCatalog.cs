using System.Reflection;
using System.Text.Json;

namespace MatterFlow.Identity.Seeding;

/// <summary>One catalog entry of <c>contracts/permissions.json</c>.</summary>
public sealed record PermissionDefinition(string Code, string Group, string Description);

/// <summary>Reads the permission catalog (<c>contracts/permissions.json</c>), embedded into this assembly at build time.</summary>
public static class PermissionCatalog
{
    private const string ResourceName = "contracts.permissions.json";

    public static IReadOnlyList<PermissionDefinition> Load()
    {
        using var stream = typeof(PermissionCatalog).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource '{ResourceName}' not found.");
        return Parse(stream);
    }

    public static IReadOnlyList<PermissionDefinition> Parse(Stream json)
    {
        using var doc = JsonDocument.Parse(json);
        var list = new List<PermissionDefinition>();
        foreach (var item in doc.RootElement.GetProperty("permissions").EnumerateArray())
        {
            list.Add(new PermissionDefinition(
                item.GetProperty("code").GetString()!,
                item.GetProperty("group").GetString()!,
                item.GetProperty("description").GetString()!));
        }

        return list;
    }
}
