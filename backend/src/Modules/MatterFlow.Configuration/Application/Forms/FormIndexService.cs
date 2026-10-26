using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.Configuration.Domain.Forms.Rules;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Forms;

/// <summary>The index reader, the published field catalog and the reindex job over the forms tables (contracts in <c>FormIndexContracts</c>).</summary>
internal sealed class FormIndexService(DbContext db, FormSchemaLoader loader) : IFormIndexReader, IFormFieldCatalog, IFormIndexMaintenance
{
    private const int Batch = 500;
    private const int MaxIndexText = 450;
    private const decimal MaxIndexNumber = 999_999_999_999_999m;

    public IQueryable<FormIndexRow> Rows(FormValueOwnerKind ownerKind) =>
        db.Set<CustomFieldIndex>().AsNoTracking()
            .Where(i => i.OwnerKind == ownerKind)
            .Select(i => new FormIndexRow
            {
                OwnerKind = i.OwnerKind,
                OwnerId = i.OwnerId,
                FormDefinitionId = i.FormDefinitionId,
                FieldKey = i.FieldKey,
                ValueText = i.ValueText,
                ValueNumber = i.ValueNumber,
            });

    public async Task<IReadOnlyList<FormFieldInfo>> GetPublishedFieldsAsync(FormOwnerKind ownerKind, int ownerId, CancellationToken cancellationToken = default) =>
        (await GetPublishedFieldsAsync(ownerKind, [ownerId], cancellationToken)).GetValueOrDefault(ownerId) ?? [];

    public async Task<IReadOnlyDictionary<int, IReadOnlyList<FormFieldInfo>>> GetPublishedFieldsAsync(
        FormOwnerKind ownerKind,
        IReadOnlyCollection<int> ownerIds,
        CancellationToken cancellationToken = default)
    {
        var result = new Dictionary<int, IReadOnlyList<FormFieldInfo>>();
        if (ownerIds.Count == 0)
            return result;

        var owned = db.Set<FormDefinition>().AsNoTracking();
        var ids = ownerIds.Select(i => (int?)i).ToList();
        var owners = ownerKind switch
        {
            FormOwnerKind.AssetType => owned.Where(d => ids.Contains(d.AssetTypeId)).Select(d => new { DefinitionId = d.Id, OwnerId = d.AssetTypeId }),
            FormOwnerKind.TaskType => owned.Where(d => ids.Contains(d.TaskTypeId)).Select(d => new { DefinitionId = d.Id, OwnerId = d.TaskTypeId }),
            FormOwnerKind.Step => owned.Where(d => ids.Contains(d.StepDefinitionId)).Select(d => new { DefinitionId = d.Id, OwnerId = d.StepDefinitionId }),
            _ => throw new ArgumentOutOfRangeException(nameof(ownerKind), ownerKind, "Singleton forms have no owner id."),
        };
        var versions = await db.Set<FormVersion>().AsNoTracking()
            .Where(v => v.Status == FormVersionStatus.Published)
            .Join(owners, v => v.FormDefinitionId, o => o.DefinitionId, (v, o) => new { VersionId = v.Id, OwnerId = o.OwnerId!.Value })
            .ToListAsync(cancellationToken);
        if (versions.Count == 0)
            return result;

        var versionIds = versions.Select(v => v.VersionId).ToList();
        var fields = await db.Set<FormField>().AsNoTracking()
            .Include(f => f.Options)
            .Where(f => versionIds.Contains(f.FormVersionId))
            .OrderBy(f => f.FormVersionId).ThenBy(f => f.SortOrder).ThenBy(f => f.Id)
            .ToListAsync(cancellationToken);
        foreach (var version in versions)
        {
            result[version.OwnerId] =
            [
                .. fields
                    .Where(f => f.FormVersionId == version.VersionId && f.ControlType.IsInput())
                    .Select(f => new FormFieldInfo(
                        f.FieldKey,
                        f.Label,
                        f.ControlType.ToWireName(),
                        f.IsFilterable,
                        [.. f.Options.OrderBy(o => o.SortOrder).ThenBy(o => o.Id).Select(o => new FormFieldOptionInfo(o.OptionKey, o.Label))])),
            ];
        }

        return result;
    }

    public Task<int> ReindexAsync(FormValueOwnerKind ownerKind, int formDefinitionId, CancellationToken cancellationToken = default) =>
        RunAsync(db.Set<FormValueSet>().Where(s => s.OwnerKind == ownerKind && s.FormDefinitionId == formDefinitionId), ownerKind, cancellationToken);

    public Task<int> ReindexMissingAsync(FormValueOwnerKind ownerKind, CancellationToken cancellationToken = default) =>
        RunAsync(
            db.Set<FormValueSet>().Where(s => s.OwnerKind == ownerKind
                && !db.Set<CustomFieldIndex>().Any(i => i.OwnerKind == s.OwnerKind && i.OwnerId == s.OwnerId && i.FormDefinitionId == s.FormDefinitionId)),
            ownerKind,
            cancellationToken);

    private async Task<int> RunAsync(IQueryable<FormValueSet> sets, FormValueOwnerKind ownerKind, CancellationToken ct)
    {
        if (ownerKind == FormValueOwnerKind.StepInstance)
            return 0; // step inputs are not indexed

        var processed = 0;
        long last = 0;
        while (true)
        {
            var page = await sets.AsNoTracking().Where(s => s.Id > last).OrderBy(s => s.Id).Take(Batch)
                .Select(s => new { s.Id, s.OwnerId, s.FormDefinitionId, s.FormVersionId, s.ValuesJson })
                .ToListAsync(ct);
            if (page.Count == 0)
                return processed;

            last = page[^1].Id;
            var rows = new List<CustomFieldIndex>();
            foreach (var set in page)
            {
                var loaded = await loader.LoadAsync(set.FormVersionId, ct);
                if (loaded.IsFailure)
                    continue;

                var schema = loaded.Value.Schema;
                var inputKeys = schema.Definitions.Where(d => d.Control.IsInput()).Select(d => d.Key).ToHashSet(StringComparer.Ordinal);
                var values = FormValuesJson.Read(set.ValuesJson).Where(p => inputKeys.Contains(p.Key));
                foreach (var e in FormIndexExtractor.Extract(schema, FormValues.From(values), alwaysIndexNumberAndSelect: ownerKind == FormValueOwnerKind.Asset))
                {
                    var row = new CustomFieldIndex
                    {
                        OwnerKind = ownerKind,
                        OwnerId = set.OwnerId,
                        FormDefinitionId = set.FormDefinitionId,
                        FieldKey = e.FieldKey,
                        ValueText = e.ValueText is { Length: > MaxIndexText } text ? text[..MaxIndexText] : e.ValueText,
                        ValueNumber = e.ValueNumber is { } n && Math.Abs(n) <= MaxIndexNumber ? decimal.Round(n, 4) : null,
                        ValueDate = e.ValueDate,
                        ValueDateTime = e.ValueDateTime,
                        ValueBool = e.ValueBool,
                    };
                    if (row.ValueText is not null || row.ValueNumber is not null || row.ValueDate is not null || row.ValueDateTime is not null || row.ValueBool is not null)
                        rows.Add(row);
                }
            }

            var owners = page.Select(s => s.OwnerId).ToList();
            var definitionIds = page.Select(s => s.FormDefinitionId).Distinct().ToList();
            await using var tx = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
            await db.Set<CustomFieldIndex>()
                .Where(i => i.OwnerKind == ownerKind && owners.Contains(i.OwnerId) && definitionIds.Contains(i.FormDefinitionId))
                .ExecuteDeleteAsync(ct);
            db.Set<CustomFieldIndex>().AddRange(rows);
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
            if (tx is not null)
                await tx.CommitAsync(ct);

            processed += page.Count;
        }
    }
}
