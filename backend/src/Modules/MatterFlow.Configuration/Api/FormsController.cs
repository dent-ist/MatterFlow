using MatterFlow.Configuration.Application.Forms;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Identity.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Configuration.Api;

/// <summary>
/// Form definitions, versions and the publish workflow (architecture 7). Every action needs <c>Task.View</c> to reach it (renderers read published
/// schemas with it); the design operations additionally require the management permission of the form's owner kind
/// (<c>TaskType.Manage</c>, <c>Workflow.Manage</c>, <c>AssetType.Manage</c> or <c>CustomField.Manage</c>), enforced in the service because it depends
/// on the definition (architecture 6.5).
/// </summary>
[ApiController]
[Route("api/v1/forms")]
[Authorize(Policy = FormsController.ReadPolicy)]
public class FormsController(FormAdminService forms, IFormSubmissionValidator validator) : ControllerBase
{
    /// <summary>Policy name of <c>Task.View</c> (the same string <c>[RequirePermission]</c> produces; modules cannot reference the Identity internals).</summary>
    internal const string ReadPolicy = "Perm:" + Permissions.Task.View;

    /// <summary>Finds or creates the form definition of an owner (idempotent). Owner modules normally do this when they create the owner.</summary>
    [HttpPost(Name = "EnsureFormDefinition")]
    [ProducesResponseType<FormDefinitionModel>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Ensure([FromBody] EnsureFormDefinitionRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.EnsureDefinitionAsync(request, cancellationToken));

    /// <summary>The form definition of an owner with its versions.</summary>
    /// <param name="ownerKind">TaskType, Step, AssetType, Client, Matter or Project.</param>
    /// <param name="ownerId">Owner id; omit for Client, Matter and Project.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("by-owner", Name = "FindFormDefinition")]
    [ProducesResponseType<FormDefinitionModel>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> FindByOwner([FromQuery] FormOwnerKind ownerKind, [FromQuery] int? ownerId, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.FindDefinitionAsync(ownerKind, ownerId, cancellationToken));

    /// <summary>A form definition with its versions, newest first.</summary>
    /// <param name="definitionId">Definition id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("{definitionId:int}", Name = "GetFormDefinition")]
    [ProducesResponseType<FormDefinitionModel>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int definitionId, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.GetDefinitionAsync(definitionId, cancellationToken));

    /// <summary>The versions of a definition, newest first.</summary>
    /// <param name="definitionId">Definition id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("{definitionId:int}/versions", Name = "ListFormVersions")]
    [ProducesResponseType<FormVersionSummary[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ListVersions(int definitionId, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.GetDefinitionAsync(definitionId, cancellationToken), d => Ok(d.Versions));

    /// <summary>The PUBLISHED version of a definition with its fields (409 FORM_NOT_PUBLISHED when there is none).</summary>
    /// <param name="definitionId">Definition id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("{definitionId:int}/published", Name = "GetPublishedFormVersion")]
    [ProducesResponseType<FormVersionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> GetPublished(int definitionId, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.GetPublishedAsync(definitionId, cancellationToken));

    /// <summary>A version with its fields (the schema a renderer needs). Drafts need the design permission.</summary>
    /// <param name="versionId">Version id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("versions/{versionId:int}/schema", Name = "GetFormVersionSchema")]
    [ProducesResponseType<FormVersionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> GetSchema(int versionId, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.GetVersionAsync(versionId, cancellationToken));

    /// <summary>Starts the draft of a definition from its published version (or the latest, or empty). 409 FORM_DRAFT_EXISTS when a draft is open.</summary>
    /// <param name="definitionId">Definition id.</param>
    /// <param name="request">Optional source version and notes.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("{definitionId:int}/versions", Name = "CreateFormDraft")]
    [ProducesResponseType<FormVersionDetail>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> CreateDraft(int definitionId, [FromBody] CreateFormDraftRequest? request, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await forms.CreateDraftAsync(definitionId, request ?? new CreateFormDraftRequest(), cancellationToken),
            d => Created($"/api/v1/forms/versions/{d.Version.FormVersionId}/schema", d));

    /// <summary>Starts a new draft as a copy of the given version.</summary>
    /// <param name="definitionId">Definition id.</param>
    /// <param name="versionId">Version to copy.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("{definitionId:int}/versions/{versionId:int}/clone", Name = "CloneFormVersion")]
    [ProducesResponseType<FormVersionDetail>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Clone(int definitionId, int versionId, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await forms.CreateDraftAsync(definitionId, new CreateFormDraftRequest(versionId), cancellationToken),
            d => Created($"/api/v1/forms/versions/{d.Version.FormVersionId}/schema", d));

    /// <summary>Replaces the content of a draft. 409 FORM_VERSION_IMMUTABLE for a published or retired version.</summary>
    /// <param name="definitionId">Definition id.</param>
    /// <param name="versionId">Draft version id.</param>
    /// <param name="request">Complete field list, notes and the row version read last.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPut("{definitionId:int}/versions/{versionId:int}", Name = "SaveFormDraft")]
    [ProducesResponseType<FormVersionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SaveDraft(int definitionId, int versionId, [FromBody] SaveFormDraftRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.SaveDraftAsync(definitionId, versionId, request, cancellationToken));

    /// <summary>Deletes a draft.</summary>
    /// <param name="definitionId">Definition id.</param>
    /// <param name="versionId">Draft version id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpDelete("{definitionId:int}/versions/{versionId:int}", Name = "DiscardFormDraft")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DiscardDraft(int definitionId, int versionId, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.DiscardDraftAsync(definitionId, versionId, cancellationToken));

    /// <summary>
    /// Validates and publishes a draft; the previous published version is retired in the same transaction. An invalid definition is
    /// 400 PUBLISH_VALIDATION_FAILED with <c>errors</c> keyed <c>form:&lt;fieldKey&gt;</c> (or <c>form</c>) whose codes are the contract's definition codes.
    /// </summary>
    /// <param name="definitionId">Definition id.</param>
    /// <param name="versionId">Draft version id.</param>
    /// <param name="rowVersion">Optional row version read last (409 CONCURRENCY_CONFLICT on mismatch).</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("{definitionId:int}/versions/{versionId:int}/publish", Name = "PublishFormVersion")]
    [ProducesResponseType<FormVersionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Publish(int definitionId, int versionId, [FromQuery] string? rowVersion, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.PublishAsync(definitionId, versionId, rowVersion, cancellationToken));

    /// <summary>Retires the published version.</summary>
    /// <param name="definitionId">Definition id.</param>
    /// <param name="versionId">Published version id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("{definitionId:int}/versions/{versionId:int}/retire", Name = "RetireFormVersion")]
    [ProducesResponseType<FormVersionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Retire(int definitionId, int versionId, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.RetireAsync(definitionId, versionId, cancellationToken));

    /// <summary>Summary of the differences between a version and another (default: the previous one).</summary>
    /// <param name="definitionId">Definition id.</param>
    /// <param name="versionId">The newer version.</param>
    /// <param name="against">The older version to compare with.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("{definitionId:int}/versions/{versionId:int}/diff", Name = "DiffFormVersion")]
    [ProducesResponseType<FormDiffModel>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Diff(int definitionId, int versionId, [FromQuery] int? against, CancellationToken cancellationToken) =>
        this.ToActionResult(await forms.DiffAsync(definitionId, versionId, against, cancellationToken));

    /// <summary>Validates and normalizes submitted values against a version without storing them (the same evaluator every write path uses).</summary>
    /// <param name="versionId">Version id (a draft needs the design permission).</param>
    /// <param name="request">Values and options.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("versions/{versionId:int}/validate", Name = "ValidateFormValues")]
    [ProducesResponseType<ValidateFormValuesResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Validate(int versionId, [FromBody] ValidateFormValuesRequest request, CancellationToken cancellationToken)
    {
        var version = await forms.GetVersionHeadAsync(versionId, cancellationToken);
        if (version.IsFailure)
        {
            return this.Problem(version.Error!);
        }

        var options = new FormSubmissionOptions
        {
            Mode = request.Mode,
            ExistingValues = request.ExistingValues,
            ValidateOnly = request.ValidateOnlyChanged ? FormSubmissionOptions.ChangedFieldsOf(request.Values, request.ExistingValues) : null,
        };
        var result = await validator.ValidateAsync(versionId, request.Values, options, cancellationToken);
        return this.ToActionResult(
            result,
            r => Ok(new ValidateFormValuesResponse(
                r.IsValid,
                [.. r.Errors.Select(e => new FormValueErrorModel(e.FieldKey, e.Code, e.Message))],
                new Dictionary<string, System.Text.Json.JsonElement>(r.NormalizedValues),
                r.DroppedFields)));
    }
}
