using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.Configuration.Domain.Forms.Rules;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Forms;

/// <summary>
/// Form definition lifecycle: create a draft (new or cloned from the published version), edit it, publish (validated), retire, discard, diff.
/// A version that is not a draft is never edited; changing a published form means editing a new draft. Design-time operations require the
/// management permission of the form's owner kind (checked here because it depends on the definition, architecture 6.5).
/// </summary>
public sealed class FormAdminService(
    DbContext db,
    FormDefinitionResolver resolver,
    FormSchemaCache cache,
    IPermissionChecker permissions,
    ICurrentUser currentUser,
    IClock clock,
    IAuditWriter audit)
{
    // ---- definitions

    /// <summary>Finds or creates the definition of an owner (design permission of the owner kind).</summary>
    public async Task<Result<FormDefinitionModel>> EnsureDefinitionAsync(EnsureFormDefinitionRequest request, CancellationToken cancellationToken)
    {
        var denied = permissions.Require(FormPermissions.ManageFor(request.OwnerKind));
        if (denied.IsFailure)
        {
            return Result<FormDefinitionModel>.Failure(denied.Error!);
        }

        var id = await resolver.EnsureDefinitionAsync(request.OwnerKind, request.OwnerId, cancellationToken);
        return id.IsFailure ? Result<FormDefinitionModel>.Failure(id.Error!) : await GetDefinitionAsync(id.Value, cancellationToken);
    }

    /// <summary>The definition of an owner with its versions.</summary>
    public async Task<Result<FormDefinitionModel>> FindDefinitionAsync(FormOwnerKind kind, int? ownerId, CancellationToken cancellationToken)
    {
        var denied = permissions.Require(FormPermissions.ManageFor(kind));
        if (denied.IsFailure)
        {
            return Result<FormDefinitionModel>.Failure(denied.Error!);
        }

        if (FormDefinitionResolver.CheckOwner(kind, ownerId) is { } invalid)
        {
            return Result<FormDefinitionModel>.Failure(invalid);
        }

        var id = await resolver.FindIdAsync(kind, ownerId, cancellationToken);
        return id is null ? Error.NotFound($"The {kind} has no form.") : await GetDefinitionAsync(id.Value, cancellationToken);
    }

    /// <summary>A definition with its versions, newest first.</summary>
    public async Task<Result<FormDefinitionModel>> GetDefinitionAsync(int definitionId, CancellationToken cancellationToken)
    {
        var definition = await db.Set<FormDefinition>().AsNoTracking().SingleOrDefaultAsync(d => d.Id == definitionId, cancellationToken);
        if (definition is null)
        {
            return Error.NotFound($"Form definition {definitionId} does not exist.");
        }

        var denied = permissions.Require(FormPermissions.ManageFor(definition.Scope));
        if (denied.IsFailure)
        {
            return Result<FormDefinitionModel>.Failure(denied.Error!);
        }

        var versions = await db.Set<FormVersion>().AsNoTracking()
            .Where(v => v.FormDefinitionId == definitionId)
            .OrderByDescending(v => v.VersionNo)
            .Select(v => new { Version = v, FieldCount = v.Fields.Count })
            .ToListAsync(cancellationToken);
        var summaries = versions.Select(v => ToSummary(v.Version, v.FieldCount)).ToList();
        return new FormDefinitionModel(
            definition.Id,
            definition.Scope,
            definition.OwnerId,
            definition.IsActive,
            summaries.FirstOrDefault(v => v.Status == FormVersionStatus.Published)?.FormVersionId,
            summaries.FirstOrDefault(v => v.Status == FormVersionStatus.Draft)?.FormVersionId,
            summaries);
    }

    // ---- reading versions

    /// <summary>
    /// A version with its fields. Published and retired versions are readable by anyone allowed to reach the endpoint (renderers need them);
    /// a draft needs the design permission.
    /// </summary>
    public async Task<Result<FormVersionDetail>> GetVersionAsync(int versionId, CancellationToken cancellationToken)
    {
        var version = await db.Set<FormVersion>().AsNoTracking().Include(v => v.Definition).SingleOrDefaultAsync(v => v.Id == versionId, cancellationToken);
        return version is null ? Error.NotFound($"Form version {versionId} does not exist.") : await ReadDetailAsync(version, cancellationToken);
    }

    /// <summary>Facts about a version for callers that only need to know it is readable (a draft needs the design permission).</summary>
    public async Task<Result<FormVersionRef>> GetVersionHeadAsync(int versionId, CancellationToken cancellationToken)
    {
        var version = await db.Set<FormVersion>().AsNoTracking().Include(v => v.Definition).SingleOrDefaultAsync(v => v.Id == versionId, cancellationToken);
        if (version is null)
        {
            return Error.NotFound($"Form version {versionId} does not exist.");
        }

        if (version.Status == FormVersionStatus.Draft)
        {
            var denied = permissions.Require(FormPermissions.ManageFor(version.Definition.Scope));
            if (denied.IsFailure)
            {
                return Result<FormVersionRef>.Failure(denied.Error!);
            }
        }

        return new FormVersionRef(version.FormDefinitionId, version.Id, version.VersionNo, version.Status);
    }

    /// <summary>The definition's PUBLISHED version with its fields. FORM_NOT_PUBLISHED when there is none.</summary>
    public async Task<Result<FormVersionDetail>> GetPublishedAsync(int definitionId, CancellationToken cancellationToken)
    {
        var exists = await db.Set<FormDefinition>().AnyAsync(d => d.Id == definitionId, cancellationToken);
        if (!exists)
        {
            return Error.NotFound($"Form definition {definitionId} does not exist.");
        }

        var version = await db.Set<FormVersion>().AsNoTracking().Include(v => v.Definition)
            .SingleOrDefaultAsync(v => v.FormDefinitionId == definitionId && v.Status == FormVersionStatus.Published, cancellationToken);
        return version is null
            ? Error.Conflict(ErrorCodes.FormNotPublished, $"Form definition {definitionId} has no published version.")
            : await ReadDetailAsync(version, cancellationToken);
    }

    // ---- editing

    /// <summary>Starts the definition's draft, copying the published version (or the given/latest one).</summary>
    public async Task<Result<FormVersionDetail>> CreateDraftAsync(int definitionId, CreateFormDraftRequest request, CancellationToken cancellationToken)
    {
        var definition = await db.Set<FormDefinition>().SingleOrDefaultAsync(d => d.Id == definitionId, cancellationToken);
        if (definition is null)
        {
            return Error.NotFound($"Form definition {definitionId} does not exist.");
        }

        var denied = permissions.Require(FormPermissions.ManageFor(definition.Scope));
        if (denied.IsFailure)
        {
            return Result<FormVersionDetail>.Failure(denied.Error!);
        }

        if (request.Notes is { Length: > 500 })
        {
            return Error.Validation("notes", "TOO_LONG", "Notes are at most 500 characters.");
        }

        var versions = await db.Set<FormVersion>().AsNoTracking()
            .Where(v => v.FormDefinitionId == definitionId)
            .Select(v => new { v.Id, v.VersionNo, v.Status })
            .ToListAsync(cancellationToken);
        if (versions.FirstOrDefault(v => v.Status == FormVersionStatus.Draft) is { } open)
        {
            return DraftExists(open.Id);
        }

        int? sourceId;
        if (request.FromVersionId is { } requested)
        {
            if (versions.All(v => v.Id != requested))
            {
                return Error.Validation("fromVersionId", "NOT_FOUND", $"Version {requested} is not a version of this form.");
            }

            sourceId = requested;
        }
        else
        {
            sourceId = (versions.FirstOrDefault(v => v.Status == FormVersionStatus.Published) ?? versions.OrderByDescending(v => v.VersionNo).FirstOrDefault())?.Id;
        }

        var specs = sourceId is null ? [] : await ReadSpecsAsync(sourceId.Value, cancellationToken);
        var draft = new FormVersion
        {
            FormDefinitionId = definitionId,
            VersionNo = (versions.Count == 0 ? 0 : versions.Max(v => v.VersionNo)) + 1,
            Status = FormVersionStatus.Draft,
            ClonedFromVersionId = sourceId,
            Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes,
            Fields = FormSpecs.ToEntities(specs),
        };
        db.Set<FormVersion>().Add(draft);
        audit.Write(new AuditEntry
        {
            EventType = "FORM_DRAFT_CREATED",
            ObjectType = nameof(FormDefinition),
            ObjectId = Text(definitionId),
            Summary = $"v{draft.VersionNo}" + (sourceId is null ? string.Empty : $" from version {sourceId}"),
        });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsDuplicateKey(ex))
        {
            return Error.Conflict(ErrorCodes.FormDraftExists, "The form already has a draft.");
        }

        return await ReadDetailAsync(draft, definition, cancellationToken);
    }

    /// <summary>Replaces the content of a draft. Any other status is FORM_VERSION_IMMUTABLE.</summary>
    public async Task<Result<FormVersionDetail>> SaveDraftAsync(int definitionId, int versionId, SaveFormDraftRequest request, CancellationToken cancellationToken)
    {
        var loaded = await LoadVersionForDesignAsync(definitionId, versionId, cancellationToken);
        if (loaded.IsFailure)
        {
            return Result<FormVersionDetail>.Failure(loaded.Error!);
        }

        var (version, definition) = loaded.Value;
        if (version.Status != FormVersionStatus.Draft)
        {
            return Immutable(version);
        }

        if (request.Notes is { Length: > 500 })
        {
            return Error.Validation("notes", "TOO_LONG", "Notes are at most 500 characters.");
        }

        var specs = request.Fields.Select(ToSpec).ToList();
        var shape = FormDraftChecker.Check(specs);
        if (shape.Count > 0)
        {
            return Error.Validation("The form definition has errors.", ToFieldErrors(shape, byPath: true));
        }

        if (!TryApplyRowVersion(version, request.RowVersion))
        {
            return Error.Validation("rowVersion", "INVALID", "The row version is not valid.");
        }

        var ownTransaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        try
        {
            // Touch the version first: a stale row version is detected before anything is replaced.
            version.Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes;
            version.ModifiedAtUtc = clock.UtcNow;
            version.ModifiedByUserId = currentUser.UserId;
            audit.Write(new AuditEntry
            {
                EventType = "FORM_DRAFT_SAVED",
                ObjectType = nameof(FormDefinition),
                ObjectId = Text(definitionId),
                Summary = $"v{version.VersionNo}, {specs.Count} fields",
            });
            await db.SaveChangesAsync(cancellationToken);

            await db.Set<FormFieldOption>().Where(o => o.Field.FormVersionId == versionId).ExecuteDeleteAsync(cancellationToken);
            await db.Set<FormField>().Where(f => f.FormVersionId == versionId).ExecuteDeleteAsync(cancellationToken);
            var fields = FormSpecs.ToEntities(specs);
            foreach (var field in fields)
            {
                field.FormVersionId = versionId;
            }

            db.Set<FormField>().AddRange(fields);
            await db.SaveChangesAsync(cancellationToken);
            if (ownTransaction is not null)
            {
                await ownTransaction.CommitAsync(cancellationToken);
            }
        }
        catch (DbUpdateConcurrencyException)
        {
            return Error.Conflict(ErrorCodes.ConcurrencyConflict, "The draft was changed by someone else. Reload and try again.");
        }
        finally
        {
            if (ownTransaction is not null)
            {
                await ownTransaction.DisposeAsync();
            }
        }

        return await ReadDetailAsync(version, definition, cancellationToken);
    }

    /// <summary>Deletes a draft (a published version is never deleted).</summary>
    public async Task<Result> DiscardDraftAsync(int definitionId, int versionId, CancellationToken cancellationToken)
    {
        var loaded = await LoadVersionForDesignAsync(definitionId, versionId, cancellationToken);
        if (loaded.IsFailure)
        {
            return Result.Failure(loaded.Error!);
        }

        var (version, _) = loaded.Value;
        if (version.Status != FormVersionStatus.Draft)
        {
            return Immutable(version);
        }

        var ownTransaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        try
        {
            await db.Set<FormFieldOption>().Where(o => o.Field.FormVersionId == versionId).ExecuteDeleteAsync(cancellationToken);
            await db.Set<FormField>().Where(f => f.FormVersionId == versionId).ExecuteDeleteAsync(cancellationToken);
            await db.Set<FormVersion>().Where(v => v.Id == versionId && v.Status == FormVersionStatus.Draft).ExecuteDeleteAsync(cancellationToken);
            db.Entry(version).State = EntityState.Detached;
            audit.Write(new AuditEntry
            {
                EventType = "FORM_DRAFT_DISCARDED",
                ObjectType = nameof(FormDefinition),
                ObjectId = Text(definitionId),
                Summary = $"v{version.VersionNo}",
            });
            await db.SaveChangesAsync(cancellationToken);
            if (ownTransaction is not null)
            {
                await ownTransaction.CommitAsync(cancellationToken);
            }
        }
        finally
        {
            if (ownTransaction is not null)
            {
                await ownTransaction.DisposeAsync();
            }
        }

        return Result.Success();
    }

    // ---- publish / retire

    /// <summary>
    /// Validates the draft (rule contract plus architecture 7.5), makes it PUBLISHED and retires the previous published version, atomically.
    /// Invalid definitions are rejected with PUBLISH_VALIDATION_FAILED and one field error per problem (<c>form:&lt;fieldKey&gt;</c>, or <c>form</c>).
    /// </summary>
    public async Task<Result<FormVersionDetail>> PublishAsync(int definitionId, int versionId, string? rowVersion, CancellationToken cancellationToken)
    {
        var loaded = await LoadVersionForDesignAsync(definitionId, versionId, cancellationToken);
        if (loaded.IsFailure)
        {
            return Result<FormVersionDetail>.Failure(loaded.Error!);
        }

        var (version, definition) = loaded.Value;
        if (version.Status != FormVersionStatus.Draft)
        {
            return Immutable(version);
        }

        if (!TryApplyRowVersion(version, rowVersion))
        {
            return Error.Validation("rowVersion", "INVALID", "The row version is not valid.");
        }

        var specs = await ReadSpecsAsync(versionId, cancellationToken);
        var prior = await PriorControlsAsync(definitionId, cancellationToken);
        var outcome = FormPublishValidator.Validate(specs, prior);
        if (!outcome.IsValid)
        {
            return new Error(
                ErrorType.Validation,
                ErrorCodes.PublishValidationFailed,
                $"The form cannot be published: {outcome.Issues.Count} problem(s).",
                ToFieldErrors(outcome.Issues, byPath: false));
        }

        var ownTransaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        try
        {
            var now = clock.UtcNow;
            var current = await db.Set<FormVersion>().SingleOrDefaultAsync(v => v.FormDefinitionId == definitionId && v.Status == FormVersionStatus.Published, cancellationToken);
            if (current is not null)
            {
                // Retire first: only one PUBLISHED version may exist at any moment (filtered unique index).
                current.Status = FormVersionStatus.Retired;
                audit.Write(new AuditEntry { EventType = "FORM_RETIRED", ObjectType = nameof(FormDefinition), ObjectId = Text(definitionId), Summary = $"v{current.VersionNo} superseded" });
                await db.SaveChangesAsync(cancellationToken);
            }

            version.Status = FormVersionStatus.Published;
            version.PublishedAt = now;
            version.PublishedByUserId = currentUser.UserId;
            audit.Write(new AuditEntry { EventType = "FORM_PUBLISHED", ObjectType = nameof(FormDefinition), ObjectId = Text(definitionId), Summary = $"v{version.VersionNo}" });
            await db.SaveChangesAsync(cancellationToken);
            if (ownTransaction is not null)
            {
                await ownTransaction.CommitAsync(cancellationToken);
            }
        }
        catch (DbUpdateConcurrencyException)
        {
            return Error.Conflict(ErrorCodes.ConcurrencyConflict, "The form was changed by someone else. Reload and try again.");
        }
        catch (DbUpdateException ex) when (IsDuplicateKey(ex))
        {
            return Error.Conflict(ErrorCodes.ConcurrencyConflict, "Another version was published at the same time. Reload and try again.");
        }
        finally
        {
            if (ownTransaction is not null)
            {
                await ownTransaction.DisposeAsync();
            }
        }

        cache.Set(versionId, outcome.Schema!);
        return await ReadDetailAsync(version, definition, cancellationToken);
    }

    /// <summary>Retires the published version. New submissions then have no published version to pin until another is published.</summary>
    public async Task<Result<FormVersionDetail>> RetireAsync(int definitionId, int versionId, CancellationToken cancellationToken)
    {
        var loaded = await LoadVersionForDesignAsync(definitionId, versionId, cancellationToken);
        if (loaded.IsFailure)
        {
            return Result<FormVersionDetail>.Failure(loaded.Error!);
        }

        var (version, definition) = loaded.Value;
        if (version.Status != FormVersionStatus.Published)
        {
            return version.Status == FormVersionStatus.Retired
                ? Error.Conflict(ErrorCodes.FormVersionImmutable, $"Version {version.VersionNo} is already retired.")
                : Error.Conflict(ErrorCodes.FormNotPublished, $"Version {version.VersionNo} is a draft; only a published version can be retired.");
        }

        version.Status = FormVersionStatus.Retired;
        audit.Write(new AuditEntry { EventType = "FORM_RETIRED", ObjectType = nameof(FormDefinition), ObjectId = Text(definitionId), Summary = $"v{version.VersionNo}" });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Error.Conflict(ErrorCodes.ConcurrencyConflict, "The form was changed by someone else. Reload and try again.");
        }

        return await ReadDetailAsync(version, definition, cancellationToken);
    }

    // ---- diff

    /// <summary>Differences from <paramref name="againstVersionId"/> (default: the previous version, or nothing for the first) to <paramref name="versionId"/>.</summary>
    public async Task<Result<FormDiffModel>> DiffAsync(int definitionId, int versionId, int? againstVersionId, CancellationToken cancellationToken)
    {
        var loaded = await LoadVersionForDesignAsync(definitionId, versionId, cancellationToken, tracking: false);
        if (loaded.IsFailure)
        {
            return Result<FormDiffModel>.Failure(loaded.Error!);
        }

        var (version, _) = loaded.Value;
        int? olderId;
        if (againstVersionId is { } explicitId)
        {
            var belongs = await db.Set<FormVersion>().AnyAsync(v => v.Id == explicitId && v.FormDefinitionId == definitionId, cancellationToken);
            if (!belongs)
            {
                return Error.Validation("against", "NOT_FOUND", $"Version {explicitId} is not a version of this form.");
            }

            olderId = explicitId;
        }
        else
        {
            olderId = await db.Set<FormVersion>().AsNoTracking()
                .Where(v => v.FormDefinitionId == definitionId && v.VersionNo < version.VersionNo)
                .OrderByDescending(v => v.VersionNo)
                .Select(v => (int?)v.Id)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var older = olderId is null ? [] : await ReadSpecsAsync(olderId.Value, cancellationToken);
        var newer = await ReadSpecsAsync(versionId, cancellationToken);
        var changes = FormDiff.Compare(older, newer);
        return new FormDiffModel(
            olderId,
            versionId,
            changes.Count(c => c.Kind == FormFieldChangeKind.Added),
            changes.Count(c => c.Kind == FormFieldChangeKind.Removed),
            changes.Count(c => c.Kind == FormFieldChangeKind.Changed),
            [.. changes.Select(c => new FormFieldChangeModel(c.FieldKey, c.Kind.ToString(), c.Details))]);
    }

    // ---- helpers

    private async Task<Result<(FormVersion Version, FormDefinition Definition)>> LoadVersionForDesignAsync(int definitionId, int versionId, CancellationToken cancellationToken, bool tracking = true)
    {
        var query = db.Set<FormVersion>().Include(v => v.Definition).Where(v => v.Id == versionId && v.FormDefinitionId == definitionId);
        var version = await (tracking ? query : query.AsNoTracking()).SingleOrDefaultAsync(cancellationToken);
        if (version is null)
        {
            return Error.NotFound($"Form version {versionId} does not exist in form definition {definitionId}.");
        }

        var denied = permissions.Require(FormPermissions.ManageFor(version.Definition.Scope));
        return denied.IsFailure
            ? Result<(FormVersion, FormDefinition)>.Failure(denied.Error!)
            : (version, version.Definition);
    }

    private async Task<Result<FormVersionDetail>> ReadDetailAsync(FormVersion version, CancellationToken cancellationToken)
    {
        if (version.Status == FormVersionStatus.Draft)
        {
            var denied = permissions.Require(FormPermissions.ManageFor(version.Definition.Scope));
            if (denied.IsFailure)
            {
                return Result<FormVersionDetail>.Failure(denied.Error!);
            }
        }

        return await ReadDetailAsync(version, version.Definition, cancellationToken);
    }

    private async Task<FormVersionDetail> ReadDetailAsync(FormVersion version, FormDefinition definition, CancellationToken cancellationToken)
    {
        var specs = await ReadSpecsAsync(version.Id, cancellationToken);
        var count = specs.Count;
        return new FormVersionDetail(ToSummary(version, count), definition.Scope, definition.OwnerId, [.. specs.Select(ToModel)]);
    }

    private async Task<IReadOnlyList<FormFieldSpec>> ReadSpecsAsync(int versionId, CancellationToken cancellationToken)
    {
        var fields = await db.Set<FormField>().AsNoTracking().Include(f => f.Options).Where(f => f.FormVersionId == versionId).ToListAsync(cancellationToken);
        return FormSpecs.FromEntities(fields);
    }

    private async Task<Dictionary<string, FormControl>> PriorControlsAsync(int definitionId, CancellationToken cancellationToken)
    {
        var rows = await db.Set<FormField>().AsNoTracking()
            .Where(f => f.Version.FormDefinitionId == definitionId && f.Version.Status != FormVersionStatus.Draft)
            .OrderBy(f => f.Version.VersionNo)
            .Select(f => new { f.FieldKey, f.ControlType })
            .ToListAsync(cancellationToken);
        var prior = new Dictionary<string, FormControl>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            prior[row.FieldKey] = row.ControlType; // the latest earlier version wins
        }

        return prior;
    }

    private bool TryApplyRowVersion(FormVersion version, string? rowVersion)
    {
        if (string.IsNullOrEmpty(rowVersion))
        {
            return true;
        }

        try
        {
            db.Entry(version).Property(v => v.RowVersion).OriginalValue = Convert.FromBase64String(rowVersion);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static FormVersionSummary ToSummary(FormVersion v, int fieldCount) => new(
        v.Id,
        v.FormDefinitionId,
        v.VersionNo,
        v.Status,
        v.ClonedFromVersionId,
        v.CreatedAtUtc,
        v.PublishedAt,
        v.PublishedByUserId,
        v.Notes,
        fieldCount,
        Convert.ToBase64String(v.RowVersion));

    private static FormFieldSpec ToSpec(FormFieldModel m) => new()
    {
        Key = m.Key ?? string.Empty,
        Label = m.Label ?? string.Empty,
        Control = m.Control ?? string.Empty,
        HelpText = m.HelpText,
        Section = m.Section,
        Required = m.Required,
        Default = m.DefaultValue,
        Validation = m.Validation,
        ShowWhen = m.ShowWhen,
        RequiredWhen = m.RequiredWhen,
        IsFilterable = m.IsFilterable,
        Options = [.. (m.Options ?? []).Select(o => new FormOptionSpec(o.Key ?? string.Empty, o.Label ?? string.Empty, o.AvailableWhen))],
    };

    private static FormFieldModel ToModel(FormFieldSpec s) => new()
    {
        Key = s.Key,
        Label = s.Label,
        Control = s.Control,
        HelpText = s.HelpText,
        Section = s.Section,
        Required = s.Required,
        DefaultValue = s.Default,
        Validation = s.Validation,
        ShowWhen = s.ShowWhen,
        RequiredWhen = s.RequiredWhen,
        IsFilterable = s.IsFilterable,
        Options = [.. s.Options.Select(o => new FormOptionModel { Key = o.Key, Label = o.Label, AvailableWhen = o.AvailableWhen })],
    };

    /// <summary>Field errors keyed by request path (draft save) or <c>form:&lt;fieldKey&gt;</c> / <c>form</c> (publish).</summary>
    private static Dictionary<string, IReadOnlyList<FieldError>> ToFieldErrors(IEnumerable<FormDefinitionIssue> issues, bool byPath) =>
        issues
            .GroupBy(i => byPath && i.Path is not null ? i.Path : i.FieldKey is null ? "form" : "form:" + i.FieldKey, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<FieldError>)[.. g.Select(i => new FieldError(i.Code, i.Message))]);

    private static Error Immutable(FormVersion version) =>
        Error.Conflict(
            ErrorCodes.FormVersionImmutable,
            $"Version {version.VersionNo} is {version.Status.ToString().ToUpperInvariant()} and cannot be changed. Create a new draft instead.");

    private static Error DraftExists(int draftVersionId) =>
        Error.Conflict(ErrorCodes.FormDraftExists, "The form already has a draft; edit or discard it first.", new Dictionary<string, object?> { ["draftVersionId"] = draftVersionId });

    private static string Text(int id) => id.ToString(CultureInfo.InvariantCulture);

    private static bool IsDuplicateKey(DbUpdateException ex) =>
        ex.InnerException?.Message.Contains("duplicate key", StringComparison.OrdinalIgnoreCase) == true;
}
