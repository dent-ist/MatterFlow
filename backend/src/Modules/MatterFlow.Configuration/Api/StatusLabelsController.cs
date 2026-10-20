using MatterFlow.Configuration.Application.Lookups;
using MatterFlow.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Configuration.Api;

/// <summary>
/// Display labels of the five fixed lifecycle statuses (UX S18). The code set is fixed: there is no create or delete, and a code
/// can never change; only the label text is editable.
/// </summary>
[ApiController]
[Route("api/v1/status-labels")]
[Produces("application/json")]
public class StatusLabelsController(StatusLabelService labels) : ControllerBase
{
    /// <summary>Lists the five statuses in lifecycle order with their current labels.</summary>
    [HttpGet(Name = "ListStatusLabels")]
    [Authorize(Policy = ConfigurationPolicies.StatusLabelRead)]
    [ProducesResponseType<IReadOnlyList<StatusLabelView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<IReadOnlyList<StatusLabelView>>> List(CancellationToken cancellationToken) =>
        Ok(await labels.ListViewsAsync(cancellationToken));

    /// <summary>Renames how a status is displayed. <paramref name="code"/> must be one of the five fixed codes (else 404).</summary>
    [HttpPut("{code}", Name = "UpdateStatusLabel")]
    [Authorize(Policy = ConfigurationPolicies.StatusLabelManage)]
    [ProducesResponseType<StatusLabelView>(StatusCodes.Status200OK, "application/json")]
    public async Task<ActionResult<StatusLabelView>> Update(string code, [FromBody] UpdateStatusLabelRequest request, CancellationToken cancellationToken) =>
        (await labels.UpdateAsync(code, request, cancellationToken)).OrThrow();
}
