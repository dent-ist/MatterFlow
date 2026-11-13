using LptHub.Audit.Contracts;
using LptHub.SharedKernel.Paging;
using LptHub.SharedKernel.Results;
using LptHub.Vendors.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Vendors.Application;

/// <summary>
/// Vendors (epic #1373, issue #1377): list, search, create, edit and delete. Field changes are audited by the Data layer (<c>[Audited]</c> on <see cref="Vendor"/>);
/// the services, areas and Tech AI list are audited by explicit events (one per list that changed), in the same transaction.
/// A vendor that is linked to a matter cannot be deleted (409 <c>VENDOR_LINKED_TO_MATTERS</c>); there is no deactivation: change the category to Blacklisted instead.
/// </summary>
public sealed class VendorService(DbContext db, IAuditWriter audit, VendorAccess access)
{
    public const string Sorts = "name, -name, category, -category, updated, -updated";

    private const int LookupLimit = 20;
    private const int MaxTechAi = 30;
    private const int MaxTechAiName = 200;

    public async Task<PagedResult<VendorResponse>> ListAsync(string? search, string? category, int? serviceId, int? areaId, string? sort, PageRequest page, CancellationToken ct)
    {
        var query = db.Set<Vendor>().AsNoTracking().AsQueryable();
        query = ApplySearch(query, Terms(search));
        if (category is not null)
            query = query.Where(v => v.CategoryCode == category);
        if (serviceId is { } sid)
            query = query.Where(v => db.Set<VendorServiceChoice>().Any(c => c.VendorId == v.Id && c.VendorServiceOptionId == sid));
        if (areaId is { } aid)
            query = query.Where(v => db.Set<VendorAreaChoice>().Any(c => c.VendorId == v.Id && c.VendorAreaOptionId == aid));

        var total = await query.CountAsync(ct);
        var ordered = sort switch
        {
            "-name" => query.OrderByDescending(v => v.Name),
            "category" => query.OrderBy(v => v.CategoryCode).ThenBy(v => v.Name),
            "-category" => query.OrderByDescending(v => v.CategoryCode).ThenBy(v => v.Name),
            "updated" => query.OrderBy(v => v.ModifiedAtUtc ?? v.CreatedAtUtc).ThenBy(v => v.Name),
            "-updated" => query.OrderByDescending(v => v.ModifiedAtUtc ?? v.CreatedAtUtc).ThenBy(v => v.Name),
            _ => query.OrderBy(v => v.Name),
        };

        var rows = await ordered.ThenBy(v => v.Id).Skip(page.Skip).Take(page.PageSize).ToListAsync(ct);
        return new PagedResult<VendorResponse>(await BuildAsync(rows, ct), total, page.Page, page.PageSize);
    }

    public async Task<Result<VendorResponse>> GetAsync(int vendorId, CancellationToken ct)
    {
        var vendor = await db.Set<Vendor>().AsNoTracking().SingleOrDefaultAsync(v => v.Id == vendorId, ct);
        return vendor is null ? NotFound() : (await BuildAsync([vendor], ct))[0];
    }

    /// <summary>Combobox source: vendors whose name, website or a service matches the typed text, best matches first (name starts with it), at most 20. Blacklisted vendors are included.</summary>
    public async Task<IReadOnlyList<VendorLookupItem>> LookupAsync(string? search, CancellationToken ct)
    {
        var terms = Terms(search);
        var query = ApplySearch(db.Set<Vendor>().AsNoTracking(), terms);
        var first = terms.FirstOrDefault() ?? string.Empty;
        var rows = await query
            .OrderBy(v => first.Length > 0 && v.Name.StartsWith(first) ? 0 : 1)
            .ThenBy(v => v.Name).ThenBy(v => v.Id)
            .Take(LookupLimit)
            .ToListAsync(ct);
        return await LookupItemsForAsync(rows, ct);
    }

    public async Task<Result<VendorResponse>> CreateAsync(CreateVendorRequest request, CancellationToken ct)
    {
        var fields = new FieldErrors();
        var vendor = new Vendor();
        ApplyFields(vendor, request.Name, request.Website, string.IsNullOrWhiteSpace(request.Category) ? VendorCategories.Neutral : request.Category, request.Note, fields);
        var techAi = CleanTechAi(request.TechAi, fields);
        var services = await ChosenAsync<VendorServiceOption>(request.ServiceIds, "serviceIds", [], fields, ct);
        var areas = await ChosenAsync<VendorAreaOption>(request.AreaIds, "areaIds", [], fields, ct);
        if (fields.ToError() is { } invalid)
            return invalid;
        if (await NameExistsAsync(vendor.Name, null, ct))
            return DuplicateName(vendor.Name);

        // Two saves in one transaction: the rows that belong to the vendor need its real id (they have no navigation to it).
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.Set<Vendor>().Add(vendor);
        var failure = await SaveAsync(vendor.Name, ct);
        if (failure is not null)
            return failure;

        foreach (var option in services)
            db.Set<VendorServiceChoice>().Add(new VendorServiceChoice { VendorId = vendor.Id, VendorServiceOptionId = option.Id });
        foreach (var option in areas)
            db.Set<VendorAreaChoice>().Add(new VendorAreaChoice { VendorId = vendor.Id, VendorAreaOptionId = option.Id });
        for (var i = 0; i < techAi.Count; i++)
            db.Set<VendorTechAi>().Add(new VendorTechAi { VendorId = vendor.Id, Name = techAi[i], SortOrder = i + 1 });

        AuditList(vendor, VendorAuditEvents.ServicesChanged, "Services", null, VendorSupport.Joined(services.Select(s => s.Name)));
        AuditList(vendor, VendorAuditEvents.AreasChanged, "Areas", null, VendorSupport.Joined(areas.Select(s => s.Name)));
        AuditList(vendor, VendorAuditEvents.TechAiChanged, "TechAi", null, VendorSupport.Joined(techAi));

        failure = await SaveAsync(vendor.Name, ct);
        if (failure is not null)
            return failure;

        await transaction.CommitAsync(ct);
        return await GetAsync(vendor.Id, ct);
    }

    public async Task<Result<VendorResponse>> UpdateAsync(int vendorId, UpdateVendorRequest request, CancellationToken ct)
    {
        var vendor = await db.Set<Vendor>().SingleOrDefaultAsync(v => v.Id == vendorId, ct);
        if (vendor is null)
            return NotFound();

        var version = VendorSupport.CheckRowVersion(vendor.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var fields = new FieldErrors();
        ApplyFields(vendor, request.Name, request.Website, request.Category, request.Note, fields);
        var techAi = CleanTechAi(request.TechAi, fields);

        var serviceChoices = await db.Set<VendorServiceChoice>().Where(c => c.VendorId == vendorId).ToListAsync(ct);
        var areaChoices = await db.Set<VendorAreaChoice>().Where(c => c.VendorId == vendorId).ToListAsync(ct);
        var techRows = await db.Set<VendorTechAi>().Where(t => t.VendorId == vendorId).OrderBy(t => t.SortOrder).ThenBy(t => t.Id).ToListAsync(ct);
        var oldServiceIds = serviceChoices.Select(c => c.VendorServiceOptionId).ToList();
        var oldAreaIds = areaChoices.Select(c => c.VendorAreaOptionId).ToList();
        var services = await ChosenAsync<VendorServiceOption>(request.ServiceIds, "serviceIds", oldServiceIds, fields, ct);
        var areas = await ChosenAsync<VendorAreaOption>(request.AreaIds, "areaIds", oldAreaIds, fields, ct);
        if (fields.ToError() is { } invalid)
            return invalid;
        if (await NameExistsAsync(vendor.Name, vendorId, ct))
            return DuplicateName(vendor.Name);

        var oldServiceNames = await NamesAsync<VendorServiceOption>(oldServiceIds, ct);
        var oldAreaNames = await NamesAsync<VendorAreaOption>(oldAreaIds, ct);
        var changed = false;

        var newServiceIds = services.Select(s => s.Id).ToHashSet();
        if (!newServiceIds.SetEquals(oldServiceIds))
        {
            db.Set<VendorServiceChoice>().RemoveRange(serviceChoices.Where(c => !newServiceIds.Contains(c.VendorServiceOptionId)));
            foreach (var id in newServiceIds.Except(oldServiceIds))
                db.Set<VendorServiceChoice>().Add(new VendorServiceChoice { VendorId = vendorId, VendorServiceOptionId = id });
            AuditList(vendor, VendorAuditEvents.ServicesChanged, "Services", VendorSupport.Joined(oldServiceNames), VendorSupport.Joined(services.Select(s => s.Name)));
            changed = true;
        }

        var newAreaIds = areas.Select(s => s.Id).ToHashSet();
        if (!newAreaIds.SetEquals(oldAreaIds))
        {
            db.Set<VendorAreaChoice>().RemoveRange(areaChoices.Where(c => !newAreaIds.Contains(c.VendorAreaOptionId)));
            foreach (var id in newAreaIds.Except(oldAreaIds))
                db.Set<VendorAreaChoice>().Add(new VendorAreaChoice { VendorId = vendorId, VendorAreaOptionId = id });
            AuditList(vendor, VendorAuditEvents.AreasChanged, "Areas", VendorSupport.Joined(oldAreaNames), VendorSupport.Joined(areas.Select(s => s.Name)));
            changed = true;
        }

        var oldTechAi = techRows.Select(t => t.Name).ToList();
        if (ReconcileTechAi(vendorId, techRows, techAi))
        {
            AuditList(vendor, VendorAuditEvents.TechAiChanged, "TechAi", VendorSupport.Joined(oldTechAi), VendorSupport.Joined(techAi));
            changed = true;
        }

        if (changed)
            db.Entry(vendor).Property(v => v.Name).IsModified = true; // moves the row version and the modified stamp when only the lists changed

        VendorSupport.TrackOriginalRowVersion(db, vendor, request.RowVersion);
        var failure = await SaveAsync(vendor.Name, ct);
        return failure is not null ? failure : await GetAsync(vendorId, ct);
    }

    /// <summary>
    /// Deletes a vendor that no matter is linked to; its contacts, services, areas and Tech AI go with it (the people stay in People). 409 <c>VENDOR_LINKED_TO_MATTERS</c> with the count
    /// otherwise (all links count, including those of matters the caller cannot see); set the category to Blacklisted to keep a used vendor out of use.
    /// </summary>
    public async Task<Result> DeleteAsync(int vendorId, CancellationToken ct)
    {
        var vendor = await db.Set<Vendor>().SingleOrDefaultAsync(v => v.Id == vendorId, ct);
        if (vendor is null)
            return NotFound();

        var linked = await db.Set<VendorMatter>().CountAsync(l => l.VendorId == vendorId, ct);
        if (linked > 0)
            return LinkedError(linked);

        db.Set<VendorContact>().RemoveRange(await db.Set<VendorContact>().Where(c => c.VendorId == vendorId).ToListAsync(ct));
        db.Set<Vendor>().Remove(vendor);
        try
        {
            await db.SaveChangesAsync(ct);
            return Result.Success();
        }
        catch (DbUpdateConcurrencyException)
        {
            return VendorSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (VendorSupport.IsForeignKeyViolation(ex))
        {
            audit.DiscardPending();
            return LinkedError(await db.Set<VendorMatter>().CountAsync(l => l.VendorId == vendorId, ct));
        }
    }

    private static Error LinkedError(int count) =>
        Error.Conflict(
            ErrorCodes.VendorLinkedToMatters,
            count == 1
                ? "This vendor is linked to 1 matter and cannot be deleted. Unlink it from the matter first, or set its category to Blacklisted."
                : $"This vendor is linked to {count} matters and cannot be deleted. Unlink it from the matters first, or set its category to Blacklisted.",
            new Dictionary<string, object?> { ["matterCount"] = count });

    private static Error NotFound() => VendorSupport.NotFound("Vendor");

    private static Error DuplicateName(string name) => VendorSupport.Duplicate("name", $"A vendor named '{name}' already exists.");

    private void AuditList(Vendor vendor, string eventType, string fieldKey, string? oldValue, string? newValue)
    {
        if (oldValue == newValue)
            return;

        audit.Write(VendorAudit.About(eventType, () => VendorSupport.Id(vendor.Id), fieldKey, oldValue, newValue));
    }

    private static List<string> Terms(string? search) =>
        (search ?? string.Empty).Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(5).ToList();

    private IQueryable<Vendor> ApplySearch(IQueryable<Vendor> query, List<string> terms)
    {
        foreach (var term in terms)
        {
            var t = term;
            query = query.Where(v => v.Name.Contains(t) || (v.Website != null && v.Website.Contains(t))
                || db.Set<VendorServiceChoice>().Any(c => c.VendorId == v.Id
                    && db.Set<VendorServiceOption>().Any(o => o.Id == c.VendorServiceOptionId && o.Name.Contains(t))));
        }

        return query;
    }

    private static void ApplyFields(Vendor vendor, string? name, string? website, string? category, string? note, FieldErrors fields)
    {
        var cleanName = VendorSupport.Clean(name);
        if (cleanName is null)
            fields.Add("name", "REQUIRED", "Enter the vendor name.");
        else if (cleanName.Length > 200)
            fields.Add("name", "TOO_LONG", "Use at most 200 characters.");
        else
            vendor.Name = cleanName;

        var cleanWebsite = VendorSupport.Clean(website);
        if (cleanWebsite is { Length: > 300 })
            fields.Add("website", "TOO_LONG", "Use at most 300 characters.");
        else if (cleanWebsite is not null && cleanWebsite.Any(c => char.IsWhiteSpace(c) || char.IsControl(c)))
            fields.Add("website", "INVALID", "A website address has no spaces.");
        else
            vendor.Website = cleanWebsite;

        if (!VendorCategories.IsValid(category))
            fields.Add("category", "INVALID", "Category must be PREFERRED, NEUTRAL or BLACKLISTED.");
        else
            vendor.CategoryCode = category!;

        var cleanNote = VendorSupport.Clean(note);
        if (cleanNote is { Length: > 2000 })
            fields.Add("note", "TOO_LONG", "Use at most 2000 characters.");
        else
            vendor.Note = cleanNote;
    }

    private static List<string> CleanTechAi(IReadOnlyList<string>? names, FieldErrors fields)
    {
        var result = new List<string>();
        foreach (var raw in names ?? [])
        {
            var name = VendorSupport.Clean(raw);
            if (name is null || result.Contains(name, StringComparer.OrdinalIgnoreCase))
                continue;
            if (name.Length > MaxTechAiName)
            {
                fields.Add("techAi", "TOO_LONG", $"Use at most {MaxTechAiName} characters for each entry.");
                continue;
            }

            result.Add(name);
        }

        if (result.Count > MaxTechAi)
            fields.Add("techAi", "TOO_MANY", $"At most {MaxTechAi} entries.");

        return result;
    }

    /// <summary>Loads the chosen list items: they must exist and be active (a deactivated item the vendor already has may stay).</summary>
    private async Task<List<T>> ChosenAsync<T>(IReadOnlyList<int>? ids, string field, IReadOnlyCollection<int> alreadyChosen, FieldErrors fields, CancellationToken ct)
        where T : VendorOption
    {
        var wanted = (ids ?? []).Distinct().ToList();
        if (wanted.Count == 0)
            return [];

        var found = await db.Set<T>().AsNoTracking().Where(o => wanted.Contains(o.Id)).OrderBy(o => o.SortOrder).ThenBy(o => o.Id).ToListAsync(ct);
        if (found.Count != wanted.Count)
            fields.Add(field, "INVALID", "One of the chosen items does not exist.");
        else if (found.Any(o => !o.IsActive && !alreadyChosen.Contains(o.Id)))
            fields.Add(field, "INACTIVE", "One of the chosen items is deactivated and cannot be added.");

        return found;
    }

    private async Task<List<string>> NamesAsync<T>(IReadOnlyCollection<int> ids, CancellationToken ct)
        where T : VendorOption =>
        ids.Count == 0 ? [] : await db.Set<T>().AsNoTracking().Where(o => ids.Contains(o.Id)).Select(o => o.Name).ToListAsync(ct);

    /// <summary>Makes the stored Tech AI rows equal the new list (same names keep their row). True when anything changed.</summary>
    private bool ReconcileTechAi(int vendorId, List<VendorTechAi> rows, List<string> names)
    {
        if (rows.Select(r => r.Name).SequenceEqual(names, StringComparer.Ordinal))
            return false;

        var unmatched = rows.ToList();
        for (var i = 0; i < names.Count; i++)
        {
            var existing = unmatched.FirstOrDefault(r => string.Equals(r.Name, names[i], StringComparison.OrdinalIgnoreCase));
            if (existing is null)
            {
                db.Set<VendorTechAi>().Add(new VendorTechAi { VendorId = vendorId, Name = names[i], SortOrder = i + 1 });
                continue;
            }

            unmatched.Remove(existing);
            existing.Name = names[i];
            existing.SortOrder = i + 1;
        }

        db.Set<VendorTechAi>().RemoveRange(unmatched);
        return true;
    }

    private Task<bool> NameExistsAsync(string name, int? exceptId, CancellationToken ct) =>
        db.Set<Vendor>().AnyAsync(v => v.Name == name && (exceptId == null || v.Id != exceptId), ct);

    private async Task<Error?> SaveAsync(string name, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            return VendorSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (VendorSupport.IsUniqueViolation(ex))
        {
            return DuplicateName(name);
        }
    }

    private async Task<IReadOnlyList<VendorResponse>> BuildAsync(IReadOnlyList<Vendor> vendors, CancellationToken ct)
    {
        if (vendors.Count == 0)
            return [];

        var ids = vendors.Select(v => v.Id).ToList();
        var services = await ServicesOfAsync(ids, ct);
        var areas = await (from c in db.Set<VendorAreaChoice>().AsNoTracking()
                           join o in db.Set<VendorAreaOption>().AsNoTracking() on c.VendorAreaOptionId equals o.Id
                           where ids.Contains(c.VendorId)
                           orderby o.SortOrder, o.Id
                           select new { c.VendorId, o.Id, o.Name, o.IsActive }).ToListAsync(ct);
        var techAi = await db.Set<VendorTechAi>().AsNoTracking().Where(t => ids.Contains(t.VendorId)).OrderBy(t => t.SortOrder).ThenBy(t => t.Id).ToListAsync(ct);
        var contacts = await db.Set<VendorContact>().AsNoTracking().Where(c => ids.Contains(c.VendorId))
            .GroupBy(c => c.VendorId)
            .Select(g => new { VendorId = g.Key, Total = g.Count(), DoNotHire = g.Count(c => c.FlagCode == ContactFlags.DoNotHire) })
            .ToDictionaryAsync(x => x.VendorId, ct);
        var matterCounts = await access.VisibleLinks().Where(l => ids.Contains(l.VendorId))
            .GroupBy(l => l.VendorId)
            .Select(g => new { VendorId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.VendorId, x => x.Count, ct);

        return vendors.Select(v => new VendorResponse(
            v.Id,
            v.Name,
            v.Website,
            v.CategoryCode,
            v.Note,
            [.. services.Where(s => s.VendorId == v.Id).Select(s => new VendorOptionRef(s.Id, s.Name, s.IsActive))],
            [.. areas.Where(s => s.VendorId == v.Id).Select(s => new VendorOptionRef(s.Id, s.Name, s.IsActive))],
            [.. techAi.Where(t => t.VendorId == v.Id).Select(t => t.Name)],
            contacts.TryGetValue(v.Id, out var c) ? c.Total : 0,
            c?.DoNotHire ?? 0,
            matterCounts.GetValueOrDefault(v.Id),
            VendorSupport.Utc(v.ModifiedAtUtc ?? v.CreatedAtUtc),
            VendorSupport.Encode(v.RowVersion))).ToList();
    }

    internal async Task<IReadOnlyList<VendorLookupItem>> LookupItemsForAsync(IReadOnlyList<Vendor> vendors, CancellationToken ct)
    {
        if (vendors.Count == 0)
            return [];

        var ids = vendors.Select(v => v.Id).ToList();
        var services = await ServicesOfAsync(ids, ct);
        var doNotHire = await db.Set<VendorContact>().AsNoTracking()
            .Where(c => ids.Contains(c.VendorId) && c.FlagCode == ContactFlags.DoNotHire)
            .Select(c => c.VendorId).Distinct().ToListAsync(ct);
        return vendors.Select(v => new VendorLookupItem(
            v.Id, v.Name, v.Website, v.CategoryCode,
            [.. services.Where(s => s.VendorId == v.Id).Select(s => s.Name)],
            doNotHire.Contains(v.Id))).ToList();
    }

    /// <summary>The services of the given vendors in list order (one statement).</summary>
    internal async Task<List<ServiceRow>> ServicesOfAsync(IReadOnlyCollection<int> vendorIds, CancellationToken ct) =>
        await (from c in db.Set<VendorServiceChoice>().AsNoTracking()
               join o in db.Set<VendorServiceOption>().AsNoTracking() on c.VendorServiceOptionId equals o.Id
               where vendorIds.Contains(c.VendorId)
               orderby o.SortOrder, o.Id
               select new ServiceRow(c.VendorId, o.Id, o.Name, o.IsActive)).ToListAsync(ct);

    internal sealed record ServiceRow(int VendorId, int Id, string Name, bool IsActive);
}

/// <summary>Collects field errors of one request (field, stable code, message).</summary>
internal sealed class FieldErrors
{
    private readonly Dictionary<string, List<FieldError>> _errors = [];

    public void Add(string field, string code, string message)
    {
        if (!_errors.TryGetValue(field, out var list))
            _errors[field] = list = [];
        list.Add(new FieldError(code, message));
    }

    public Error? ToError() =>
        _errors.Count == 0
            ? null
            : Error.Validation("The request is not valid.", _errors.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<FieldError>)kv.Value));
}
