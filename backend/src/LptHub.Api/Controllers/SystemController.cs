using System.ComponentModel.DataAnnotations;
using MatterFlow.Api.Http;
using MatterFlow.SharedKernel.Time;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace MatterFlow.Api.Controllers;

/// <summary>Pipeline-proof endpoint: exercises routing, model validation, ProblemDetails, time-zone resolution and OpenAPI/NSwag generation.</summary>
[ApiController]
[AllowAnonymous]
[Route("api/v1/system")]
public class SystemController(IClock clock, IUserTimeZone timeZone) : ControllerBase
{
    /// <summary>Returns server status, the current instant and the viewer's resolved time zone.</summary>
    /// <param name="message">Optional text echoed back (max 50 characters).</param>
    [HttpGet("ping", Name = "SystemPing")]
    [ProducesResponseType<PingResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ApiProblemDetails>(StatusCodes.Status400BadRequest, Problems.ContentType)]
    public ActionResult<PingResponse> Ping([FromQuery, StringLength(50)] string? message)
    {
        var now = clock.UtcNow;
        var local = timeZone.ToLocal(now);
        var offset = timeZone.Zone.GetUtcOffset(now);
        return new PingResponse(
            "ok",
            now,
            timeZone.Id,
            timeZone.IsFromRequest,
            new DateTimeOffset(local, offset),
            timeZone.Abbreviation(now),
            message);
    }
}

/// <summary>Response of <c>GET /api/v1/system/ping</c>.</summary>
/// <param name="Status">Always <c>ok</c>.</param>
/// <param name="ServerTimeUtc">Current instant (UTC).</param>
/// <param name="TimeZoneId">IANA id of the viewer's effective zone.</param>
/// <param name="TimeZoneFromRequest">False when the <c>X-Time-Zone</c> header was missing or invalid and the firm default applied.</param>
/// <param name="LocalTime">Current time in the viewer's zone.</param>
/// <param name="TimeZoneAbbreviation">Short zone label such as EDT.</param>
/// <param name="Echo">The <c>message</c> parameter, if supplied.</param>
public sealed record PingResponse(
    string Status,
    DateTime ServerTimeUtc,
    string TimeZoneId,
    bool TimeZoneFromRequest,
    DateTimeOffset LocalTime,
    string TimeZoneAbbreviation,
    string? Echo);
