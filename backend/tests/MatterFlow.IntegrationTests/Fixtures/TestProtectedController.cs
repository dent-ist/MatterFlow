using MatterFlow.Identity.Authorization;
using MatterFlow.Identity.Contracts;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>Test-only endpoints standing in for the real feature controllers (not part of the API assembly or OpenAPI contract).</summary>
[ApiController]
[Route("api/v1/test")]
public class TestProtectedController : ControllerBase
{
    [HttpGet("tasks")]
    [RequirePermission(Permissions.Task.View)]
    public IActionResult ListTasks() => Ok(new[] { "task" });

    [HttpGet("clients")]
    [RequirePermission(Permissions.Client.View)]
    public IActionResult ListClients() => Ok(new[] { "client" });

    [HttpGet("task-types")]
    [RequirePermission(Permissions.TaskType.Manage)]
    public IActionResult ListTaskTypes() => Ok(new[] { "task type" });

    [HttpPost("task-types")]
    [RequirePermission(Permissions.TaskType.Manage)]
    public IActionResult CreateTaskType() => StatusCode(StatusCodes.Status201Created);

    [HttpGet("workflows")]
    [RequirePermission(Permissions.Workflow.Manage)]
    public IActionResult ListWorkflows() => Ok(new[] { "workflow" });

    [HttpPut("workflows")]
    [RequirePermission(Permissions.Workflow.Manage)]
    public IActionResult UpdateWorkflow() => NoContent();

    /// <summary>No explicit policy: must fall back to the fail-closed default.</summary>
    [HttpGet("no-policy")]
    public IActionResult NoPolicy() => Ok("reached");
}
