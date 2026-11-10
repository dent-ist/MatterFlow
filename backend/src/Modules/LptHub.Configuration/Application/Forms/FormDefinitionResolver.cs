using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Forms;

/// <summary>The permission that manages the forms of each owner kind (catalog codes, <c>contracts/permissions.json</c>).</summary>
public static class FormPermissions
{
    /// <summary>The management permission for <paramref name="kind"/>.</summary>
    public static string ManageFor(FormOwnerKind kind) => kind switch
    {
        FormOwnerKind.TaskType => Permissions.TaskType.Manage,
        FormOwnerKind.Step => Permissions.Workflow.Manage,
        FormOwnerKind.AssetType => Permissions.AssetType.Manage,
        _ => Permissions.CustomField.Manage,
    };
}

/// <summary>Finds and provisions form definitions (<see cref="IFormDefinitionResolver"/>).</summary>
public sealed class FormDefinitionResolver(DbContext db, IAuditWriter audit) : IFormDefinitionResolver
{
    public static bool IsSingleton(FormOwnerKind kind) => kind is FormOwnerKind.Client or FormOwnerKind.Matter or FormOwnerKind.Project;

    public static Error? CheckOwner(FormOwnerKind kind, int? ownerId)
    {
        if (IsSingleton(kind))
        {
            return ownerId is null ? null : Error.Validation("ownerId", "NOT_ALLOWED", $"A {kind} form has no owner id.");
        }

        return ownerId is > 0 ? null : Error.Validation("ownerId", "REQUIRED", $"A {kind} form needs the owner id.");
    }

    public async Task<Result<int>> EnsureDefinitionAsync(FormOwnerKind ownerKind, int? ownerId, CancellationToken cancellationToken = default)
    {
        if (CheckOwner(ownerKind, ownerId) is { } invalid)
        {
            return Result<int>.Failure(invalid);
        }

        var existing = await FindIdAsync(ownerKind, ownerId, cancellationToken);
        if (existing is not null)
        {
            return existing.Value;
        }

        var definition = new FormDefinition();
        definition.SetOwner(ownerKind, ownerId);
        db.Set<FormDefinition>().Add(definition);
        audit.Write(new AuditEntry
        {
            EventType = "FORM_DEFINITION_CREATED",
            ObjectType = nameof(FormDefinition),
            ObjectIdFactory = () => definition.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Summary = ownerId is null ? ownerKind.ToString() : $"{ownerKind} {ownerId}",
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return definition.Id;
        }
        catch (DbUpdateException ex) when (ex.GetBaseException() is SqlException { Number: 2601 or 2627 })
        {
            // Lost a race with another creator of the same definition: it exists now.
            db.Entry(definition).State = EntityState.Detached;
            var created = await FindIdAsync(ownerKind, ownerId, cancellationToken);
            return created is { } id ? id : Error.Conflict(ErrorCodes.ConcurrencyConflict, "The form definition could not be created.");
        }
    }

    public async Task<Result<FormVersionRef>> GetPublishedVersionAsync(FormOwnerKind ownerKind, int? ownerId, CancellationToken cancellationToken = default)
    {
        if (CheckOwner(ownerKind, ownerId) is { } invalid)
        {
            return Result<FormVersionRef>.Failure(invalid);
        }

        var definitionId = await FindIdAsync(ownerKind, ownerId, cancellationToken);
        if (definitionId is null)
        {
            return Error.NotFound($"The {ownerKind} has no form.");
        }

        var published = await db.Set<FormVersion>().AsNoTracking()
            .Where(v => v.FormDefinitionId == definitionId && v.Status == FormVersionStatus.Published)
            .Select(v => new FormVersionRef(v.FormDefinitionId, v.Id, v.VersionNo, v.Status))
            .SingleOrDefaultAsync(cancellationToken);
        return published is null
            ? Error.Conflict(ErrorCodes.FormNotPublished, $"The {ownerKind} form has no published version.")
            : published;
    }

    public async Task<Result<FormVersionRef>> GetVersionAsync(int formVersionId, CancellationToken cancellationToken = default)
    {
        var version = await db.Set<FormVersion>().AsNoTracking()
            .Where(v => v.Id == formVersionId)
            .Select(v => new FormVersionRef(v.FormDefinitionId, v.Id, v.VersionNo, v.Status))
            .SingleOrDefaultAsync(cancellationToken);
        return version is null ? Error.NotFound($"Form version {formVersionId} does not exist.") : version;
    }

    public async Task<FormOwnerState> GetOwnerStateAsync(FormOwnerKind ownerKind, int? ownerId, CancellationToken cancellationToken = default)
    {
        var definitionId = CheckOwner(ownerKind, ownerId) is null ? await FindIdAsync(ownerKind, ownerId, cancellationToken) : null;
        if (definitionId is null)
        {
            return new FormOwnerState(null, null, null, 0);
        }

        var versions = await db.Set<FormVersion>().AsNoTracking()
            .Where(v => v.FormDefinitionId == definitionId && v.Status != FormVersionStatus.Retired)
            .Select(v => new { v.Id, v.VersionNo, v.Status, FieldCount = v.Fields.Count })
            .ToListAsync(cancellationToken);
        var published = versions.FirstOrDefault(v => v.Status == FormVersionStatus.Published);
        var draft = versions.FirstOrDefault(v => v.Status == FormVersionStatus.Draft);
        return new FormOwnerState(
            definitionId,
            published is null ? null : new FormVersionRef(definitionId.Value, published.Id, published.VersionNo, published.Status),
            draft?.Id,
            draft?.FieldCount ?? 0);
    }

    public async Task<IReadOnlyDictionary<int, FormOwnerState>> GetOwnerStatesAsync(FormOwnerKind ownerKind, IReadOnlyCollection<int>? ownerIds, CancellationToken cancellationToken = default)
    {
        if (IsSingleton(ownerKind))
            throw new ArgumentException($"A {ownerKind} form has no owner id.", nameof(ownerKind));
        if (ownerIds is { Count: 0 })
            return new Dictionary<int, FormOwnerState>();

        var definitions = db.Set<FormDefinition>().AsNoTracking().Where(d => d.Scope == ownerKind);
        if (ownerIds is not null)
        {
            var wanted = ownerIds.Distinct().ToList();
            definitions = ownerKind switch
            {
                FormOwnerKind.TaskType => definitions.Where(d => d.TaskTypeId != null && wanted.Contains(d.TaskTypeId.Value)),
                FormOwnerKind.Step => definitions.Where(d => d.StepDefinitionId != null && wanted.Contains(d.StepDefinitionId.Value)),
                _ => definitions.Where(d => d.AssetTypeId != null && wanted.Contains(d.AssetTypeId.Value)),
            };
        }

        var rows = await definitions.Select(d => new
        {
            d.TaskTypeId,
            d.StepDefinitionId,
            d.AssetTypeId,
            DefinitionId = d.Id,
            Published = d.Versions.Where(v => v.Status == FormVersionStatus.Published).Select(v => new { v.Id, v.VersionNo }).FirstOrDefault(),
            Draft = d.Versions.Where(v => v.Status == FormVersionStatus.Draft).Select(v => new { v.Id, FieldCount = v.Fields.Count }).FirstOrDefault(),
        }).ToListAsync(cancellationToken);

        var result = new Dictionary<int, FormOwnerState>();
        foreach (var r in rows)
        {
            var owner = ownerKind switch
            {
                FormOwnerKind.TaskType => r.TaskTypeId,
                FormOwnerKind.Step => r.StepDefinitionId,
                _ => r.AssetTypeId,
            };
            if (owner is { } id)
            {
                result[id] = new FormOwnerState(
                    r.DefinitionId,
                    r.Published is null ? null : new FormVersionRef(r.DefinitionId, r.Published.Id, r.Published.VersionNo, FormVersionStatus.Published),
                    r.Draft?.Id,
                    r.Draft?.FieldCount ?? 0);
            }
        }

        return result;
    }

    public async Task<IReadOnlyList<FormOwnerSummary>> GetOwnerSummariesAsync(FormOwnerKind ownerKind, IReadOnlyCollection<int>? ownerIds, CancellationToken cancellationToken = default)
    {
        if (IsSingleton(ownerKind))
        {
            if (ownerIds is not null)
                throw new ArgumentException($"A {ownerKind} form has no owner id.", nameof(ownerIds));
        }
        else if (ownerIds is { Count: 0 })
        {
            return [];
        }

        var definitions = db.Set<FormDefinition>().AsNoTracking().Where(d => d.Scope == ownerKind);
        if (ownerIds is not null)
        {
            var wanted = ownerIds.Distinct().ToList();
            definitions = ownerKind switch
            {
                FormOwnerKind.TaskType => definitions.Where(d => d.TaskTypeId != null && wanted.Contains(d.TaskTypeId.Value)),
                FormOwnerKind.Step => definitions.Where(d => d.StepDefinitionId != null && wanted.Contains(d.StepDefinitionId.Value)),
                _ => definitions.Where(d => d.AssetTypeId != null && wanted.Contains(d.AssetTypeId.Value)),
            };
        }

        // One statement for any number of owners: the published and the draft version of each definition, with their field counts.
        var rows = await definitions.Select(d => new
        {
            d.TaskTypeId,
            d.StepDefinitionId,
            d.AssetTypeId,
            DefinitionId = d.Id,
            Published = d.Versions.Where(v => v.Status == FormVersionStatus.Published).Select(v => new
            {
                v.Id,
                v.VersionNo,
                v.PublishedAt,
                v.PublishedByUserId,
                FieldCount = v.Fields.Count,
                RequiredCount = v.Fields.Count(f => f.IsRequired),
            }).FirstOrDefault(),
            Draft = d.Versions.Where(v => v.Status == FormVersionStatus.Draft).Select(v => new { v.VersionNo, FieldCount = v.Fields.Count }).FirstOrDefault(),
        }).ToListAsync(cancellationToken);

        return [.. rows.Select(r => new FormOwnerSummary(
            ownerKind,
            ownerKind switch
            {
                FormOwnerKind.TaskType => r.TaskTypeId,
                FormOwnerKind.Step => r.StepDefinitionId,
                FormOwnerKind.AssetType => r.AssetTypeId,
                _ => null,
            },
            r.DefinitionId,
            r.Published?.Id,
            r.Published?.VersionNo,
            r.Published?.FieldCount ?? 0,
            r.Published?.RequiredCount ?? 0,
            r.Published?.PublishedAt,
            r.Published?.PublishedByUserId,
            r.Draft?.VersionNo,
            r.Draft?.FieldCount ?? 0))];
    }

    public Task<int?> FindDefinitionIdAsync(FormOwnerKind ownerKind, int? ownerId, CancellationToken cancellationToken = default) =>
        FindIdAsync(ownerKind, ownerId, cancellationToken);

    /// <summary>The definition id of an owner, or null.</summary>
    public async Task<int?> FindIdAsync(FormOwnerKind kind, int? ownerId, CancellationToken cancellationToken) =>
        await db.Set<FormDefinition>().AsNoTracking()
            .Where(d => d.Scope == kind
                && (kind == FormOwnerKind.TaskType ? d.TaskTypeId == ownerId
                    : kind == FormOwnerKind.Step ? d.StepDefinitionId == ownerId
                    : kind == FormOwnerKind.AssetType ? d.AssetTypeId == ownerId
                    : true))
            .Select(d => (int?)d.Id)
            .SingleOrDefaultAsync(cancellationToken);
}
