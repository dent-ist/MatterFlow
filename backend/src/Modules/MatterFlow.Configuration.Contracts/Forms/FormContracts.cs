using System.Text.Json;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Configuration.Contracts.Forms;

/// <summary>Options of <see cref="IFormSubmissionValidator.ValidateAsync"/>.</summary>
public sealed record FormSubmissionOptions
{
    /// <summary>Full validation (default) or draft (REQUIRED not reported).</summary>
    public FormSubmissionMode Mode { get; init; } = FormSubmissionMode.Submit;

    /// <summary>
    /// Previously stored values. When set, the submitted values are a patch over them (a JSON null clears a key).
    /// Stored keys that the form version does not know are preserved untouched.
    /// </summary>
    public IReadOnlyDictionary<string, JsonElement>? ExistingValues { get; init; }

    /// <summary>
    /// Report errors only for these fields (docs/qa/findings.md FND-07), so a newly required field does not block unrelated edits.
    /// Unknown submitted keys are always reported. Null reports everything. Use <see cref="ChangedFieldsOf"/> to derive the keys of a patch.
    /// </summary>
    public IReadOnlyCollection<string>? ValidateOnly { get; init; }

    /// <summary>The keys whose submitted value differs from the existing one (compared as JSON text).</summary>
    public static IReadOnlyCollection<string> ChangedFieldsOf(IReadOnlyDictionary<string, JsonElement> submitted, IReadOnlyDictionary<string, JsonElement>? existing) =>
        [.. submitted
            .Where(p => existing is null || !existing.TryGetValue(p.Key, out var old) || old.GetRawText() != p.Value.GetRawText())
            .Select(p => p.Key)];
}

/// <summary>One validation problem of a submitted field.</summary>
/// <param name="FieldKey">The field (or unknown submitted key) concerned.</param>
/// <param name="Code">Stable code: REQUIRED, INVALID_TYPE, OUT_OF_RANGE, TOO_LONG, PATTERN, OPTION_NOT_ALLOWED or UNKNOWN_FIELD.</param>
/// <param name="Message">English detail; not part of the contract.</param>
public sealed record FormSubmissionError(string FieldKey, string Code, string Message);

/// <summary>One typed filter-index row extracted from normalized values (a multi-select yields one per selected key).</summary>
/// <param name="FieldKey">Field key.</param>
/// <param name="ValueText">Text, URL, option key.</param>
/// <param name="ValueNumber">Number or reference id.</param>
/// <param name="ValueDate">Date.</param>
/// <param name="ValueDateTime">Date and time (UTC).</param>
/// <param name="ValueBool">Checkbox.</param>
public sealed record FormIndexValue(
    string FieldKey,
    string? ValueText = null,
    decimal? ValueNumber = null,
    DateOnly? ValueDate = null,
    DateTime? ValueDateTime = null,
    bool? ValueBool = null);

/// <summary>Outcome of validating submitted values against one form version.</summary>
/// <param name="FormVersionId">The version the values were validated against.</param>
/// <param name="FormDefinitionId">Its definition.</param>
/// <param name="Errors">Problems found (already limited to <see cref="FormSubmissionOptions.ValidateOnly"/> when set). Persist only when empty.</param>
/// <param name="NormalizedValues">Values to persist: visible, non-empty fields only (plus preserved unknown stored keys).</param>
/// <param name="DroppedFields">Keys of known fields that are currently hidden by the form's rules and were dropped (FND-12: warn and audit).</param>
/// <param name="IndexValues">Typed filter-index rows for the normalized values of filterable fields.</param>
public sealed record FormSubmissionResult(
    int FormVersionId,
    int FormDefinitionId,
    IReadOnlyList<FormSubmissionError> Errors,
    IReadOnlyDictionary<string, JsonElement> NormalizedValues,
    IReadOnlyList<string> DroppedFields,
    IReadOnlyList<FormIndexValue> IndexValues)
{
    /// <summary>True when there are no errors.</summary>
    public bool IsValid => Errors.Count == 0;

    /// <summary>The normalized values as the compact JSON object stored in a value column.</summary>
    public string NormalizedJson => JsonSerializer.Serialize(NormalizedValues);

    /// <summary>
    /// A <c>FORM_VALIDATION_FAILED</c> error with field errors keyed <c>form:&lt;fieldKey&gt;</c> (architecture section 11),
    /// or null when valid.
    /// </summary>
    public Error? ToError()
    {
        if (IsValid)
        {
            return null;
        }

        var fieldErrors = Errors
            .GroupBy(e => "form:" + e.FieldKey, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<FieldError>)[.. g.Select(e => new FieldError(e.Code, e.Message))]);
        return Error.Validation("The submitted form values are not valid.", fieldErrors, ErrorCodes.FormValidationFailed);
    }
}

/// <summary>
/// Validates and normalizes submitted values against a stored form version using the authoritative rule evaluator
/// (architecture 7.4). Called by every write path that stores form values (Tasks, Step Instances, Assets, core objects).
/// Reference existence checks (ASSET_REF, USER_REF) remain the caller's concern.
/// </summary>
public interface IFormSubmissionValidator
{
    /// <summary>
    /// Validates the values (a map keyed by field key) against the given version (draft, published or retired).
    /// Failure: NOT_FOUND for an unknown version. Validation problems are reported in the result, not as a failure.
    /// </summary>
    Task<Result<FormSubmissionResult>> ValidateAsync(
        int formVersionId,
        IReadOnlyDictionary<string, JsonElement> values,
        FormSubmissionOptions? options = null,
        CancellationToken cancellationToken = default);
}

/// <summary>Lightweight facts about a form version for other modules.</summary>
/// <param name="FormDefinitionId">Definition id.</param>
/// <param name="FormVersionId">Version id.</param>
/// <param name="VersionNo">Version number within the definition.</param>
/// <param name="Status">Lifecycle status.</param>
public sealed record FormVersionRef(int FormDefinitionId, int FormVersionId, int VersionNo, FormVersionStatus Status);

/// <summary>Finds and provisions form definitions for owners. Owner modules call it when they create a Task Type, Step Definition or Asset Type.</summary>
public interface IFormDefinitionResolver
{
    /// <summary>
    /// Returns the definition id of the owner's form, creating the (empty, unpublished) definition if it does not exist yet.
    /// Singleton owners (Client, Matter, Project) take <paramref name="ownerId"/> null; the others require it.
    /// </summary>
    Task<Result<int>> EnsureDefinitionAsync(FormOwnerKind ownerKind, int? ownerId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The owner's current PUBLISHED version. Failure: NOT_FOUND when the owner has no form definition,
    /// FORM_NOT_PUBLISHED when it has no published version.
    /// </summary>
    Task<Result<FormVersionRef>> GetPublishedVersionAsync(FormOwnerKind ownerKind, int? ownerId, CancellationToken cancellationToken = default);

    /// <summary>Facts about any version, or NOT_FOUND.</summary>
    Task<Result<FormVersionRef>> GetVersionAsync(int formVersionId, CancellationToken cancellationToken = default);
}

/// <summary>Stored values of one owner, with the version they were captured under.</summary>
/// <param name="FormDefinitionId">Definition id.</param>
/// <param name="FormVersionId">The version the values were saved under (stays on that version even after newer ones are published).</param>
/// <param name="Values">The stored values keyed by field key.</param>
/// <param name="RowVersion">Concurrency token (base64).</param>
public sealed record StoredFormValues(int FormDefinitionId, int FormVersionId, IReadOnlyDictionary<string, JsonElement> Values, string RowVersion);

/// <summary>Options of <see cref="IFormValueStore.SaveAsync"/>.</summary>
public sealed record FormSaveOptions
{
    /// <summary>Full or draft validation.</summary>
    public FormSubmissionMode Mode { get; init; } = FormSubmissionMode.Submit;

    /// <summary>When true and values already exist, only the keys that changed are validated (FND-07).</summary>
    public bool ValidateOnlyChanged { get; init; }

    /// <summary>When true the submitted values replace the stored ones instead of patching them.</summary>
    public bool Replace { get; init; }
}

/// <summary>Result of a successful <see cref="IFormValueStore.SaveAsync"/>.</summary>
/// <param name="Stored">What is stored now.</param>
/// <param name="DroppedFields">Hidden keys that were dropped by this save.</param>
public sealed record FormSaveOutcome(StoredFormValues Stored, IReadOnlyList<string> DroppedFields);

/// <summary>
/// Persists submitted form values together with the version they were captured under and keeps the typed filter index
/// (<c>CustomFieldIndex</c>) in sync inside the same transaction as the value write.
/// </summary>
public interface IFormValueStore
{
    /// <summary>
    /// Validates the values against <paramref name="formVersionId"/> (a patch over the stored values unless <see cref="FormSaveOptions.Replace"/>)
    /// and stores the normalized result. Failure: FORM_VALIDATION_FAILED with <c>form:&lt;fieldKey&gt;</c> errors, NOT_FOUND,
    /// FORM_NOT_PUBLISHED for a draft version, IMMUTABLE_FIELD when the owner's values are pinned to a different version.
    /// </summary>
    Task<Result<FormSaveOutcome>> SaveAsync(
        FormValueOwnerKind ownerKind,
        long ownerId,
        int formVersionId,
        IReadOnlyDictionary<string, JsonElement> values,
        FormSaveOptions? options = null,
        CancellationToken cancellationToken = default);

    /// <summary>The owner's stored values for the definition, or null when none were saved.</summary>
    Task<StoredFormValues?> GetAsync(FormValueOwnerKind ownerKind, long ownerId, int formDefinitionId, CancellationToken cancellationToken = default);
}
