using System.ComponentModel.DataAnnotations;
using LptHub.Identity.Authorization;
using LptHub.Identity.Contracts;
using LptHub.Identity.People;
using LptHub.SharedKernel.Paging;
using LptHub.SharedKernel.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace LptHub.Identity.Api;

/// <summary>
/// The shared People list (epic #1373, issue #1374): one list for the matter Team and for vendor contacts. Every system user has a linked person
/// (name, e-mail and type read-only, created with the user, kept when the user is deactivated); internal people without a login and external people are
/// added by hand. People are deactivated, never deleted. Changes are audited field by field in the same transaction (object type <c>Person</c>).
/// </summary>
[ApiController]
[Route("api/v1/people")]
[Produces("application/json")]
public class PeopleController(PersonService people) : ControllerBase
{
    /// <summary>Lists and searches people, by last name then first name unless sorted otherwise.</summary>
    /// <param name="q">Search words, all of which must match the first name, last name, e-mail, company or title (any case).</param>
    /// <param name="type">Only <c>INTERNAL</c> or only <c>EXTERNAL</c> people; omit for both.</param>
    /// <param name="active">Only active (true) or only deactivated (false) people; omit for both.</param>
    /// <param name="page">1-based page number.</param>
    /// <param name="pageSize">Items per page (default 25, max 100).</param>
    /// <param name="sort">One of <c>name</c> (default), <c>-name</c>, <c>type</c>, <c>-type</c>, <c>title</c>, <c>-title</c>, <c>company</c>, <c>-company</c>.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "ListPeople")]
    [RequirePermission(Permissions.People.View)]
    [ProducesResponseType<PagedResult<PersonDto>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(
        [FromQuery, StringLength(100)] string? q,
        [FromQuery, StringLength(10)] string? type,
        [FromQuery] bool? active,
        [FromQuery, Range(1, int.MaxValue)] int page = PageRequest.FirstPage,
        [FromQuery, Range(1, PageRequest.MaxPageSize)] int pageSize = PageRequest.DefaultPageSize,
        [FromQuery, StringLength(30)] string? sort = null,
        CancellationToken cancellationToken = default)
    {
        if (sort is not null && !PersonService.Sorts.Split(", ").Contains(sort))
            return Failure(Error.Validation("sort", "INVALID", $"sort must be one of: {PersonService.Sorts}."));

        if (type is not null && type is not ("INTERNAL" or "EXTERNAL"))
            return Failure(Error.Validation("type", "INVALID", "type must be INTERNAL or EXTERNAL."));

        return Ok(await people.ListAsync(q, type, active, sort, new PageRequest(page, pageSize), cancellationToken));
    }

    /// <summary>Gets a person.</summary>
    /// <param name="personId">Person id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("{personId:int}", Name = "GetPerson")]
    [RequirePermission(Permissions.People.View)]
    [ProducesResponseType<PersonDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int personId, CancellationToken cancellationToken) =>
        From(await people.GetAsync(personId, cancellationToken));

    /// <summary>
    /// Picker source: active people matching the typed text (first name, last name, e-mail or company), best matches first, at most 20. People of a
    /// deactivated user are left out. Open to everyone who may edit a matter team (<c>Matter.Edit</c>) as well as to <c>People.View</c> and <c>People.Manage</c>.
    /// </summary>
    /// <param name="q">Typed text; empty returns the first 20 by name.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("lookup", Name = "LookupPeople")]
    [RequirePermission(Permissions.People.View + "|" + Permissions.People.Manage + "|" + Permissions.Matter.Edit)]
    [ProducesResponseType<PersonLookupItem[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Lookup([FromQuery, StringLength(100)] string? q, CancellationToken cancellationToken) =>
        Ok((await people.LookupAsync(q, cancellationToken)).ToArray());

    /// <summary>
    /// Duplicate hint ("Did you mean this person?"): people that resemble the one being typed, by the same e-mail, the same name (in either order)
    /// or a name a typo apart, best first, at most 5. Deactivated people are included and flagged.
    /// </summary>
    /// <param name="firstName">Typed first name.</param>
    /// <param name="lastName">Typed last name.</param>
    /// <param name="email">Typed e-mail address.</param>
    /// <param name="excludePersonId">A person to leave out (the one being edited).</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("similar", Name = "FindSimilarPeople")]
    [RequirePermission(Permissions.People.Manage)]
    [ProducesResponseType<PersonSimilarItem[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> FindSimilar(
        [FromQuery, StringLength(100)] string? firstName,
        [FromQuery, StringLength(100)] string? lastName,
        [FromQuery, StringLength(254)] string? email,
        [FromQuery] int? excludePersonId,
        CancellationToken cancellationToken) =>
        Ok((await people.SimilarAsync(firstName, lastName, email, excludePersonId, cancellationToken)).ToArray());

    /// <summary>Creates a person (internal without a login, or external). A person for a user is created with the user, never here.</summary>
    /// <param name="request">The person.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost(Name = "CreatePerson")]
    [RequirePermission(Permissions.People.Manage)]
    [ProducesResponseType<PersonDto>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreatePersonRequest request, CancellationToken cancellationToken) =>
        From(await people.CreateAsync(request, cancellationToken), created => CreatedAtAction(nameof(Get), new { personId = created.PersonId }, created));

    /// <summary>
    /// Edits a person, including deactivating or reactivating it. For a system-user person only title and comments can change (409
    /// <c>SYSTEM_PERSON_READ_ONLY</c> otherwise): its name and e-mail follow the user and it stays when the user is deactivated.
    /// </summary>
    /// <param name="personId">Person id.</param>
    /// <param name="request">New values and the row version last read.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPut("{personId:int}", Name = "UpdatePerson")]
    [RequirePermission(Permissions.People.Manage)]
    [ProducesResponseType<PersonDto>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int personId, [FromBody] UpdatePersonRequest request, CancellationToken cancellationToken) =>
        From(await people.UpdateAsync(personId, request, cancellationToken));

    private static IActionResult Failure(Error error) => new ObjectResult(error);

    private IActionResult From<T>(Result<T> result, Func<T, IActionResult>? onSuccess = null) =>
        result.IsFailure ? Failure(result.Error!) : onSuccess is null ? Ok(result.Value) : onSuccess(result.Value);
}
