using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Results;
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
        catch (DbUpdateException ex) when (ex.InnerException?.Message.Contains("duplicate key", StringComparison.OrdinalIgnoreCase) == true)
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
