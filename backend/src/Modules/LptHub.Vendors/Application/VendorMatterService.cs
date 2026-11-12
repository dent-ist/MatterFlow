using LptHub.Audit.Contracts;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Time;
using LptHub.Vendors.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Vendors.Application;

/// <summary>
/// The link between a vendor and a matter (epic #1373, issue #1377), read from both sides. The sensitive-matter rule applies to every call (<see cref="VendorAccess"/>): a matter the caller
/// may not see is a 404 on the matter side and is left out (never counted, never named) on the vendor side. Link and unlink are audited with the matter as scope
/// (<c>VENDOR_LINKED</c>, <c>VENDOR_UNLINKED</c>), in the same transaction, so the matter's history shows them only to people who may see the matter.
/// </summary>
public sealed class VendorMatterService(DbContext db, IAuditWriter audit, VendorAccess access, VendorService vendors, ICurrentUser currentUser, IClock clock)
{
    /// <summary>The matters a vendor is linked to that the caller may see, by reference.</summary>
    public async Task<Result<IReadOnlyList<VendorMatterResponse>>> ListMattersAsync(int vendorId, CancellationToken ct)
    {
        if (!await db.Set<Vendor>().AnyAsync(v => v.Id == vendorId, ct))
            return VendorSupport.NotFound("Vendor");

        var links = await access.VisibleLinks().Where(l => l.VendorId == vendorId).ToListAsync(ct);
        var summaries = await access.MatterSummariesAsync([.. links.Select(l => l.MatterId)], ct);
        var clientNames = new Dictionary<int, string?>();
        foreach (var clientId in summaries.Values.Select(m => m.ClientId).Distinct())
            clientNames[clientId] = await access.ClientNameAsync(clientId, ct);

        var by = await access.NamesAsync(links.Select(l => l.LinkedByUserId), ct);
        var items = links
            .Where(l => summaries.ContainsKey(l.MatterId))
            .Select(l => (Link: l, Matter: summaries[l.MatterId]))
            .OrderBy(x => x.Matter.MatterRef, StringComparer.Ordinal)
            .Select(x => new VendorMatterResponse(
                x.Matter.MatterId,
                x.Matter.MatterRef,
                x.Matter.Name,
                clientNames.GetValueOrDefault(x.Matter.ClientId),
                x.Matter.IsActive,
                VendorSupport.Utc(x.Link.LinkedAtUtc),
                x.Link.LinkedByUserId is { } id ? by.GetValueOrDefault(id) : null))
            .ToList();
        return Result<IReadOnlyList<VendorMatterResponse>>.Success(items);
    }

    /// <summary>The vendors linked to a matter, Blacklisted first, then by name. 404 when the matter does not exist or the caller may not see it.</summary>
    public async Task<Result<IReadOnlyList<MatterVendorResponse>>> ListVendorsAsync(int matterId, CancellationToken ct)
    {
        if (await access.FindVisibleMatterAsync(matterId, ct) is null)
            return MatterNotFound();

        var links = await db.Set<VendorMatter>().AsNoTracking().Where(l => l.MatterId == matterId).ToListAsync(ct);
        return Result<IReadOnlyList<MatterVendorResponse>>.Success(await ToResponsesAsync(links, ct));
    }

    public async Task<Result<MatterVendorResponse>> LinkAsync(int matterId, LinkVendorRequest request, CancellationToken ct)
    {
        var matter = await access.FindVisibleMatterAsync(matterId, ct);
        if (matter is null)
            return MatterNotFound();

        var vendor = await db.Set<Vendor>().AsNoTracking().SingleOrDefaultAsync(v => v.Id == request.VendorId, ct);
        if (vendor is null)
            return Error.Validation("vendorId", "INVALID", "Choose a vendor from the list.");

        if (vendor.CategoryCode == VendorCategories.Blacklisted && !request.ConfirmBlacklisted)
        {
            return Error.Conflict(
                ErrorCodes.VendorBlacklistedConfirmation,
                $"{vendor.Name} is Blacklisted. Confirm that you have read this and still want to link it.",
                new Dictionary<string, object?> { ["vendorId"] = vendor.Id });
        }

        if (await db.Set<VendorMatter>().AnyAsync(l => l.VendorId == vendor.Id && l.MatterId == matterId, ct))
            return AlreadyLinked(vendor.Name);

        var link = new VendorMatter { VendorId = vendor.Id, MatterId = matterId, LinkedAtUtc = clock.UtcNow, LinkedByUserId = currentUser.UserId };
        db.Set<VendorMatter>().Add(link);
        audit.Write(new AuditEntry
        {
            EventType = VendorAuditEvents.Linked,
            ObjectType = "Vendor",
            ObjectId = VendorSupport.Id(vendor.Id),
            MatterId = matterId,
            FieldKey = "Matter",
            NewValue = matter.MatterRef,
            Summary = $"{vendor.Name} linked to {matter.MatterRef}",
        });

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (VendorSupport.IsUniqueViolation(ex))
        {
            audit.DiscardPending();
            return AlreadyLinked(vendor.Name);
        }
        catch (DbUpdateException ex) when (VendorSupport.IsForeignKeyViolation(ex))
        {
            audit.DiscardPending();
            return Error.Validation("vendorId", "INVALID", "Choose a vendor from the list.");
        }

        return (await ToResponsesAsync([link], ct))[0];
    }

    public async Task<Result> UnlinkAsync(int matterId, int vendorId, CancellationToken ct)
    {
        var matter = await access.FindVisibleMatterAsync(matterId, ct);
        if (matter is null)
            return MatterNotFound();

        var link = await db.Set<VendorMatter>().SingleOrDefaultAsync(l => l.VendorId == vendorId && l.MatterId == matterId, ct);
        if (link is null)
            return VendorSupport.NotFound("Link");

        var name = await db.Set<Vendor>().AsNoTracking().Where(v => v.Id == vendorId).Select(v => v.Name).SingleAsync(ct);
        db.Set<VendorMatter>().Remove(link);
        audit.Write(new AuditEntry
        {
            EventType = VendorAuditEvents.Unlinked,
            ObjectType = "Vendor",
            ObjectId = VendorSupport.Id(vendorId),
            MatterId = matterId,
            FieldKey = "Matter",
            OldValue = matter.MatterRef,
            Summary = $"{name} unlinked from {matter.MatterRef}",
        });

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            audit.DiscardPending();
            return VendorSupport.NotFound("Link"); // removed by someone else in the meantime
        }

        return Result.Success();
    }

    private static Error MatterNotFound() => VendorSupport.NotFound("Matter");

    private static Error AlreadyLinked(string name) =>
        Error.Conflict(ErrorCodes.DuplicateLink, $"{name} is already linked to this matter.");

    private async Task<IReadOnlyList<MatterVendorResponse>> ToResponsesAsync(IReadOnlyList<VendorMatter> links, CancellationToken ct)
    {
        if (links.Count == 0)
            return [];

        var ids = links.Select(l => l.VendorId).ToList();
        var rows = await db.Set<Vendor>().AsNoTracking().Where(v => ids.Contains(v.Id)).ToListAsync(ct);
        var items = await vendors.LookupItemsForAsync(rows, ct);
        var by = await access.NamesAsync(links.Select(l => l.LinkedByUserId), ct);
        return links
            .Select(l => (Link: l, Item: items.FirstOrDefault(i => i.VendorId == l.VendorId)))
            .Where(x => x.Item is not null)
            .OrderBy(x => x.Item!.Category == VendorCategories.Blacklisted ? 0 : 1)
            .ThenBy(x => x.Item!.Name, StringComparer.OrdinalIgnoreCase)
            .Select(x => new MatterVendorResponse(
                x.Item!.VendorId,
                x.Item.Name,
                x.Item.Website,
                x.Item.Category,
                x.Item.Services,
                x.Item.HasDoNotHireContact,
                VendorSupport.Utc(x.Link.LinkedAtUtc),
                x.Link.LinkedByUserId is { } id ? by.GetValueOrDefault(id) : null))
            .ToList();
    }
}
