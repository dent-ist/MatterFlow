using LptHub.Identity.Contracts;
using LptHub.Organization.Application;
using LptHub.SharedKernel.Paging;
using LptHub.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace LptHub.Organization.Api;

/// <summary>Permission policy names for the Organization endpoints ("Perm:" plus the permission code, resolved by the Identity module).</summary>
internal static class OrganizationPolicies
{
    private const string Prefix = "Perm:";

    public const string ClientView = Prefix + Permissions.Client.View;
    public const string ClientCreate = Prefix + Permissions.Client.Create;
    public const string ClientEdit = Prefix + Permissions.Client.Edit;
    public const string ClientEditNumber = Prefix + Permissions.Client.EditNumber;
    public const string MatterView = Prefix + Permissions.Matter.View;
    public const string MatterCreate = Prefix + Permissions.Matter.Create;
    public const string MatterEdit = Prefix + Permissions.Matter.Edit;
    public const string MatterEditNumber = Prefix + Permissions.Matter.EditNumber;
    public const string MatterSetActive = Prefix + Permissions.Matter.SetActive;
    public const string MatterAssignManagers = Prefix + Permissions.Matter.AssignManagers;
    public const string ProjectView = Prefix + Permissions.Project.View;
    public const string ProjectCreate = Prefix + Permissions.Project.Create;
    public const string ProjectEdit = Prefix + Permissions.Project.Edit;
    public const string ProjectArchive = Prefix + Permissions.Project.Archive;
}

internal static class ListFilters
{
    /// <summary>Unknown query parameters are a 400 (architecture section 11).</summary>
    public static Error? UnknownFilter(HttpRequest request, IReadOnlyCollection<string> allowed)
    {
        var check = FilterParsing.EnsureKnown(request.Query.Keys, allowed);
        return check.Error;
    }
}

/// <summary>Clients: the firm's client list with their zero-padded numbers.</summary>
[ApiController]
[Route("api/v1/clients")]
public class ClientsController(ClientService clients, CustomFieldValues customFields) : ControllerBase
{
    /// <summary>Lists Clients. <c>q</c> accepts a number (<c>343</c> or <c>00343</c>) or a name fragment. Sort: clientNumber (default), name, createdAt, openTasks, overdue (Task counts; -openTasks is most first; ties by the default order).</summary>
    [HttpGet(Name = "ListClients")]
    [Authorize(Policy = OrganizationPolicies.ClientView)]
    [ProducesResponseType<PagedResult<ClientResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] ClientListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ClientListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await clients.ListAsync(query, cancellationToken));
    }

    /// <summary>The published custom-field form version to render on the create and edit screens (null when the form has no published version).</summary>
    [HttpGet("custom-fields", Name = "GetClientCustomFieldForm")]
    [Authorize(Policy = OrganizationPolicies.ClientView)]
    [ProducesResponseType<CustomFieldFormResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> CustomFieldForm(CancellationToken cancellationToken) =>
        Ok(new CustomFieldFormResponse(await customFields.PublishedVersionAsync(CustomFieldTarget.Client, cancellationToken)));

    /// <summary>Gets one Client.</summary>
    [HttpGet("{clientId:int}", Name = "GetClient")]
    [Authorize(Policy = OrganizationPolicies.ClientView)]
    [ProducesResponseType<ClientResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int clientId, CancellationToken cancellationToken) =>
        this.ToActionResult(await clients.GetAsync(clientId, cancellationToken));

    /// <summary>
    /// Counts for the Client overview strip: open, overdue, ASAP, on hold and due soon Tasks over all the Client's Matters (the Dashboard and Task Queue
    /// definitions, in the viewer's time zone), the Matter counts and the Matters with the most open Tasks. The Task numbers are null without <c>Task.View</c>.
    /// </summary>
    [HttpGet("{clientId:int}/summary", Name = "GetClientSummary")]
    [Authorize(Policy = OrganizationPolicies.ClientView)]
    [ProducesResponseType<ClientSummaryResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Summary(int clientId, CancellationToken cancellationToken) =>
        this.ToActionResult(await clients.SummaryAsync(clientId, cancellationToken));

    /// <summary>Creates a Client. The number is normalized (<c>343</c> becomes <c>00343</c>) and must be unique.</summary>
    [HttpPost(Name = "CreateClient")]
    [Authorize(Policy = OrganizationPolicies.ClientCreate)]
    [ProducesResponseType<ClientResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateClientRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await clients.CreateAsync(request, cancellationToken),
            c => CreatedAtRoute("GetClient", new { clientId = c.ClientId }, c));

    /// <summary>Updates a Client's name and active flag.</summary>
    [HttpPut("{clientId:int}", Name = "UpdateClient")]
    [Authorize(Policy = OrganizationPolicies.ClientEdit)]
    [ProducesResponseType<ClientResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int clientId, [FromBody] UpdateClientRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await clients.UpdateAsync(clientId, request, cancellationToken));

    /// <summary>Changes a Client's number. Restricted to <c>Client.EditNumber</c> and recorded as CLIENT_NUMBER_CHANGED.</summary>
    [HttpPut("{clientId:int}/number", Name = "ChangeClientNumber")]
    [Authorize(Policy = OrganizationPolicies.ClientEditNumber)]
    [ProducesResponseType<ClientResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ChangeNumber(int clientId, [FromBody] ChangeNumberRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await clients.ChangeNumberAsync(clientId, request, cancellationToken));
}

/// <summary>Matters: unique per Client, displayed as <c>00343-00012</c>.</summary>
[ApiController]
[Route("api/v1/matters")]
public class MattersController(MatterService matters, CustomFieldValues customFields) : ControllerBase
{
    /// <summary>Lists Matters. <c>q</c> accepts <c>343-12</c>, <c>00343-00012</c>, a client or matter number, or a name fragment. Sort: matterRef (default), name, clientNumber, createdAt, openTasks, overdue (Task counts; ties by the default order), primaryManager, secondaryManager (by name, matters without one last). Manager filters: primaryManagerId, secondaryManagerId, managerId (either), managedByMe, hasNoManager, hasPrimaryManager, hasSecondaryManager. Matter Type and Current State filters (epic #1298): <c>matterTypeId</c> and <c>currentStateId</c> (repeatable) with <c>matterTypeNone=true</c> / <c>currentStateNone=true</c> for the "Not Set" choice; a matter matches on any chosen value (a matter with several types matches when any of its types is chosen). <c>q</c> also matches the type and state names. Sort also by matterType (the first type in the list order) and currentState (list order, then name; matters without one last).</summary>
    [HttpGet(Name = "ListMatters")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<PagedResult<MatterResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] MatterListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, MatterListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await matters.ListAsync(query, cancellationToken));
    }

    /// <summary>Resolves a Matter by reference, padded or not (<c>343-12</c> and <c>00343-00012</c> find the same record). 404 when none.</summary>
    [HttpGet("lookup", Name = "LookupMatter")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<MatterResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Lookup([FromQuery(Name = "ref")] string? reference, CancellationToken cancellationToken) =>
        this.ToActionResult(await matters.LookupAsync(reference, cancellationToken));

    /// <summary>The published custom-field form version to render on the create and edit screens (null when the form has no published version).</summary>
    [HttpGet("custom-fields", Name = "GetMatterCustomFieldForm")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<CustomFieldFormResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> CustomFieldForm(CancellationToken cancellationToken) =>
        Ok(new CustomFieldFormResponse(await customFields.PublishedVersionAsync(CustomFieldTarget.Matter, cancellationToken)));

    /// <summary>Gets one Matter, including its open and overdue Task counts.</summary>
    [HttpGet("{matterId:int}", Name = "GetMatter")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<MatterResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int matterId, CancellationToken cancellationToken) =>
        this.ToActionResult(await matters.GetAsync(matterId, cancellationToken));

    /// <summary>
    /// Counts for the Matter overview strip: open, overdue, ASAP, on hold and due soon Tasks (project Tasks included), the Project count and the Asset
    /// count. The Task numbers are null without <c>Task.View</c>.
    /// </summary>
    [HttpGet("{matterId:int}/summary", Name = "GetMatterSummary")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<MatterSummaryResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Summary(int matterId, CancellationToken cancellationToken) =>
        this.ToActionResult(await matters.SummaryAsync(matterId, cancellationToken));

    /// <summary>Creates a Matter under an active Client. The number is unique within the Client.</summary>
    [HttpPost(Name = "CreateMatter")]
    [Authorize(Policy = OrganizationPolicies.MatterCreate)]
    [ProducesResponseType<MatterResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateMatterRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await matters.CreateAsync(request, cancellationToken),
            m => CreatedAtRoute("GetMatter", new { matterId = m.MatterId }, m));

    /// <summary>Updates a Matter's name, sensitivity flag, Matter Type, Current State and DMS/DFS paths (type, state and paths are full values: send the current ones to keep them, null to clear). 400 <c>INVALID_PATH</c>; Matter Type and Current State changes are audited.</summary>
    [HttpPut("{matterId:int}", Name = "UpdateMatter")]
    [Authorize(Policy = OrganizationPolicies.MatterEdit)]
    [ProducesResponseType<MatterResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int matterId, [FromBody] UpdateMatterRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await matters.UpdateAsync(matterId, request, cancellationToken));

    /// <summary>
    /// Sets or clears a Matter's Primary and Secondary project manager (both values are replaced; send null to clear). Restricted to
    /// <c>Matter.AssignManagers</c>, not <c>Matter.Edit</c>. A person must be an active user holding <c>Matter.BeManager</c> (400 <c>MANAGER_NOT_ELIGIBLE</c>),
    /// the two must differ (400 <c>MANAGER_DUPLICATE</c>); a person already on the matter is always accepted, a Secondary without a Primary is allowed.
    /// Recorded as one MATTER_MANAGER_CHANGED event per changed place.
    /// </summary>
    [HttpPut("{matterId:int}/managers", Name = "SetMatterManagers")]
    [Authorize(Policy = OrganizationPolicies.MatterAssignManagers)]
    [ProducesResponseType<MatterResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetManagers(int matterId, [FromBody] SetMatterManagersRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await matters.SetManagersAsync(matterId, request, cancellationToken));

    /// <summary>Changes a Matter's number. Restricted to <c>Matter.EditNumber</c> and recorded as MATTER_NUMBER_CHANGED.</summary>
    [HttpPut("{matterId:int}/number", Name = "ChangeMatterNumber")]
    [Authorize(Policy = OrganizationPolicies.MatterEditNumber)]
    [ProducesResponseType<MatterResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ChangeNumber(int matterId, [FromBody] ChangeNumberRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await matters.ChangeNumberAsync(matterId, request, cancellationToken));

    /// <summary>Activates or deactivates a Matter. Deactivation fails with 409 <c>MATTER_HAS_OPEN_TASKS</c> while any Task is not Completed or Cancelled.</summary>
    [HttpPost("{matterId:int}/active", Name = "SetMatterActive")]
    [Authorize(Policy = OrganizationPolicies.MatterSetActive)]
    [ProducesResponseType<MatterResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetActive(int matterId, [FromBody] SetActiveRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await matters.SetActiveAsync(matterId, request, cancellationToken));
}

/// <summary>
/// A matter's team (epic #1298): typed-in contacts (name, e-mail, title), not user accounts. Reading needs <c>Matter.View</c> (and the sensitive-matter rule),
/// changing needs <c>Matter.Edit</c>. A matter the caller may not see is reported as 404.
/// </summary>
[ApiController]
[Route("api/v1/matters/{matterId:int}/team")]
[Produces("application/json")]
public class MatterTeamController(MatterTeamService team) : ControllerBase
{
    /// <summary>Lists one page of the team. Sort: name (default), email, title (minus sign for descending); page and pageSize as everywhere (default 25, max 100).</summary>
    [HttpGet(Name = "ListMatterTeam")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<PagedResult<MatterTeamMemberResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(int matterId, [FromQuery] TeamListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ["page", "pageSize", "sort"]) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await team.ListAsync(matterId, query, cancellationToken));
    }

    /// <summary>
    /// Adds a person to the team. The title must be an active Team Title. 400 <c>INVALID_EMAIL</c> for a malformed address; 409 <c>DUPLICATE_TEAM_EMAIL</c>
    /// (field <c>email</c>, <c>meta.existingId</c> = the member who has it) when the address, compared without regard to case, is already on this matter's team.
    /// </summary>
    [HttpPost(Name = "AddMatterTeamMember")]
    [Authorize(Policy = OrganizationPolicies.MatterEdit)]
    [ProducesResponseType<MatterTeamMemberResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Add(int matterId, [FromBody] AddTeamMemberRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await team.AddAsync(matterId, request, cancellationToken),
            m => Created($"/api/v1/matters/{matterId}/team/{m.Id}", m));

    /// <summary>Changes a team member (name, e-mail, title; all replaced). Same checks as add; editing a row to its own e-mail is not a duplicate. A retired title is accepted only when the member already has it.</summary>
    [HttpPut("{memberId:int}", Name = "UpdateMatterTeamMember")]
    [Authorize(Policy = OrganizationPolicies.MatterEdit)]
    [ProducesResponseType<MatterTeamMemberResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int matterId, int memberId, [FromBody] UpdateTeamMemberRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await team.UpdateAsync(matterId, memberId, request, cancellationToken));

    /// <summary>Removes a team member (a real delete; recorded in the audit log). Removing someone already gone answers 204 too.</summary>
    [HttpDelete("{memberId:int}", Name = "RemoveMatterTeamMember")]
    [Authorize(Policy = OrganizationPolicies.MatterEdit)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Remove(int matterId, int memberId, CancellationToken cancellationToken)
    {
        var result = await team.RemoveAsync(matterId, memberId, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }
}

/// <summary>Projects: flat containers of Tasks within a Matter.</summary>
[ApiController]
[Route("api/v1/projects")]
public class ProjectsController(ProjectService projects, CustomFieldValues customFields) : ControllerBase
{
    /// <summary>Lists Projects (use <c>matterId</c> for one Matter's Projects). Sort: name (default), matterRef, createdAt, openTasks, overdue (Task counts; ties by the default order).</summary>
    [HttpGet(Name = "ListProjects")]
    [Authorize(Policy = OrganizationPolicies.ProjectView)]
    [ProducesResponseType<PagedResult<ProjectResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] ProjectListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ProjectListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await projects.ListAsync(query, cancellationToken));
    }

    /// <summary>The published custom-field form version to render on the create and edit screens (null when the form has no published version).</summary>
    [HttpGet("custom-fields", Name = "GetProjectCustomFieldForm")]
    [Authorize(Policy = OrganizationPolicies.ProjectView)]
    [ProducesResponseType<CustomFieldFormResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> CustomFieldForm(CancellationToken cancellationToken) =>
        Ok(new CustomFieldFormResponse(await customFields.PublishedVersionAsync(CustomFieldTarget.Project, cancellationToken)));

    /// <summary>Gets one Project.</summary>
    [HttpGet("{projectId:int}", Name = "GetProject")]
    [Authorize(Policy = OrganizationPolicies.ProjectView)]
    [ProducesResponseType<ProjectResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int projectId, CancellationToken cancellationToken) =>
        this.ToActionResult(await projects.GetAsync(projectId, cancellationToken));

    /// <summary>Counts for the Project overview strip: open, overdue, ASAP, on hold and due soon Tasks of the Project. The numbers are null without <c>Task.View</c>.</summary>
    [HttpGet("{projectId:int}/summary", Name = "GetProjectSummary")]
    [Authorize(Policy = OrganizationPolicies.ProjectView)]
    [ProducesResponseType<ProjectSummaryResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Summary(int projectId, CancellationToken cancellationToken) =>
        this.ToActionResult(await projects.SummaryAsync(projectId, cancellationToken));

    /// <summary>Creates a Project in a Matter. The name is unique within the Matter.</summary>
    [HttpPost(Name = "CreateProject")]
    [Authorize(Policy = OrganizationPolicies.ProjectCreate)]
    [ProducesResponseType<ProjectResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateProjectRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await projects.CreateAsync(request, cancellationToken),
            p => CreatedAtRoute("GetProject", new { projectId = p.ProjectId }, p));

    /// <summary>Updates a Project's name and description.</summary>
    [HttpPut("{projectId:int}", Name = "UpdateProject")]
    [Authorize(Policy = OrganizationPolicies.ProjectEdit)]
    [ProducesResponseType<ProjectResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int projectId, [FromBody] UpdateProjectRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await projects.UpdateAsync(projectId, request, cancellationToken));

    /// <summary>Archives (<c>isActive: false</c>) or restores a Project. Existing Tasks keep it; new Tasks cannot select it.</summary>
    [HttpPost("{projectId:int}/active", Name = "SetProjectActive")]
    [Authorize(Policy = OrganizationPolicies.ProjectArchive)]
    [ProducesResponseType<ProjectResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> SetActive(int projectId, [FromBody] SetActiveRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await projects.SetActiveAsync(projectId, request, cancellationToken));
}
