using MatterFlow.Identity.Contracts;
using MatterFlow.Organization.Application;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Organization.Api;

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
public class ClientsController(ClientService clients) : ControllerBase
{
    /// <summary>Lists Clients. <c>q</c> accepts a number (<c>343</c> or <c>00343</c>) or a name fragment. Sort: clientNumber (default), name, createdAt.</summary>
    [HttpGet(Name = "ListClients")]
    [Authorize(Policy = OrganizationPolicies.ClientView)]
    [ProducesResponseType<PagedResult<ClientResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] ClientListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ClientListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await clients.ListAsync(query, cancellationToken));
    }

    /// <summary>Gets one Client.</summary>
    [HttpGet("{clientId:int}", Name = "GetClient")]
    [Authorize(Policy = OrganizationPolicies.ClientView)]
    [ProducesResponseType<ClientResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int clientId, CancellationToken cancellationToken) =>
        this.ToActionResult(await clients.GetAsync(clientId, cancellationToken));

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
public class MattersController(MatterService matters) : ControllerBase
{
    /// <summary>Lists Matters. <c>q</c> accepts <c>343-12</c>, <c>00343-00012</c>, a client or matter number, or a name fragment. Sort: matterRef (default), name, clientNumber, createdAt.</summary>
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

    /// <summary>Gets one Matter, including its open Task count.</summary>
    [HttpGet("{matterId:int}", Name = "GetMatter")]
    [Authorize(Policy = OrganizationPolicies.MatterView)]
    [ProducesResponseType<MatterResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int matterId, CancellationToken cancellationToken) =>
        this.ToActionResult(await matters.GetAsync(matterId, cancellationToken));

    /// <summary>Creates a Matter under an active Client. The number is unique within the Client.</summary>
    [HttpPost(Name = "CreateMatter")]
    [Authorize(Policy = OrganizationPolicies.MatterCreate)]
    [ProducesResponseType<MatterResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateMatterRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(
            await matters.CreateAsync(request, cancellationToken),
            m => CreatedAtRoute("GetMatter", new { matterId = m.MatterId }, m));

    /// <summary>Updates a Matter's name and sensitivity flag.</summary>
    [HttpPut("{matterId:int}", Name = "UpdateMatter")]
    [Authorize(Policy = OrganizationPolicies.MatterEdit)]
    [ProducesResponseType<MatterResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int matterId, [FromBody] UpdateMatterRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await matters.UpdateAsync(matterId, request, cancellationToken));

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

/// <summary>Projects: flat containers of Tasks within a Matter.</summary>
[ApiController]
[Route("api/v1/projects")]
public class ProjectsController(ProjectService projects) : ControllerBase
{
    /// <summary>Lists Projects (use <c>matterId</c> for one Matter's Projects). Sort: name (default), matterRef, createdAt.</summary>
    [HttpGet(Name = "ListProjects")]
    [Authorize(Policy = OrganizationPolicies.ProjectView)]
    [ProducesResponseType<PagedResult<ProjectResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] ProjectListQuery query, CancellationToken cancellationToken)
    {
        if (ListFilters.UnknownFilter(Request, ProjectListQuery.Keys) is { } unknown)
            return this.Problem(unknown);

        return this.ToActionResult(await projects.ListAsync(query, cancellationToken));
    }

    /// <summary>Gets one Project.</summary>
    [HttpGet("{projectId:int}", Name = "GetProject")]
    [Authorize(Policy = OrganizationPolicies.ProjectView)]
    [ProducesResponseType<ProjectResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int projectId, CancellationToken cancellationToken) =>
        this.ToActionResult(await projects.GetAsync(projectId, cancellationToken));

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
