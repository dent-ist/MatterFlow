using MatterFlow.Identity.Contracts;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using MatterFlow.WorkflowEngine.Application.Steps;
using MatterFlow.WorkflowEngine.Application.Workflows;
using MatterFlow.WorkflowEngine.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.WorkflowEngine.Api;

/// <summary>Permission policy names for the workflow configuration endpoints ("Perm:" plus the permission code, resolved by the Identity module).</summary>
internal static class WorkflowPolicies
{
    private const string Prefix = "Perm:";

    /// <summary>Design the step library and workflows.</summary>
    public const string Manage = Prefix + Permissions.Workflow.Manage;

    /// <summary>Read published workflows (Task screens, Task Type eligibility pickers).</summary>
    public const string TaskView = Prefix + Permissions.Task.View;
}

internal static class WorkflowFilters
{
    /// <summary>Unknown query parameters are a 400 (architecture section 11).</summary>
    public static void EnsureKnown(HttpRequest request, IReadOnlyCollection<string> allowed) =>
        FilterParsing.EnsureKnown(request.Query.Keys, allowed).OrThrow();
}

/// <summary>The step library (UX S15): reusable steps with title, instructions, documentation link and an input form edited with the form designer.</summary>
[ApiController]
[Route("api/v1/step-definitions")]
[Produces("application/json")]
public class StepDefinitionsController(StepDefinitionService steps) : ControllerBase
{
    /// <summary>Lists library steps by title. <c>q</c> matches title or description; <c>isActive</c> filters by state.</summary>
    [HttpGet(Name = "ListStepDefinitions")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<PagedResult<StepDefinitionSummary>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<PagedResult<StepDefinitionSummary>>> List([FromQuery] StepDefinitionListQuery query, CancellationToken cancellationToken)
    {
        WorkflowFilters.EnsureKnown(Request, StepDefinitionListQuery.Keys);
        return (await steps.ListAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>Gets a step with its input form reference and where it is used.</summary>
    [HttpGet("{id:int}", Name = "GetStepDefinition")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<StepDefinitionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<StepDefinitionDetail>> Get(int id, CancellationToken cancellationToken) =>
        (await steps.GetAsync(id, cancellationToken)).OrThrow();

    /// <summary>Creates a step with an empty input form. Edit the inputs with the form designer (<c>/api/v1/forms</c>, owner kind Step).</summary>
    [HttpPost(Name = "CreateStepDefinition")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<StepDefinitionDetail>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<StepDefinitionDetail>> Create([FromBody] CreateStepDefinitionRequest request, CancellationToken cancellationToken)
    {
        var created = (await steps.CreateAsync(request, cancellationToken)).OrThrow();
        return CreatedAtRoute("GetStepDefinition", new { id = created.StepDefinitionId }, created);
    }

    /// <summary>Changes a step. Published workflow versions keep their own copy (addendum A).</summary>
    [HttpPut("{id:int}", Name = "UpdateStepDefinition")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<StepDefinitionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<StepDefinitionDetail>> Update(int id, [FromBody] UpdateStepDefinitionRequest request, CancellationToken cancellationToken) =>
        (await steps.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>Hides the step from new workflow drafts. Published workflow versions are not touched.</summary>
    [HttpPost("{id:int}/deactivate", Name = "DeactivateStepDefinition")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<StepDefinitionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<StepDefinitionDetail>> Deactivate(int id, [FromBody] StepActiveRequest request, CancellationToken cancellationToken) =>
        (await steps.DeactivateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>Makes a deactivated step available to new workflow drafts again.</summary>
    [HttpPost("{id:int}/activate", Name = "ActivateStepDefinition")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<StepDefinitionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<StepDefinitionDetail>> Activate(int id, [FromBody] StepActiveRequest request, CancellationToken cancellationToken) =>
        (await steps.ActivateAsync(id, request, cancellationToken)).OrThrow();
}

/// <summary>
/// Workflow definitions, versions and publish (UX S16, baseline 9). Designing needs <c>Workflow.Manage</c>; the published views
/// that Task Types and Tasks use need <c>Task.View</c>.
/// </summary>
[ApiController]
[Route("api/v1/workflows")]
[Produces("application/json")]
public class WorkflowsController(WorkflowAdminService workflows, IWorkflowCatalog catalog) : ControllerBase
{
    /// <summary>Lists workflows by name with their published and draft versions.</summary>
    [HttpGet(Name = "ListWorkflows")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<PagedResult<WorkflowSummary>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<PagedResult<WorkflowSummary>>> List([FromQuery] WorkflowListQuery query, CancellationToken cancellationToken)
    {
        WorkflowFilters.EnsureKnown(Request, WorkflowListQuery.Keys);
        return (await workflows.ListAsync(query, cancellationToken)).OrThrow();
    }

    /// <summary>Active workflows that have a published version: what a Task Type can list as eligible and what Task creation offers.</summary>
    [HttpGet("published", Name = "ListPublishedWorkflows")]
    [Authorize(Policy = WorkflowPolicies.TaskView)]
    [ProducesResponseType<IReadOnlyList<PublishedWorkflowSummary>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<PublishedWorkflowSummary>>> ListPublished(CancellationToken cancellationToken) =>
        Ok(await catalog.ListPublishedAsync(cancellationToken));

    /// <summary>Creates a workflow and its empty first draft.</summary>
    [HttpPost(Name = "CreateWorkflow")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<WorkflowDetail>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<WorkflowDetail>> Create([FromBody] CreateWorkflowRequest request, CancellationToken cancellationToken)
    {
        var created = (await workflows.CreateAsync(request, cancellationToken)).OrThrow();
        return CreatedAtRoute("GetWorkflow", new { id = created.Workflow.WorkflowDefinitionId }, created);
    }

    /// <summary>Gets a workflow with its versions.</summary>
    [HttpGet("{id:int}", Name = "GetWorkflow")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<WorkflowDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<WorkflowDetail>> Get(int id, CancellationToken cancellationToken) =>
        (await workflows.GetAsync(id, cancellationToken)).OrThrow();

    /// <summary>Renames a workflow, edits its description or deactivates it (it is then not offered for new tasks).</summary>
    [HttpPut("{id:int}", Name = "UpdateWorkflow")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<WorkflowDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<WorkflowDetail>> Update(int id, [FromBody] UpdateWorkflowRequest request, CancellationToken cancellationToken) =>
        (await workflows.UpdateAsync(id, request, cancellationToken)).OrThrow();

    /// <summary>
    /// The workflow's current published version with its steps (409 <c>WORKFLOW_NOT_PUBLISHED</c> when there is none or the workflow is inactive).
    /// </summary>
    [HttpGet("{id:int}/published", Name = "GetPublishedWorkflow")]
    [Authorize(Policy = WorkflowPolicies.TaskView)]
    [ProducesResponseType<WorkflowVersionSnapshot>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<WorkflowVersionSnapshot>> GetPublished(int id, CancellationToken cancellationToken) =>
        (await catalog.GetPublishedVersionAsync(id, cancellationToken)).OrThrow();

    /// <summary>Starts a new draft by copying the published version (or the given one). 409 <c>WORKFLOW_DRAFT_EXISTS</c> when a draft is open.</summary>
    [HttpPost("{id:int}/versions", Name = "CreateWorkflowDraft")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<WorkflowVersionDetail>(StatusCodes.Status201Created, "application/json")]
    public async Task<ActionResult<WorkflowVersionDetail>> CreateDraft(int id, [FromBody] CreateWorkflowDraftRequest request, CancellationToken cancellationToken)
    {
        var draft = (await workflows.CreateDraftAsync(id, request, cancellationToken)).OrThrow();
        return CreatedAtRoute("GetWorkflowVersion", new { id, versionId = draft.Version.WorkflowVersionId }, draft);
    }

    /// <summary>A version with its steps. Published and retired versions are readable with Task.View; a draft needs Workflow.Manage.</summary>
    [HttpGet("{id:int}/versions/{versionId:int}", Name = "GetWorkflowVersion")]
    [Authorize(Policy = WorkflowPolicies.TaskView)]
    [ProducesResponseType<WorkflowVersionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<WorkflowVersionDetail>> GetVersion(int id, int versionId, CancellationToken cancellationToken) =>
        (await workflows.GetVersionAsync(id, versionId, cancellationToken)).OrThrow();

    /// <summary>Replaces a draft's execution mode and ordered step list. Published and retired versions are 409 <c>WORKFLOW_VERSION_IMMUTABLE</c>.</summary>
    [HttpPut("{id:int}/versions/{versionId:int}", Name = "SaveWorkflowDraft")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<WorkflowVersionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<WorkflowVersionDetail>> SaveDraft(int id, int versionId, [FromBody] SaveWorkflowDraftRequest request, CancellationToken cancellationToken) =>
        (await workflows.SaveDraftAsync(id, versionId, request, cancellationToken)).OrThrow();

    /// <summary>Discards an open draft.</summary>
    [HttpDelete("{id:int}/versions/{versionId:int}", Name = "DiscardWorkflowDraft")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DiscardDraft(int id, int versionId, CancellationToken cancellationToken)
    {
        (await workflows.DiscardDraftAsync(id, versionId, cancellationToken)).OrThrow();
        return NoContent();
    }

    /// <summary>
    /// Validates and publishes a draft, retiring the previous published version. The step content is snapshotted from the library at this moment.
    /// 400 <c>PUBLISH_VALIDATION_FAILED</c> lists the problems.
    /// </summary>
    [HttpPost("{id:int}/versions/{versionId:int}/publish", Name = "PublishWorkflowVersion")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<WorkflowVersionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<WorkflowVersionDetail>> Publish(int id, int versionId, [FromBody] WorkflowVersionActionRequest request, CancellationToken cancellationToken) =>
        (await workflows.PublishAsync(id, versionId, request, cancellationToken)).OrThrow();

    /// <summary>Retires the published version: new tasks can no longer use the workflow. Existing tasks are unaffected.</summary>
    [HttpPost("{id:int}/versions/{versionId:int}/retire", Name = "RetireWorkflowVersion")]
    [Authorize(Policy = WorkflowPolicies.Manage)]
    [ProducesResponseType<WorkflowVersionDetail>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<WorkflowVersionDetail>> Retire(int id, int versionId, [FromBody] WorkflowVersionActionRequest request, CancellationToken cancellationToken) =>
        (await workflows.RetireAsync(id, versionId, request, cancellationToken)).OrThrow();
}
