using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain;
using MatterFlow.Configuration.Domain.Forms;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application;

/// <summary>Implements <see cref="IConfigurationNameDirectory"/>: one statement per kind, whatever the number of ids.</summary>
internal sealed class ConfigurationNameDirectory(DbContext db) : IConfigurationNameDirectory
{
    public async Task<IReadOnlyDictionary<int, string>> PriorityLabelsAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
            return new Dictionary<int, string>();
        var wanted = ids.Distinct().ToList();
        return await db.Set<Priority>().AsNoTracking().Where(p => wanted.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Label, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<string, string>> StatusLabelNamesAsync(IReadOnlyCollection<string> codes, CancellationToken cancellationToken = default)
    {
        if (codes.Count == 0)
            return new Dictionary<string, string>();
        var wanted = codes.Distinct().ToList();
        return await db.Set<TaskStatusLabel>().AsNoTracking().Where(s => wanted.Contains(s.StatusCode)).ToDictionaryAsync(s => s.StatusCode, s => s.DisplayLabel, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<int, string>> AssetLinkRoleNamesAsync(IReadOnlyCollection<int> ids, CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
            return new Dictionary<int, string>();
        var wanted = ids.Distinct().ToList();
        return await db.Set<AssetLinkRole>().AsNoTracking().Where(r => wanted.Contains(r.Id)).ToDictionaryAsync(r => r.Id, r => r.Name, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<int, FormOwnerInfo>> FormOwnersAsync(IReadOnlyCollection<int> definitionIds, CancellationToken cancellationToken = default)
    {
        if (definitionIds.Count == 0)
            return new Dictionary<int, FormOwnerInfo>();
        var wanted = definitionIds.Distinct().ToList();
        var rows = await (
            from d in db.Set<FormDefinition>().AsNoTracking()
            where wanted.Contains(d.Id)
            join t in db.Set<TaskType>().AsNoTracking() on d.TaskTypeId equals t.Id into types
            from type in types.DefaultIfEmpty()
            select new { d.Id, d.Scope, d.TaskTypeId, d.StepDefinitionId, d.AssetTypeId, TypeName = type == null ? null : type.Name })
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(
            r => r.Id,
            r => new FormOwnerInfo(r.Scope, r.TaskTypeId ?? r.StepDefinitionId ?? r.AssetTypeId, r.TypeName));
    }
}
