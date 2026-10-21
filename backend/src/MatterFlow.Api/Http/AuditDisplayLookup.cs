using System.Globalization;
using MatterFlow.Assets.Contracts;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.WorkManagement.Contracts;

namespace MatterFlow.Api.Http;

/// <summary>
/// Composes the audit browser's display lookups from the owning modules' Contracts (the Audit module itself must not depend on them).
/// Users, Tasks and Assets are looked up in one call each; Matters, Projects and Pods one by one (a page holds at most 200 events).
/// </summary>
internal sealed class AuditDisplayLookup(
    IUserDirectory users,
    ITaskDirectory tasks,
    IAssetDirectory assets,
    IMatterDirectory matters,
    IProjectDirectory projects,
    IPodDirectory pods,
    IConfigurationNameDirectory configuration) : IAuditDisplayLookup
{
    public async Task<IReadOnlyDictionary<int, string>> UserNamesAsync(IReadOnlyCollection<int> userIds, CancellationToken cancellationToken = default)
    {
        if (userIds.Count == 0)
            return new Dictionary<int, string>();

        var found = await users.FindManyAsync(userIds, cancellationToken);
        return found.ToDictionary(p => p.Key, p => p.Value.DisplayName);
    }

    public async Task<IReadOnlyDictionary<int, string>> PodNamesAsync(IReadOnlyCollection<int> podIds, CancellationToken cancellationToken = default)
    {
        var names = new Dictionary<int, string>();
        foreach (var id in podIds.Distinct())
        {
            if (await pods.FindAsync(id, cancellationToken) is { } pod)
                names[id] = pod.Name;
        }

        return names;
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

        await AddAdministrationLabelsAsync(objects, labels, cancellationToken);
        return labels;
    }

    /// <summary>
    /// The configuration records the Administration pages manage (#649): one statement per kind for the whole page of events. A record that
    /// no longer exists stays out; the audit browser then uses the name stored in the events.
    /// </summary>
    private async Task AddAdministrationLabelsAsync(
        IReadOnlyCollection<AuditObjectRef> objects,
        Dictionary<AuditObjectRef, string> labels,
        CancellationToken cancellationToken)
    {
        foreach (var (id, name) in await users.RoleNamesAsync(IdsOf(objects, "Role"), cancellationToken))
            labels[new("Role", Text(id))] = name;

        foreach (var (id, name) in await assets.AssetTypeNamesAsync(IdsOf(objects, "AssetType"), cancellationToken))
            labels[new("AssetType", Text(id))] = name;

        foreach (var (id, name) in await configuration.PriorityLabelsAsync(IdsOf(objects, "Priority"), cancellationToken))
            labels[new("Priority", Text(id))] = name;

        foreach (var (id, name) in await configuration.AssetLinkRoleNamesAsync(IdsOf(objects, "AssetLinkRole"), cancellationToken))
            labels[new("AssetLinkRole", Text(id))] = name;

        var codes = objects.Where(o => o.ObjectType == "StatusLabel").Select(o => o.ObjectId).Distinct().ToList();
        foreach (var (code, name) in await configuration.StatusLabelNamesAsync(codes, cancellationToken))
            labels[new("StatusLabel", code)] = name;

        var owners = await configuration.FormOwnersAsync(IdsOf(objects, "FormDefinition"), cancellationToken);
        var assetTypeIds = owners.Values.Where(o => o.Scope == FormOwnerKind.AssetType && o.OwnerId is not null).Select(o => o.OwnerId!.Value).Distinct().ToList();
        var assetTypeNames = await assets.AssetTypeNamesAsync(assetTypeIds, cancellationToken);
        foreach (var (definitionId, owner) in owners)
        {
            var label = FormLabel(owner, assetTypeNames);
            if (label is not null)
                labels[new("FormDefinition", Text(definitionId))] = label;
        }
    }

    private static string? FormLabel(FormOwnerInfo owner, IReadOnlyDictionary<int, string> assetTypeNames) => owner.Scope switch
    {
        FormOwnerKind.Client => "Client custom fields",
        FormOwnerKind.Matter => "Matter custom fields",
        FormOwnerKind.Project => "Project custom fields",
        FormOwnerKind.AssetType => owner.OwnerId is { } t && assetTypeNames.TryGetValue(t, out var name) ? $"{name} fields" : null,
        FormOwnerKind.TaskType => owner.OwnerName is { } n ? $"{n} request form" : null,
        _ => null,
    };

    private static List<int> IdsOf(IReadOnlyCollection<AuditObjectRef> objects, string type) =>
        objects
            .Where(o => o.ObjectType == type && int.TryParse(o.ObjectId, NumberStyles.None, CultureInfo.InvariantCulture, out _))
            .Select(o => int.Parse(o.ObjectId, NumberStyles.None, CultureInfo.InvariantCulture))
            .Distinct()
            .ToList();

    private static string Text(long id) => id.ToString(CultureInfo.InvariantCulture);
}
