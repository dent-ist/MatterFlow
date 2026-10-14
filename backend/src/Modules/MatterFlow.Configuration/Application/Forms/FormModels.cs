using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using MatterFlow.Configuration.Contracts.Forms;

namespace MatterFlow.Configuration.Application.Forms;

/// <summary>An option of a SELECT, RADIO or MULTISELECT field.</summary>
public sealed record FormOptionModel
{
    /// <summary>Stable option key (<c>^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$</c>).</summary>
    [Required]
    public required string Key { get; init; }

    /// <summary>Display text.</summary>
    [Required]
    public required string Label { get; init; }

    /// <summary>Rule object (contracts/form-rules.md); absent means always available.</summary>
    public JsonElement? AvailableWhen { get; init; }
}

/// <summary>A field of a form version as exchanged with the designer and renderer. List order is display order.</summary>
public sealed record FormFieldModel
{
    /// <summary>Stable field key (<c>^[a-z][a-z0-9_]{0,63}$</c>).</summary>
    [Required]
    public required string Key { get; init; }

    /// <summary>Display label (1..200).</summary>
    [Required]
    public required string Label { get; init; }

    /// <summary>Control wire name: TEXT, TEXTAREA, NUMBER, CHECKBOX, SELECT, RADIO, MULTISELECT, DATE, DATETIME, URL, ASSET_REF, USER_REF, SECTION_HEADING or HELP_TEXT.</summary>
    [Required]
    public required string Control { get; init; }

    /// <summary>Help text (max 1000).</summary>
    public string? HelpText { get; init; }

    /// <summary>Key of the SECTION_HEADING this field sits under.</summary>
    public string? Section { get; init; }

    /// <summary>Static required flag.</summary>
    public bool Required { get; init; }

    /// <summary>Default value (JSON matching the control).</summary>
    public JsonElement? DefaultValue { get; init; }

    /// <summary>Validation object: <c>min</c>, <c>max</c>, <c>maxLength</c>, <c>pattern</c>, <c>patternMessage</c>.</summary>
    public JsonElement? Validation { get; init; }

    /// <summary>Show rule.</summary>
    public JsonElement? ShowWhen { get; init; }

    /// <summary>Conditional-required rule.</summary>
    public JsonElement? RequiredWhen { get; init; }

    /// <summary>Mirror the value into the typed filter index (max 5 per version).</summary>
    public bool IsFilterable { get; init; }

    /// <summary>Options in display order (option-bearing controls).</summary>
    public IReadOnlyList<FormOptionModel>? Options { get; init; }
}

/// <summary>Facts about one form version.</summary>
/// <param name="FormVersionId">Version id.</param>
/// <param name="FormDefinitionId">Definition id.</param>
/// <param name="VersionNo">Number within the definition (1, 2, ...).</param>
/// <param name="Status">Draft, Published or Retired.</param>
/// <param name="ClonedFromVersionId">The version a draft was started from.</param>
/// <param name="CreatedAtUtc">When the version was created.</param>
/// <param name="PublishedAtUtc">When it was published.</param>
/// <param name="PublishedByUserId">Who published it.</param>
/// <param name="Notes">Free-text change notes.</param>
/// <param name="FieldCount">Number of fields.</param>
/// <param name="RowVersion">Concurrency token (base64) to send back when editing a draft.</param>
public sealed record FormVersionSummary(
    [property: Required] int FormVersionId,
    [property: Required] int FormDefinitionId,
    [property: Required] int VersionNo,
    [property: Required] FormVersionStatus Status,
    int? ClonedFromVersionId,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? PublishedAtUtc,
    int? PublishedByUserId,
    string? Notes,
    [property: Required] int FieldCount,
    [property: Required] string RowVersion);

/// <summary>A form version with its fields (the "schema" a renderer needs).</summary>
/// <param name="Version">Version facts.</param>
/// <param name="OwnerKind">Owner kind of the definition.</param>
/// <param name="OwnerId">Owner id (null for the Client, Matter and Project singletons).</param>
/// <param name="Fields">Fields in display order.</param>
public sealed record FormVersionDetail(
    [property: Required] FormVersionSummary Version,
    [property: Required] FormOwnerKind OwnerKind,
    int? OwnerId,
    [property: Required] IReadOnlyList<FormFieldModel> Fields);

/// <summary>A form definition with its versions.</summary>
/// <param name="FormDefinitionId">Definition id.</param>
/// <param name="OwnerKind">Owner kind.</param>
/// <param name="OwnerId">Owner id (null for singletons).</param>
/// <param name="IsActive">Whether the definition is active.</param>
/// <param name="PublishedVersionId">The current PUBLISHED version, if any.</param>
/// <param name="DraftVersionId">The open DRAFT, if any.</param>
/// <param name="Versions">All versions, newest first.</param>
public sealed record FormDefinitionModel(
    [property: Required] int FormDefinitionId,
    [property: Required] FormOwnerKind OwnerKind,
    int? OwnerId,
    [property: Required] bool IsActive,
    int? PublishedVersionId,
    int? DraftVersionId,
    [property: Required] IReadOnlyList<FormVersionSummary> Versions);

/// <summary>Request to find or create the form definition of an owner.</summary>
public sealed record EnsureFormDefinitionRequest
{
    /// <summary>Owner kind.</summary>
    [Required]
    public required FormOwnerKind OwnerKind { get; init; }

    /// <summary>Owner id; omit for Client, Matter and Project.</summary>
    public int? OwnerId { get; init; }
}

/// <summary>Request to replace the content of a draft.</summary>
public sealed record SaveFormDraftRequest
{
    /// <summary>The complete field list in display order.</summary>
    [Required]
    public required IReadOnlyList<FormFieldModel> Fields { get; init; }

    /// <summary>Change notes (max 500).</summary>
    public string? Notes { get; init; }

    /// <summary>The draft's <c>rowVersion</c> as last read (required, SEC-09); a mismatch is 409 CONCURRENCY_CONFLICT.</summary>
    [Required]
    public required string RowVersion { get; init; }
}

/// <summary>Request to start a new draft.</summary>
/// <param name="FromVersionId">The version to copy; default is the published version, else the latest, else an empty draft.</param>
/// <param name="Notes">Change notes.</param>
public sealed record CreateFormDraftRequest(int? FromVersionId = null, string? Notes = null);

/// <summary>One field's difference between two versions.</summary>
/// <param name="FieldKey">Field key.</param>
/// <param name="Kind">Added, Removed or Changed.</param>
/// <param name="Details">Names of the attributes that differ for a changed field.</param>
public sealed record FormFieldChangeModel([property: Required] string FieldKey, [property: Required] string Kind, [property: Required] IReadOnlyList<string> Details);

/// <summary>Summary of the differences between two versions.</summary>
/// <param name="FromVersionId">Older version (or null when comparing with nothing).</param>
/// <param name="ToVersionId">Newer version.</param>
/// <param name="Added">Count of added fields.</param>
/// <param name="Removed">Count of removed fields.</param>
/// <param name="Changed">Count of changed fields.</param>
/// <param name="Changes">The differences.</param>
public sealed record FormDiffModel(
    int? FromVersionId,
    [property: Required] int ToVersionId,
    [property: Required] int Added,
    [property: Required] int Removed,
    [property: Required] int Changed,
    [property: Required] IReadOnlyList<FormFieldChangeModel> Changes);

/// <summary>Request to validate values against a version without storing them.</summary>
public sealed record ValidateFormValuesRequest
{
    /// <summary>Submitted values keyed by field key.</summary>
    [Required]
    public required Dictionary<string, JsonElement> Values { get; init; }

    /// <summary>Submit (default) or Draft.</summary>
    public FormSubmissionMode Mode { get; init; } = FormSubmissionMode.Submit;

    /// <summary>Stored values the submission patches.</summary>
    public Dictionary<string, JsonElement>? ExistingValues { get; init; }

    /// <summary>Report only errors of fields whose value differs from <see cref="ExistingValues"/> (FND-07).</summary>
    public bool ValidateOnlyChanged { get; init; }
}

/// <summary>One field error of a validation result.</summary>
/// <param name="FieldKey">Field key.</param>
/// <param name="Code">Error code.</param>
/// <param name="Message">English detail.</param>
public sealed record FormValueErrorModel([property: Required] string FieldKey, [property: Required] string Code, [property: Required] string Message);

/// <summary>Result of validating values against a version.</summary>
/// <param name="IsValid">True when there are no errors.</param>
/// <param name="Errors">Errors.</param>
/// <param name="NormalizedValues">Values that would be persisted.</param>
/// <param name="DroppedFields">Hidden keys that would be dropped.</param>
public sealed record ValidateFormValuesResponse(
    [property: Required] bool IsValid,
    [property: Required] IReadOnlyList<FormValueErrorModel> Errors,
    [property: Required] Dictionary<string, JsonElement> NormalizedValues,
    [property: Required] IReadOnlyList<string> DroppedFields);
