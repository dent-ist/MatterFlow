using System.ComponentModel.DataAnnotations;
using LptHub.Identity.Contracts;
using LptHub.SharedKernel.Paging;
using LptHub.SharedKernel.Results;
using LptHub.Vendors.Application;
using LptHub.Vendors.Domain;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace LptHub.Vendors.Api;

/// <summary>Permission policy names for the Vendors endpoints ("Perm:" plus the permission code, resolved by the Identity module).</summary>
internal static class VendorPolicies
{
    private const string Prefix = "Perm:";

    public const string View = Prefix + Permissions.Vendor.View;
    public const string Manage = Prefix + Permissions.Vendor.Manage;
    public const string Link = Prefix + Permissions.Vendor.Link;
    public const string MatterView = Prefix + Permissions.Matter.View;

    /// <summary>The combobox on a matter also serves people who hold only <c>Vendor.Link</c> (the role editor ticks <c>Vendor.View</c> with it, but the server does not rely on that).</summary>
    public const string Lookup = Prefix + Permissions.Vendor.View + "|" + Permissions.Vendor.Link + "|" + Permissions.Vendor.Manage;

    /// <summary>The Services and Areas lists: read by the vendor form (<c>Vendor.View</c>) and by the admin page (<c>Vendor.Manage</c>).</summary>
    public const string OptionRead = Prefix + Permissions.Vendor.View + "|" + Permissions.Vendor.Manage;
}

/// <summary>
/// Vendors (epic #1373, issue #1377): the firm's vendor list with category, services, areas, Tech AI list and note. A vendor linked to a matter cannot be deleted
/// (409 <c>VENDOR_LINKED_TO_MATTERS</c>, with the count): set its category to Blacklisted instead. Changes are audited in the same transaction (object type <c>Vendor</c>).
/// </summary>
[ApiController]
[Route("api/v1/vendors")]
public class VendorsController(VendorService vendors, VendorContactService contacts, VendorMatterService links) : ControllerBase
{
    private static readonly string[] ListKeys = ["q", "category", "serviceId", "areaId", "sort", "page", "pageSize"];

    /// <summary>Lists and searches vendors, by name unless sorted otherwise.</summary>
    /// <param name="q">Search words, all of which must match the name, website or a service name (any case).</param>
    /// <param name="category">Only <c>PREFERRED</c> or only <c>BLACKLISTED</c> vendors; omit for both.</param>
    /// <param name="serviceId">Only vendors that have this service.</param>
    /// <param name="areaId">Only vendors that have this area.</param>
    /// <param name="page">1-based page number.</param>
    /// <param name="pageSize">Items per page (default 25, max 100).</param>
    /// <param name="sort">One of <c>name</c> (default), <c>-name</c>, <c>category</c>, <c>-category</c>, <c>updated</c>, <c>-updated</c>.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "ListVendors")]
    [Authorize(Policy = VendorPolicies.View)]
    [ProducesResponseType<PagedResult<VendorResponse>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(
        [FromQuery, StringLength(100)] string? q,
        [FromQuery, StringLength(12)] string? category,
        [FromQuery] int? serviceId,
        [FromQuery] int? areaId,
        [FromQuery, Range(1, int.MaxValue)] int page = PageRequest.FirstPage,
        [FromQuery, Range(1, PageRequest.MaxPageSize)] int pageSize = PageRequest.DefaultPageSize,
        [FromQuery, StringLength(30)] string? sort = null,
        CancellationToken cancellationToken = default)
    {
        if (FilterParsing.EnsureKnown(Request.Query.Keys, ListKeys).Error is { } unknown)
            return this.Problem(unknown);

        if (sort is not null && !VendorService.Sorts.Split(", ").Contains(sort))
            return this.Problem(Error.Validation("sort", "INVALID", $"sort must be one of: {VendorService.Sorts}."));

        if (category is not null && !VendorCategories.IsValid(category))
            return this.Problem(Error.Validation("category", "INVALID", "category must be PREFERRED or BLACKLISTED."));

        return Ok(await vendors.ListAsync(q, category, serviceId, areaId, sort, new PageRequest(page, pageSize), cancellationToken));
    }

    /// <summary>Gets a vendor.</summary>
    /// <param name="vendorId">Vendor id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("{vendorId:int}", Name = "GetVendor")]
    [Authorize(Policy = VendorPolicies.View)]
    [ProducesResponseType<VendorResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Get(int vendorId, CancellationToken cancellationToken) =>
        this.ToActionResult(await vendors.GetAsync(vendorId, cancellationToken));

    /// <summary>
    /// Combobox source: vendors whose name, website or service matches the typed text, best matches first (a name that starts with it), at most 20. Blacklisted vendors are included
    /// (never hidden); the category tells the screen to warn. Open to <c>Vendor.View</c>, <c>Vendor.Link</c> and <c>Vendor.Manage</c>.
    /// </summary>
    /// <param name="q">Typed text; empty returns the first 20 by name.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("lookup", Name = "LookupVendors")]
    [Authorize(Policy = VendorPolicies.Lookup)]
    [ProducesResponseType<VendorLookupItem[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Lookup([FromQuery, StringLength(100)] string? q, CancellationToken cancellationToken) =>
        Ok((await vendors.LookupAsync(q, cancellationToken)).ToArray());

    /// <summary>Creates a vendor. 409 <c>DUPLICATE_NAME</c> when the name exists (any case).</summary>
    /// <param name="request">The vendor.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost(Name = "CreateVendor")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType<VendorResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateVendorRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await vendors.CreateAsync(request, cancellationToken), created => Created($"/api/v1/vendors/{created.VendorId}", created));

    /// <summary>Replaces the data of a vendor (the full value). 409 <c>CONCURRENCY_CONFLICT</c> when the row version is stale, 409 <c>DUPLICATE_NAME</c> when the name exists.</summary>
    /// <param name="vendorId">Vendor id.</param>
    /// <param name="request">New values and the row version last read.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPut("{vendorId:int}", Name = "UpdateVendor")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType<VendorResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int vendorId, [FromBody] UpdateVendorRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await vendors.UpdateAsync(vendorId, request, cancellationToken));

    /// <summary>
    /// Deletes a vendor that no matter is linked to (its contacts, services, areas and Tech AI go with it; the people stay in People). 409 <c>VENDOR_LINKED_TO_MATTERS</c> with
    /// <c>meta.matterCount</c> when any matter, visible to the caller or not, is linked.
    /// </summary>
    /// <param name="vendorId">Vendor id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpDelete("{vendorId:int}", Name = "DeleteVendor")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int vendorId, CancellationToken cancellationToken)
    {
        var result = await vendors.DeleteAsync(vendorId, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }

    /// <summary>Lists the contacts of a vendor (people from People with their flag), by name.</summary>
    /// <param name="vendorId">Vendor id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("{vendorId:int}/contacts", Name = "ListVendorContacts")]
    [Authorize(Policy = VendorPolicies.View)]
    [ProducesResponseType<VendorContactResponse[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ListContacts(int vendorId, CancellationToken cancellationToken)
    {
        var result = await contacts.ListAsync(vendorId, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : Ok(result.Value.ToArray());
    }

    /// <summary>Adds a person from People as a contact of the vendor, optionally with a flag. 409 <c>DUPLICATE_LINK</c> when the person is already a contact.</summary>
    /// <param name="vendorId">Vendor id.</param>
    /// <param name="request">The person, flag, date and note.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost("{vendorId:int}/contacts", Name = "CreateVendorContact")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType<VendorContactResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> CreateContact(int vendorId, [FromBody] CreateVendorContactRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await contacts.CreateAsync(vendorId, request, cancellationToken), created => Created($"/api/v1/vendors/{vendorId}/contacts/{created.ContactId}", created));

    /// <summary>Changes the flag, reported date and note of a contact. Changing the flag makes the caller the reporter. The change is audited with the old values.</summary>
    /// <param name="vendorId">Vendor id.</param>
    /// <param name="contactId">Contact id.</param>
    /// <param name="request">New values and the row version last read.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPut("{vendorId:int}/contacts/{contactId:int}", Name = "UpdateVendorContact")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType<VendorContactResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> UpdateContact(int vendorId, int contactId, [FromBody] UpdateVendorContactRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await contacts.UpdateAsync(vendorId, contactId, request, cancellationToken));

    /// <summary>Removes a contact from the vendor (the person stays in People).</summary>
    /// <param name="vendorId">Vendor id.</param>
    /// <param name="contactId">Contact id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpDelete("{vendorId:int}/contacts/{contactId:int}", Name = "DeleteVendorContact")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DeleteContact(int vendorId, int contactId, CancellationToken cancellationToken)
    {
        var result = await contacts.DeleteAsync(vendorId, contactId, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }

    /// <summary>
    /// The matters a vendor is linked to (the reverse list), by reference. Only matters the caller may see are listed (sensitive-matter rule). Needs <c>Vendor.View</c> and <c>Matter.View</c>.
    /// </summary>
    /// <param name="vendorId">Vendor id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet("{vendorId:int}/matters", Name = "ListVendorMatters")]
    [Authorize(Policy = VendorPolicies.View)]
    [Authorize(Policy = VendorPolicies.MatterView)]
    [ProducesResponseType<VendorMatterResponse[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ListMatters(int vendorId, CancellationToken cancellationToken)
    {
        var result = await links.ListMattersAsync(vendorId, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : Ok(result.Value.ToArray());
    }
}

/// <summary>
/// The vendors of a matter (epic #1373, issue #1377): list, link and unlink. A matter the caller may not see (sensitive-matter rule) is a 404 on every call. Linking needs <c>Vendor.Link</c>,
/// <c>Vendor.View</c> and <c>Matter.View</c>; linking a Blacklisted vendor needs the confirming tick (<c>confirmBlacklisted</c>).
/// </summary>
[ApiController]
[Route("api/v1/matters/{matterId:int}/vendors")]
public class MatterVendorsController(VendorMatterService links) : ControllerBase
{
    /// <summary>Lists the vendors linked to the matter, Blacklisted first, then by name.</summary>
    /// <param name="matterId">Matter id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpGet(Name = "ListMatterVendors")]
    [Authorize(Policy = VendorPolicies.View)]
    [Authorize(Policy = VendorPolicies.MatterView)]
    [ProducesResponseType<MatterVendorResponse[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(int matterId, CancellationToken cancellationToken)
    {
        var result = await links.ListVendorsAsync(matterId, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : Ok(result.Value.ToArray());
    }

    /// <summary>
    /// Links a vendor to the matter. 409 <c>DUPLICATE_LINK</c> when already linked, 409 <c>VENDOR_BLACKLISTED_CONFIRMATION_REQUIRED</c> for a Blacklisted vendor without
    /// <c>confirmBlacklisted</c>. Audited as <c>VENDOR_LINKED</c> on the matter.
    /// </summary>
    /// <param name="matterId">Matter id.</param>
    /// <param name="request">The vendor and the Blacklisted confirmation.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpPost(Name = "LinkVendorToMatter")]
    [Authorize(Policy = VendorPolicies.Link)]
    [Authorize(Policy = VendorPolicies.View)]
    [Authorize(Policy = VendorPolicies.MatterView)]
    [ProducesResponseType<MatterVendorResponse>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Link(int matterId, [FromBody] LinkVendorRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await links.LinkAsync(matterId, request, cancellationToken), created => Created($"/api/v1/matters/{matterId}/vendors", created));

    /// <summary>Unlinks a vendor from the matter. Audited as <c>VENDOR_UNLINKED</c> on the matter.</summary>
    /// <param name="matterId">Matter id.</param>
    /// <param name="vendorId">Vendor id.</param>
    /// <param name="cancellationToken">Request cancellation.</param>
    [HttpDelete("{vendorId:int}", Name = "UnlinkVendorFromMatter")]
    [Authorize(Policy = VendorPolicies.Link)]
    [Authorize(Policy = VendorPolicies.View)]
    [Authorize(Policy = VendorPolicies.MatterView)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Unlink(int matterId, int vendorId, CancellationToken cancellationToken)
    {
        var result = await links.UnlinkAsync(matterId, vendorId, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }
}

/// <summary>Services: the admin-managed list a vendor's services are picked from (multi-select). A used item is deactivated, never deleted.</summary>
[ApiController]
[Route("api/v1/vendor-services")]
public class VendorServicesController(VendorOptionService<VendorServiceOption> items) : ControllerBase
{
    /// <summary>Lists all services in their order, including inactive ones (pickers hide the inactive), with how many vendors use each. Needs <c>Vendor.View</c> or <c>Vendor.Manage</c>.</summary>
    [HttpGet(Name = "ListVendorServices")]
    [Authorize(Policy = VendorPolicies.OptionRead)]
    [ProducesResponseType<IReadOnlyList<VendorOptionView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken) => Ok(await items.ListAsync(cancellationToken));

    /// <summary>Adds a service at the end of the list. 409 <c>DUPLICATE_NAME</c> when the name exists.</summary>
    [HttpPost(Name = "CreateVendorService")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType<VendorOptionView>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateVendorOptionRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await items.CreateAsync(request, cancellationToken), created => Created($"/api/v1/vendor-services/{created.Id}", created));

    /// <summary>Renames, activates or deactivates a service (the way to retire a used one).</summary>
    [HttpPut("{id:int}", Name = "UpdateVendorService")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType<VendorOptionView>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateVendorOptionRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await items.UpdateAsync(id, request, cancellationToken));

    /// <summary>Sets the order. The list must contain every item exactly once. Returns the full list.</summary>
    [HttpPut("order", Name = "ReorderVendorServices")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType<IReadOnlyList<VendorOptionView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Reorder([FromBody] ReorderVendorOptionsRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await items.ReorderAsync(request.Ids, cancellationToken));

    /// <summary>Deletes a service no vendor uses (In Use 0). 409 <c>IN_USE</c> otherwise: deactivate it instead.</summary>
    [HttpDelete("{id:int}", Name = "DeleteVendorService")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var result = await items.DeleteAsync(id, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }
}

/// <summary>Areas: the admin-managed list a vendor's areas are picked from (multi-select). A used item is deactivated, never deleted.</summary>
[ApiController]
[Route("api/v1/vendor-areas")]
public class VendorAreasController(VendorOptionService<VendorAreaOption> items) : ControllerBase
{
    /// <summary>Lists all areas in their order, including inactive ones (pickers hide the inactive), with how many vendors use each. Needs <c>Vendor.View</c> or <c>Vendor.Manage</c>.</summary>
    [HttpGet(Name = "ListVendorAreas")]
    [Authorize(Policy = VendorPolicies.OptionRead)]
    [ProducesResponseType<IReadOnlyList<VendorOptionView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken) => Ok(await items.ListAsync(cancellationToken));

    /// <summary>Adds an area at the end of the list. 409 <c>DUPLICATE_NAME</c> when the name exists.</summary>
    [HttpPost(Name = "CreateVendorArea")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType<VendorOptionView>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] CreateVendorOptionRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await items.CreateAsync(request, cancellationToken), created => Created($"/api/v1/vendor-areas/{created.Id}", created));

    /// <summary>Renames, activates or deactivates an area (the way to retire a used one).</summary>
    [HttpPut("{id:int}", Name = "UpdateVendorArea")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType<VendorOptionView>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateVendorOptionRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await items.UpdateAsync(id, request, cancellationToken));

    /// <summary>Sets the order. The list must contain every item exactly once. Returns the full list.</summary>
    [HttpPut("order", Name = "ReorderVendorAreas")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType<IReadOnlyList<VendorOptionView>>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Reorder([FromBody] ReorderVendorOptionsRequest request, CancellationToken cancellationToken) =>
        this.ToActionResult(await items.ReorderAsync(request.Ids, cancellationToken));

    /// <summary>Deletes an area no vendor uses (In Use 0). 409 <c>IN_USE</c> otherwise: deactivate it instead.</summary>
    [HttpDelete("{id:int}", Name = "DeleteVendorArea")]
    [Authorize(Policy = VendorPolicies.Manage)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var result = await items.DeleteAsync(id, cancellationToken);
        return result.IsFailure ? this.Problem(result.Error!) : NoContent();
    }
}
