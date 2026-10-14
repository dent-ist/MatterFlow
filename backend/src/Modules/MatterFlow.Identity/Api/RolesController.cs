using MatterFlow.Identity.Application;
using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Identity.Api;

/// <summary>
/// Roles, role-permission assignment and the permission catalog (UX S12). Reading roles and the catalog needs <c>User.View</c>
/// (the user drawer lists roles); creating, editing and deleting needs <c>Role.Manage</c>.
/// </summary>
[ApiController]
[Route("api/v1")]
[Produces("application/json")]
public class RolesController(RoleAdministration roles) : ControllerBase
{
    /// <summary>Lists roles with member and permission counts (System Admin first).</summary>
    [HttpGet("roles", Name = "ListRoles")]
    [RequirePermission(Permissions.User.View)]
    [ProducesResponseType<RoleSummaryDto[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<RoleSummaryDto>>> List(CancellationToken cancellationToken) =>
        Ok(await roles.ListAsync(cancellationToken));

    /// <summary>Gets one role with its permission codes.</summary>
    [HttpGet("roles/{roleId:int}", Name = "GetRole")]
    [RequirePermission(Permissions.User.View)]
    [ProducesResponseType<RoleDetailDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int roleId, CancellationToken cancellationToken) =>
        this.ToActionResult(await roles.GetAsync(roleId, cancellationToken));

    /// <summary>Creates a role with the given permissions from the catalog.</summary>
    [HttpPost("roles", Name = "CreateRole")]
    [RequirePermission(Permissions.Role.Manage)]
    [ProducesResponseType<RoleDetailDto>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateRoleRequest request, CancellationToken cancellationToken)
    {
        var result = await roles.CreateAsync(request, cancellationToken);
        return result.IsFailure
            ? this.Problem(result.Error!)
            : CreatedAtRoute("GetRole", new { roleId = result.Value.RoleId }, result.Value);
    }

    /// <summary>Edits name, description and the full permission set. The System Admin role is read-only (409 <c>IMMUTABLE_FIELD</c>).</summary>
    [HttpPut("roles/{roleId:int}", Name = "UpdateRole")]
    [RequirePermission(Permissions.Role.Manage)]
    [ProducesResponseType<RoleDetailDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int roleId, [FromBody] UpdateRoleRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await roles.UpdateAsync(roleId, request, cancellationToken));

    /// <summary>Deletes an unused role (409 <c>ROLE_IN_USE</c> while users hold it; System Admin cannot be deleted).</summary>
    [HttpDelete("roles/{roleId:int}", Name = "DeleteRole")]
    [RequirePermission(Permissions.Role.Manage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int roleId, CancellationToken cancellationToken) =>
        this.ToActionResult(await roles.DeleteAsync(roleId, cancellationToken));

    /// <summary>The permission catalog grouped for the role editor.</summary>
    [HttpGet("permissions", Name = "ListPermissions")]
    [RequirePermission(Permissions.User.View)]
    [ProducesResponseType<PermissionGroupDto[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<PermissionGroupDto>>> Catalog(CancellationToken cancellationToken) =>
        Ok(await roles.CatalogAsync(cancellationToken));
}
