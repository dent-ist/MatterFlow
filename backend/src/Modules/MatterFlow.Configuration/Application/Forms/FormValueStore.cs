using System.Text.Json;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Forms;

/// <summary>
/// Stores submitted values with the version they were captured under and rewrites the typed filter index in the same transaction
/// (<see cref="IFormValueStore"/>).
/// </summary>
internal sealed class FormValueStore(DbContext db, FormSchemaLoader loader, IAuditWriter audit, IEnumerable<IFormReferenceValidator> referenceValidators) : IFormValueStore
{
    private const int MaxIndexText = 450;
    private const decimal MaxIndexNumber = 999_999_999_999_999m;

    public async Task<Result<FormSaveOutcome>> SaveAsync(
        FormValueOwnerKind ownerKind,
        long ownerId,
        int formVersionId,
        IReadOnlyDictionary<string, JsonElement> values,
        FormSaveOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(values);
        options ??= new FormSaveOptions();

        var loaded = await loader.LoadAsync(formVersionId, cancellationToken);
        if (loaded.IsFailure)
        {
            return Result<FormSaveOutcome>.Failure(loaded.Error!);
        }

        var form = loaded.Value;
        var definitionId = form.Version.FormDefinitionId;
        var set = await db.Set<FormValueSet>()
            .SingleOrDefaultAsync(s => s.OwnerKind == ownerKind && s.OwnerId == ownerId && s.FormDefinitionId == definitionId, cancellationToken);

        var pinned = ownerKind is FormValueOwnerKind.Task or FormValueOwnerKind.StepInstance;
        if (form.Version.Status == FormVersionStatus.Draft || ((set is null || !pinned) && form.Version.Status != FormVersionStatus.Published))
        {
            return Error.Conflict(ErrorCodes.FormNotPublished, $"Form version {formVersionId} is not published.");
        }

        if (set is not null && pinned && set.FormVersionId != formVersionId)
        {
            return Error.Conflict(ErrorCodes.ImmutableField, $"The values are pinned to form version {set.FormVersionId} and cannot move to {formVersionId}.");
        }

        var existing = set is null || options.Replace ? null : FormValuesJson.Read(set.ValuesJson);
        var validateOnly = options.ValidateOnlyChanged && existing is not null
            ? FormSubmissionOptions.ChangedFieldsOf(values, existing)
            : null;
        var result = FormSubmissionValidator.Evaluate(form, values, new FormSubmissionOptions
        {
            Mode = options.Mode,
            ExistingValues = existing,
            ValidateOnly = validateOnly,
        });
        result = await FormReferenceChecks.ApplyAsync(referenceValidators, form, result, validateOnly, options.References, cancellationToken);
        if (result.ToError() is { } invalid)
        {
            return Result<FormSaveOutcome>.Failure(invalid);
        }

        var ownTransaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        try
        {
            if (set is null)
            {
                set = new FormValueSet { OwnerKind = ownerKind, OwnerId = ownerId, FormDefinitionId = definitionId };
                db.Set<FormValueSet>().Add(set);
            }

            set.FormVersionId = formVersionId;
            set.ValuesJson = result.NormalizedJson;

            if (result.DroppedFields.Count > 0)
            {
                var captured = set;
                audit.Write(new AuditEntry
                {
                    EventType = "FORM_VALUES_DROPPED",
                    ObjectType = nameof(FormValueSet),
                    ObjectIdFactory = () => captured.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    Summary = "Hidden values dropped: " + string.Join(", ", result.DroppedFields),
                });
            }

            await db.SaveChangesAsync(cancellationToken);
            await RewriteIndexAsync(ownerKind, ownerId, definitionId, result.IndexValues, cancellationToken);
            if (ownTransaction is not null)
            {
                await ownTransaction.CommitAsync(cancellationToken);
            }
        }
        catch (DbUpdateConcurrencyException)
        {
            return Error.Conflict(ErrorCodes.ConcurrencyConflict, "The form values were changed by someone else. Reload and try again.");
        }
        catch (DbUpdateException ex) when (IsDuplicateKey(ex))
        {
            return Error.Conflict(ErrorCodes.ConcurrencyConflict, "The form values were created by someone else. Reload and try again.");
        }
        finally
        {
            if (ownTransaction is not null)
            {
                await ownTransaction.DisposeAsync();
            }
        }

        return new FormSaveOutcome(ToStored(set), result.DroppedFields);
    }

    public async Task<StoredFormValues?> GetAsync(FormValueOwnerKind ownerKind, long ownerId, int formDefinitionId, CancellationToken cancellationToken = default)
    {
        var set = await db.Set<FormValueSet>().AsNoTracking()
            .SingleOrDefaultAsync(s => s.OwnerKind == ownerKind && s.OwnerId == ownerId && s.FormDefinitionId == formDefinitionId, cancellationToken);
        return set is null ? null : ToStored(set);
    }

    private static StoredFormValues ToStored(FormValueSet set) =>
        new(set.FormDefinitionId, set.FormVersionId, FormValuesJson.Read(set.ValuesJson), Convert.ToBase64String(set.RowVersion));

    private async Task RewriteIndexAsync(FormValueOwnerKind ownerKind, long ownerId, int definitionId, IReadOnlyList<FormIndexValue> values, CancellationToken cancellationToken)
    {
        if (ownerKind == FormValueOwnerKind.StepInstance)
        {
            return; // step inputs are not indexed (architecture 7.6)
        }

        await db.Set<CustomFieldIndex>()
            .Where(i => i.OwnerKind == ownerKind && i.OwnerId == ownerId && i.FormDefinitionId == definitionId)
            .ExecuteDeleteAsync(cancellationToken);

        foreach (var v in values)
        {
            var row = new CustomFieldIndex
            {
                OwnerKind = ownerKind,
                OwnerId = ownerId,
                FormDefinitionId = definitionId,
                FieldKey = v.FieldKey,
                ValueText = v.ValueText is { Length: > MaxIndexText } text ? text[..MaxIndexText] : v.ValueText,
                ValueNumber = v.ValueNumber is { } n && Math.Abs(n) <= MaxIndexNumber ? decimal.Round(n, 4) : null,
                ValueDate = v.ValueDate,
                ValueDateTime = v.ValueDateTime,
                ValueBool = v.ValueBool,
            };
            if (row.ValueText is not null || row.ValueNumber is not null || row.ValueDate is not null || row.ValueDateTime is not null || row.ValueBool is not null)
            {
                db.Set<CustomFieldIndex>().Add(row);
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private static bool IsDuplicateKey(DbUpdateException ex) =>
        ex.GetBaseException() is SqlException { Number: 2601 or 2627 }; // error numbers, not message text: the message is localized
}

/// <summary>Reads the stored JSON object of a value column.</summary>
internal static class FormValuesJson
{
    public static Dictionary<string, JsonElement> Read(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var values = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var p in doc.RootElement.EnumerateObject())
        {
            values[p.Name] = p.Value.Clone();
        }

        return values;
    }
}
