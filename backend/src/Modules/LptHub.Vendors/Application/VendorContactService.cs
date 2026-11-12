using LptHub.Identity.Contracts;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Results;
using LptHub.SharedKernel.Time;
using LptHub.Vendors.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Vendors.Application;

/// <summary>
/// The people at a vendor (epic #1373, issue #1377): a person of the People list with one current flag (No note, Recommended, Do Not Hire), the date it was reported, who reported it and a note.
/// Every field change is audited by the Data layer (object type <c>VendorContact</c>), in the same transaction, so an earlier flag and note stay in the history.
/// Free text is never a contact: the person must be an active record of People.
/// </summary>
public sealed class VendorContactService(DbContext db, IPersonDirectory people, VendorAccess access, ICurrentUser currentUser, IClock clock)
{
    public async Task<Result<IReadOnlyList<VendorContactResponse>>> ListAsync(int vendorId, CancellationToken ct)
    {
        if (!await VendorExistsAsync(vendorId, ct))
            return VendorSupport.NotFound("Vendor");

        var rows = await db.Set<VendorContact>().AsNoTracking().Where(c => c.VendorId == vendorId).ToListAsync(ct);
        return Result<IReadOnlyList<VendorContactResponse>>.Success(await ToResponsesAsync(rows, ct));
    }

    public async Task<Result<VendorContactResponse>> CreateAsync(int vendorId, CreateVendorContactRequest request, CancellationToken ct)
    {
        if (!await VendorExistsAsync(vendorId, ct))
            return VendorSupport.NotFound("Vendor");

        var person = (await people.FindManyAsync([request.PersonId], ct)).GetValueOrDefault(request.PersonId);
        if (person is null)
            return Error.Validation("personId", "INVALID", "Choose a person from the People list.");
        if (!person.IsActive)
            return Error.Validation("personId", "INACTIVE", "This person is deactivated in People and cannot be added.");
        if (await db.Set<VendorContact>().AnyAsync(c => c.VendorId == vendorId && c.PersonId == request.PersonId, ct))
            return DuplicateContact(person.DisplayName);

        var contact = new VendorContact { VendorId = vendorId, PersonId = request.PersonId };
        var invalid = ApplyFlag(contact, request.Flag ?? ContactFlags.None, request.ReportedOn, request.Note, flagChanged: true);
        if (invalid is not null)
            return invalid;

        db.Set<VendorContact>().Add(contact);
        var failure = await SaveAsync(person.DisplayName, ct);
        return failure is not null ? failure : await GetAsync(vendorId, contact.Id, ct);
    }

    public async Task<Result<VendorContactResponse>> UpdateAsync(int vendorId, int contactId, UpdateVendorContactRequest request, CancellationToken ct)
    {
        var contact = await db.Set<VendorContact>().SingleOrDefaultAsync(c => c.Id == contactId && c.VendorId == vendorId, ct);
        if (contact is null)
            return VendorSupport.NotFound("Contact");

        var version = VendorSupport.CheckRowVersion(contact.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var invalid = ApplyFlag(contact, request.Flag, request.ReportedOn, request.Note, flagChanged: request.Flag != contact.FlagCode);
        if (invalid is not null)
            return invalid;

        VendorSupport.TrackOriginalRowVersion(db, contact, request.RowVersion);
        var failure = await SaveAsync(string.Empty, ct);
        return failure is not null ? failure : await GetAsync(vendorId, contactId, ct);
    }

    /// <summary>Removes the person from the vendor's contacts (the person stays in People). The removal is audited field by field with the old values.</summary>
    public async Task<Result> DeleteAsync(int vendorId, int contactId, CancellationToken ct)
    {
        var contact = await db.Set<VendorContact>().SingleOrDefaultAsync(c => c.Id == contactId && c.VendorId == vendorId, ct);
        if (contact is null)
            return VendorSupport.NotFound("Contact");

        db.Set<VendorContact>().Remove(contact);
        try
        {
            await db.SaveChangesAsync(ct);
            return Result.Success();
        }
        catch (DbUpdateConcurrencyException)
        {
            return VendorSupport.ConcurrencyError();
        }
    }

    private async Task<Result<VendorContactResponse>> GetAsync(int vendorId, int contactId, CancellationToken ct)
    {
        var row = await db.Set<VendorContact>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == contactId && c.VendorId == vendorId, ct);
        return row is null ? VendorSupport.NotFound("Contact") : (await ToResponsesAsync([row], ct))[0];
    }

    /// <summary>
    /// Sets flag, date, reporter and note. A flag needs a date that is not in the future; the caller becomes the reporter when the flag is new or changed (a later edit of date or note keeps the reporter).
    /// The flag NONE clears date, reporter and note.
    /// </summary>
    private Error? ApplyFlag(VendorContact contact, string flag, DateOnly? reportedOn, string? note, bool flagChanged)
    {
        if (!ContactFlags.IsValid(flag))
            return Error.Validation("flag", "INVALID", "Flag must be NONE, RECOMMENDED or DO_NOT_HIRE.");

        var cleanNote = VendorSupport.Clean(note);
        if (cleanNote is { Length: > 2000 })
            return Error.Validation("note", "TOO_LONG", "Use at most 2000 characters.");

        if (flag == ContactFlags.None)
        {
            contact.FlagCode = flag;
            contact.ReportedOn = null;
            contact.ReportedByUserId = null;
            contact.Note = null;
            return null;
        }

        if (reportedOn is null)
            return Error.Validation("reportedOn", "REQUIRED", "Enter the date this was reported.");
        if (reportedOn.Value > DateOnly.FromDateTime(clock.UtcNow).AddDays(1))
            return Error.Validation("reportedOn", "FUTURE", "The date cannot be in the future.");

        contact.FlagCode = flag;
        contact.ReportedOn = reportedOn;
        contact.Note = cleanNote;
        if (flagChanged || contact.ReportedByUserId is null)
            contact.ReportedByUserId = currentUser.UserId;
        return null;
    }

    private static Error DuplicateContact(string name) =>
        new(
            ErrorType.Conflict,
            ErrorCodes.DuplicateLink,
            $"{name} is already a contact of this vendor.",
            new Dictionary<string, IReadOnlyList<FieldError>> { ["personId"] = [new FieldError(ErrorCodes.DuplicateLink, $"{name} is already a contact of this vendor.")] });

    private Task<bool> VendorExistsAsync(int vendorId, CancellationToken ct) => db.Set<Vendor>().AnyAsync(v => v.Id == vendorId, ct);

    private async Task<Error?> SaveAsync(string personName, CancellationToken ct)
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
            return DuplicateContact(personName.Length > 0 ? personName : "This person");
        }
    }

    private async Task<IReadOnlyList<VendorContactResponse>> ToResponsesAsync(IReadOnlyList<VendorContact> rows, CancellationToken ct)
    {
        var persons = await people.FindManyAsync([.. rows.Select(r => r.PersonId).Distinct()], ct);
        var reporters = await access.NamesAsync(rows.Select(r => r.ReportedByUserId), ct);
        return rows
            .Select(r => (Row: r, Person: persons.GetValueOrDefault(r.PersonId)))
            .OrderBy(x => x.Person?.DisplayName ?? string.Empty, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.Row.Id)
            .Select(x => new VendorContactResponse(
                x.Row.Id,
                x.Row.VendorId,
                x.Row.PersonId,
                x.Person?.DisplayName ?? string.Empty,
                x.Person?.PersonType ?? string.Empty,
                x.Person?.Title,
                x.Person?.Email,
                x.Person?.CompanyName,
                x.Person?.IsActive ?? false,
                x.Row.FlagCode,
                x.Row.ReportedOn,
                x.Row.ReportedByUserId,
                x.Row.ReportedByUserId is { } by ? reporters.GetValueOrDefault(by) : null,
                x.Row.Note,
                VendorSupport.Encode(x.Row.RowVersion)))
            .ToList();
    }
}
