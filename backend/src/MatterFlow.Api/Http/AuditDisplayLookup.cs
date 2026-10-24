using System.Globalization;
using MatterFlow.Assets.Contracts;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Contracts;
using MatterFlow.SharedKernel.Visibility;
using MatterFlow.WorkManagement.Contracts;
using Microsoft.EntityFrameworkCore;

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
    IConfigurationNameDirectory configuration,
    IMatterVisibility visibility) : IAuditDisplayLookup
{
    /// <summary>The label of a record the caller may not see (sensitive-matter rule, epic #788): no number, name or client.</summary>
    public const string RestrictedLabel = "Restricted record";

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
            var seeTasks = visibility.Enabled ? (await visibility.VisibleTasks().Where(t => taskIds.Contains(t.TaskId)).Select(t => t.TaskId).ToListAsync(cancellationToken)).ToHashSet() : null;
            foreach (var t in await tasks.FindManyAsync(taskIds, cancellationToken))
                labels[new("Task", Text(t.TaskId))] = seeTasks is null || seeTasks.Contains(t.TaskId) ? $"{t.TaskNumber} {t.Title}" : RestrictedLabel;
        }

        var assetIds = IdsOf(objects, "Asset");
        if (assetIds.Count > 0)
        {
            var found = await assets.FindManyAsync(assetIds, cancellationToken);
            var seeMatters = await VisibleMattersAsync(found.Select(a => a.MatterId), cancellationToken);
            foreach (var a in found)
                labels[new("Asset", Text(a.AssetId))] = seeMatters is null || seeMatters.Contains(a.MatterId) ? a.DisplayName : RestrictedLabel;
        }

        foreach (var (id, name) in await UserNamesAsync(IdsOf(objects, "User"), cancellationToken))
            labels[new("User", Text(id))] = name;

        var matterIds = IdsOf(objects, "Matter");
        var seen = await VisibleMattersAsync(matterIds, cancellationToken);
        foreach (var id in matterIds)
        {
            if (await matters.FindAsync(id, cancellationToken) is { } m)
                labels[new("Matter", Text(id))] = seen is null || seen.Contains(id) ? $"{m.MatterRef} {m.Name}" : RestrictedLabel;
        }

        foreach (var id in IdsOf(objects, "Project"))
        {
            if (await projects.FindAsync(id, cancellationToken) is { } p)
            {
                var seeProject = await VisibleMattersAsync([p.MatterId], cancellationToken);
                labels[new("Project", Text(id))] = seeProject is null || seeProject.Contains(p.MatterId) ? p.Name : RestrictedLabel;
            }
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

    /// <summary>Of these matters, the ones the caller may see (null while the rule is off: everything is visible).</summary>
    private async Task<HashSet<int>?> VisibleMattersAsync(IEnumerable<int> matterIds, CancellationToken cancellationToken)
    {
        if (!visibility.Enabled)
            return null;

        var ids = matterIds.Distinct().ToList();
        return (await visibility.VisibleMatters().Where(m => ids.Contains(m.MatterId)).Select(m => m.MatterId).ToListAsync(cancellationToken)).ToHashSet();
    }

    private static List<int> IdsOf(IReadOnlyCollection<AuditObjectRef> objects, string type) =>
        objects
            .Where(o => o.ObjectType == type && int.TryParse(o.ObjectId, NumberStyles.None, CultureInfo.InvariantCulture, out _))
            .Select(o => int.Parse(o.ObjectId, NumberStyles.None, CultureInfo.InvariantCulture))
            .Distinct()
            .ToList();

    private static string Text(long id) => id.ToString(CultureInfo.InvariantCulture);
}
