using System.Globalization;
using System.Text.Json;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Organization.Application;

/// <summary>Which singleton custom-field form and which value-set owner kind an Organization object uses.</summary>
public sealed record CustomFieldTarget(FormOwnerKind Form, FormValueOwnerKind Values, string ObjectType)
{
    public static readonly CustomFieldTarget Client = new(FormOwnerKind.Client, FormValueOwnerKind.Client, "Client");

    public static readonly CustomFieldTarget Matter = new(FormOwnerKind.Matter, FormValueOwnerKind.Matter, "Matter");

    public static readonly CustomFieldTarget Project = new(FormOwnerKind.Project, FormValueOwnerKind.Project, "Project");
}

/// <summary>The custom values of one record as returned on reads.</summary>
/// <param name="FormVersionId">The version the stored values were captured under, or null when none were saved.</param>
/// <param name="PublishedFormVersionId">The currently published form version (the schema to edit with), or null.</param>
/// <param name="Values">Stored values keyed by field key.</param>
public sealed record CustomFieldView(int? FormVersionId, int? PublishedFormVersionId, Dictionary<string, JsonElement> Values);

/// <summary>A validated, not yet stored set of custom values.</summary>
public sealed record CustomFieldPlan(FormVersionRef Version, FormSubmissionResult Validated, IReadOnlyDictionary<string, JsonElement> Submitted, IReadOnlyDictionary<string, JsonElement> Previous);

/// <summary>
/// Custom fields of Clients, Matters and Projects (ticket #59). The values live only in <c>FormValueSet</c> (+ the typed filter index) and are written
/// through <see cref="IFormValueStore"/> under the published version of the object's singleton form; <c>CustomFieldsJson</c> stays unused.
/// Updates are patches and only changed fields are validated (FND-07), so a field made required later does not block editing old records.
/// </summary>
public sealed class CustomFieldValues(
    IFormDefinitionResolver forms,
    IFormSubmissionValidator validator,
    IFormValueStore store,
    IAuditWriter audit)
{
    private static readonly IReadOnlyDictionary<string, JsonElement> NoValues = new Dictionary<string, JsonElement>();

    /// <summary>Reads the stored values and the version to edit with. Never writes.</summary>
    public async Task<CustomFieldView> ReadAsync(CustomFieldTarget target, int ownerId, CancellationToken ct)
    {
        var state = await forms.GetOwnerStateAsync(target.Form, null, ct);
        StoredFormValues? stored = state.FormDefinitionId is { } definitionId
            ? await store.GetAsync(target.Values, ownerId, definitionId, ct)
            : null;
        return new CustomFieldView(
            stored?.FormVersionId,
            state.Published?.FormVersionId,
            stored is null ? [] : new Dictionary<string, JsonElement>(stored.Values));
    }

    /// <summary>The currently published form version of the object, or null.</summary>
    public async Task<int?> PublishedVersionAsync(CustomFieldTarget target, CancellationToken ct) =>
        (await forms.GetOwnerStateAsync(target.Form, null, ct)).Published?.FormVersionId;

    /// <summary>Validates the values of a new record (full validation). Null when there is nothing to store and no published form.</summary>
    public Task<Result<CustomFieldPlan?>> PlanCreateAsync(CustomFieldTarget target, IReadOnlyDictionary<string, JsonElement>? values, CancellationToken ct) =>
        PlanAsync(target, values ?? NoValues, existing: null, ct);

    /// <summary>
    /// Validates a patch for an existing record. Null values leave the stored ones alone. Only the changed fields are validated; a record without
    /// stored values that is saved without any value is not validated at all (it simply stays without custom values).
    /// </summary>
    public async Task<Result<CustomFieldPlan?>> PlanUpdateAsync(CustomFieldTarget target, int ownerId, IReadOnlyDictionary<string, JsonElement>? patch, CancellationToken ct)
    {
        if (patch is null)
            return Result<CustomFieldPlan?>.Success(null);

        var state = await forms.GetOwnerStateAsync(target.Form, null, ct);
        StoredFormValues? stored = state.FormDefinitionId is { } definitionId
            ? await store.GetAsync(target.Values, ownerId, definitionId, ct)
            : null;
        if (stored is null && patch.Values.All(v => v.ValueKind == JsonValueKind.Null))
            return Result<CustomFieldPlan?>.Success(null);

        return await PlanAsync(target, patch, stored?.Values, ct);
    }

    /// <summary>Queues the history events and stores the values. Call inside the transaction that saved the record. Returns the dropped (hidden) keys.</summary>
    public async Task<Result<IReadOnlyList<string>>> SaveAsync(CustomFieldTarget target, int ownerId, int? matterId, CustomFieldPlan plan, CancellationToken ct)
    {
        QueueHistory(target, ownerId, matterId, plan);
        var saved = await store.SaveAsync(
            target.Values,
            ownerId,
            plan.Version.FormVersionId,
            plan.Submitted,
            new FormSaveOptions { Mode = FormSubmissionMode.Submit, ValidateOnlyChanged = true },
            ct);
        return saved.IsFailure
            ? Result<IReadOnlyList<string>>.Failure(saved.Error!)
            : Result<IReadOnlyList<string>>.Success(saved.Value.DroppedFields);
    }

    private async Task<Result<CustomFieldPlan?>> PlanAsync(
        CustomFieldTarget target,
        IReadOnlyDictionary<string, JsonElement> values,
        IReadOnlyDictionary<string, JsonElement>? existing,
        CancellationToken ct)
    {
        var published = await forms.GetPublishedVersionAsync(target.Form, null, ct);
        if (published.IsFailure)
        {
            var notPublished = published.Error!.Code is ErrorCodes.FormNotPublished or ErrorCodes.NotFound;
            if (notPublished && values.Values.All(v => v.ValueKind == JsonValueKind.Null))
                return Result<CustomFieldPlan?>.Success(null);

            return Result<CustomFieldPlan?>.Failure(
                notPublished
                    ? Error.Conflict(ErrorCodes.FormNotPublished, $"There is no published custom-field form for {target.ObjectType}s, so there are no custom fields to fill in.")
                    : published.Error!);
        }

        var checkedValues = await validator.ValidateAsync(
            published.Value.FormVersionId,
            values,
            new FormSubmissionOptions
            {
                Mode = FormSubmissionMode.Submit,
                ExistingValues = existing,
                ValidateOnly = existing is null ? null : FormSubmissionOptions.ChangedFieldsOf(values, existing),
                RequireAllWhenChanged = true,
            },
            ct);
        if (checkedValues.IsFailure)
            return Result<CustomFieldPlan?>.Failure(checkedValues.Error!);
        if (checkedValues.Value.ToError() is { } invalid)
            return Result<CustomFieldPlan?>.Failure(invalid);

        return Result<CustomFieldPlan?>.Success(new CustomFieldPlan(published.Value, checkedValues.Value, values, existing ?? NoValues));
    }

    private void QueueHistory(CustomFieldTarget target, int ownerId, int? matterId, CustomFieldPlan plan)
    {
        var previous = plan.Previous;
        var current = plan.Validated.NormalizedValues;
        var id = ownerId.ToString(CultureInfo.InvariantCulture);
        foreach (var key in previous.Keys.Concat(current.Keys.Where(k => !previous.ContainsKey(k))))
        {
            var hadOld = previous.TryGetValue(key, out var oldValue);
            var hasNew = current.TryGetValue(key, out var newValue);
            if (hadOld && hasNew && oldValue.GetRawText() == newValue.GetRawText())
                continue;

            audit.Write(new AuditEntry
            {
                EventType = AuditEventTypes.FieldChanged,
                ObjectType = target.ObjectType,
                ObjectId = id,
                MatterId = matterId,
                FieldKey = Clip("form:" + key),
                OldValue = hadOld ? Display(oldValue) : null,
                NewValue = hasNew ? Display(newValue) : null,
            });
        }

        if (plan.Validated.DroppedFields.Count > 0)
        {
            audit.Write(new AuditEntry
            {
                EventType = "FORM_VALUES_DROPPED",
                ObjectType = target.ObjectType,
                ObjectId = id,
                MatterId = matterId,
                Summary = "Hidden values dropped: " + string.Join(", ", plan.Validated.DroppedFields),
            });
        }
    }

    private static string Clip(string key) => key.Length <= 100 ? key : key[..100];

    private static string? Display(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Null => null,
        _ => e.GetRawText(),
    };
}
