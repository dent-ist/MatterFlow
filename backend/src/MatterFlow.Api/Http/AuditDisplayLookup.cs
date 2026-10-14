using System.Globalization;
using MatterFlow.Assets.Contracts;
using MatterFlow.Audit.Contracts;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.WorkManagement.Contracts;

namespace MatterFlow.Api.Http;

/// <summary>
/// Composes the audit browser's display lookups from the owning modules' Contracts (the Audit module itself must not depend on them).
/// Users, Tasks and Assets are looked up in one call each; Matters and Projects one by one (a page holds at most 200 events).
/// </summary>
internal sealed class AuditDisplayLookup(
    IUserDirectory users,
    ITaskDirectory tasks,
    IAssetDirectory assets,
    IMatterDirectory matters,
    IProjectDirectory projects) : IAuditDisplayLookup
{
    public async Task<IReadOnlyDictionary<int, string>> UserNamesAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default)
    {
        if (userIds.Count == 0)
            return new Dictionary<int, string>();

        var found = await users.FindManyAsync(userIds, cancellationToken);
        return found.ToDictionary(p => p.Key, p => p.Value.DisplayName);
    }

    public async Task<IReadOnlyDictionary<AuditObjectRef, string>> ObjectLabelsAsync(
        IReadOnlyCollection<AuditObjectRef> objects,
        CancellationToken cancellationToken = default)
    {
        var labels = new Dictionary<AuditObjectRef, string>();

        var taskIds = IdsOf(objects, "Task").Select(id => (long)id).ToList();
        if (taskIds.Count > 0)
        {
            foreach (var t in await tasks.FindManyAsync(taskIds, cancellationToken))
                labels[new("Task", Text(t.TaskId))] = $"{t.TaskNumber} {t.Title}";
        }

        var assetIds = IdsOf(objects, "Asset");
        if (assetIds.Count > 0)
        {
            foreach (var a in await assets.FindManyAsync(assetIds, cancellationToken))
                labels[new("Asset", Text(a.AssetId))] = a.DisplayName;
        }

        foreach (var (id, name) in await UserNamesAsync(IdsOf(objects, "User"), cancellationToken))
            labels[new("User", Text(id))] = name;

        foreach (var id in IdsOf(objects, "Matter"))
        {
            if (await matters.FindAsync(id, cancellationToken) is { } m)
                labels[new("Matter", Text(id))] = $"{m.MatterRef} {m.Name}";
        }

        foreach (var id in IdsOf(objects, "Project"))
        {
            if (await projects.FindAsync(id, cancellationToken) is { } p)
                labels[new("Project", Text(id))] = p.Name;
        }

        return labels;
    }

    private static List<int> IdsOf(IReadOnlyCollection<AuditObjectRef> objects, string type) =>
        objects
            .Where(o => o.ObjectType == type && int.TryParse(o.ObjectId, NumberStyles.None, CultureInfo.InvariantCulture, out _))
            .Select(o => int.Parse(o.ObjectId, NumberStyles.None, CultureInfo.InvariantCulture))
            .Distinct()
            .ToList();

    private static string Text(long id) => id.ToString(CultureInfo.InvariantCulture);
}
