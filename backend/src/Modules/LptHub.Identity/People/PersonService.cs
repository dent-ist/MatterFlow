using System.Text.RegularExpressions;
using LptHub.Identity.Domain;
using LptHub.SharedKernel.Paging;
using LptHub.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Identity.People;

/// <summary>
/// The People list (epic #1373): search, create, edit and deactivate. Changes are audited field by field by the Data layer (<c>[Audited]</c> on
/// <see cref="Person"/>), in the same transaction. The person of a user is created and kept in step by <c>PersonUserSyncInterceptor</c>; this service
/// only refuses to change what follows the user.
/// </summary>
public sealed partial class PersonService(DbContext db)
{
    public const string Sorts = "name, -name, type, -type, title, -title, company, -company";

    private const int LookupLimit = 20;
    private const int SimilarLimit = 5;
    private const int MaxName = 100;
    private const int MaxEmail = 254;

    public async Task<PagedResult<PersonDto>> ListAsync(string? search, string? type, bool? active, string? sort, PageRequest page, CancellationToken ct)
    {
        var query = db.Set<Person>().AsNoTracking().AsQueryable();
        foreach (var term in Terms(search))
        {
            query = query.Where(p => p.FirstName.Contains(term) || p.LastName.Contains(term) || (p.FirstName + " " + p.LastName).Contains(term)
                || (p.Email != null && p.Email.Contains(term)) || (p.CompanyName != null && p.CompanyName.Contains(term)) || (p.Title != null && p.Title.Contains(term)));
        }

        if (type is not null)
            query = query.Where(p => p.PersonType == type);

        if (active is { } isActive)
            query = query.Where(p => p.IsActive == isActive);

        var total = await query.CountAsync(ct);
        var ordered = sort switch
        {
            "-name" => query.OrderByDescending(p => p.LastName).ThenByDescending(p => p.FirstName),
            "type" => query.OrderBy(p => p.PersonType).ThenBy(p => p.LastName).ThenBy(p => p.FirstName),
            "-type" => query.OrderByDescending(p => p.PersonType).ThenBy(p => p.LastName).ThenBy(p => p.FirstName),
            "title" => query.OrderBy(p => p.Title).ThenBy(p => p.LastName).ThenBy(p => p.FirstName),
            "-title" => query.OrderByDescending(p => p.Title).ThenBy(p => p.LastName).ThenBy(p => p.FirstName),
            "company" => query.OrderBy(p => p.CompanyName).ThenBy(p => p.LastName).ThenBy(p => p.FirstName),
            "-company" => query.OrderByDescending(p => p.CompanyName).ThenBy(p => p.LastName).ThenBy(p => p.FirstName),
            _ => query.OrderBy(p => p.LastName).ThenBy(p => p.FirstName),
        };

        var rows = await ordered.ThenBy(p => p.Id)
            .Skip(page.Skip)
            .Take(page.PageSize)
            .Select(p => new PersonRow(p, p.User == null ? null : p.User.IsActive))
            .ToListAsync(ct);
        return new PagedResult<PersonDto>(rows.Select(ToDto).ToList(), total, page.Page, page.PageSize);
    }

    public async Task<Result<PersonDto>> GetAsync(int personId, CancellationToken ct)
    {
        var row = await ReadAsync(personId, ct);
        return row is null ? NotFound(personId) : ToDto(row);
    }

    /// <summary>Active people for a picker: best matches first (a name that starts with the typed text), at most 20. People of a deactivated user are left out.</summary>
    public async Task<IReadOnlyList<PersonLookupItem>> LookupAsync(string? search, CancellationToken ct)
    {
        var query = db.Set<Person>().AsNoTracking().Where(p => p.IsActive && (p.User == null || p.User.IsActive));
        var terms = Terms(search);
        foreach (var term in terms)
        {
            query = query.Where(p => p.FirstName.Contains(term) || p.LastName.Contains(term) || (p.FirstName + " " + p.LastName).Contains(term)
                || (p.Email != null && p.Email.Contains(term)) || (p.CompanyName != null && p.CompanyName.Contains(term)));
        }

        var first = terms.FirstOrDefault() ?? string.Empty;
        var rows = await query
            .OrderBy(p => first.Length > 0 && (p.FirstName.StartsWith(first) || p.LastName.StartsWith(first)) ? 0 : 1)
            .ThenBy(p => p.LastName).ThenBy(p => p.FirstName).ThenBy(p => p.Id)
            .Take(LookupLimit)
            .ToListAsync(ct);
        return rows.Select(ToLookup).ToList();
    }

    /// <summary>People that resemble the one being typed (same e-mail, same name in either order, or a typo apart), best first, at most 5. Deactivated people are included and flagged.</summary>
    public async Task<IReadOnlyList<PersonSimilarItem>> SimilarAsync(string? firstName, string? lastName, string? email, int? exceptPersonId, CancellationToken ct)
    {
        // The address book of a firm is small; compare in memory (the matching rule is not expressible in SQL).
        var all = await db.Set<Person>().AsNoTracking()
            .Where(p => p.Id != exceptPersonId)
            .ToListAsync(ct);
        return all
            .Select(p => (Person: p, Reason: PersonSimilarity.Match(firstName, lastName, email, p.FirstName, p.LastName, p.Email)))
            .Where(x => x.Reason is not null)
            .OrderBy(x => x.Reason == PersonSimilarity.SameEmail ? 0 : x.Reason == PersonSimilarity.SameName ? 1 : 2)
            .ThenByDescending(x => x.Person.IsActive)
            .ThenBy(x => x.Person.LastName).ThenBy(x => x.Person.FirstName).ThenBy(x => x.Person.Id)
            .Take(SimilarLimit)
            .Select(x => new PersonSimilarItem(ToLookup(x.Person), x.Person.IsActive, x.Reason!))
            .ToList();
    }

    public async Task<Result<PersonDto>> CreateAsync(CreatePersonRequest request, CancellationToken ct)
    {
        var fields = new Fields();
        var person = new Person { IsActive = true };
        Apply(person, request.FirstName, request.LastName, request.PersonType, request.Title, request.Email, request.Comments, request.CompanyName, lastNameRequired: true, fields);
        if (fields.ToError() is { } invalid)
            return invalid;

        db.Set<Person>().Add(person);
        await db.SaveChangesAsync(ct);
        return await GetAsync(person.Id, ct);
    }

    public async Task<Result<PersonDto>> UpdateAsync(int personId, UpdatePersonRequest request, CancellationToken ct)
    {
        if (!TryDecodeRowVersion(request.RowVersion, out var version))
            return Error.Validation("rowVersion", "INVALID", "rowVersion is not valid. Reload the person and try again.");

        var person = await db.Set<Person>().SingleOrDefaultAsync(p => p.Id == personId, ct);
        if (person is null)
            return NotFound(personId);

        var isActive = request.IsActive!.Value;
        if (person.UserId is not null)
        {
            // Name, e-mail and type follow the user; the person of a user is never deactivated (the user is). Title and comments are the person's own.
            if (Differs(request.FirstName, person.FirstName) || Differs(request.LastName, person.LastName) || Differs(request.Email, person.Email)
                || request.PersonType != person.PersonType || Differs(request.CompanyName, person.CompanyName) || isActive != person.IsActive)
            {
                return Error.Conflict(ErrorCodes.SystemPersonReadOnly, "This person is a system user: the name and e-mail follow the user and the person cannot be deactivated here. Change the user instead.");
            }

            var own = new Fields();
            person.Title = Optional(request.Title, "title", MaxName, own);
            person.Comments = Optional(request.Comments, "comments", 2000, own);
            if (own.ToError() is { } invalidOwn)
                return invalidOwn;
        }
        else
        {
            var fields = new Fields();
            Apply(person, request.FirstName, request.LastName, request.PersonType, request.Title, request.Email, request.Comments, request.CompanyName, lastNameRequired: true, fields);
            if (fields.ToError() is { } invalid)
                return invalid;

            person.IsActive = isActive;
        }

        db.Entry(person).Property(p => p.RowVersion).OriginalValue = version;
        await db.SaveChangesAsync(ct);
        return await GetAsync(personId, ct);
    }

    private static bool Differs(string? requested, string? current) =>
        !string.Equals(requested?.Trim() ?? string.Empty, current ?? string.Empty, StringComparison.OrdinalIgnoreCase);

    private static void Apply(Person person, string? first, string? last, string? type, string? title, string? email, string? comments, string? company, bool lastNameRequired, Fields fields)
    {
        person.FirstName = Required(first, "firstName", "Enter a first name.", fields);
        person.LastName = lastNameRequired ? Required(last, "lastName", "Enter a last name.", fields) : last?.Trim() ?? string.Empty;
        if (person.FirstName.Length > MaxName)
            fields.Add("firstName", "MAX_LENGTH", $"A first name can have at most {MaxName} characters.");
        if (person.LastName.Length > MaxName)
            fields.Add("lastName", "MAX_LENGTH", $"A last name can have at most {MaxName} characters.");

        var trimmedType = type?.Trim();
        if (!PersonTypes.IsValid(trimmedType))
        {
            fields.Add("personType", "INVALID", "Choose Internal or External (INTERNAL or EXTERNAL).");
            trimmedType = PersonTypes.Internal;
        }

        person.PersonType = trimmedType!;
        person.Title = Optional(title, "title", MaxName, fields);
        person.Comments = Optional(comments, "comments", 2000, fields);
        person.CompanyName = Optional(company, "companyName", 200, fields);
        if (person.CompanyName is not null && person.PersonType != PersonTypes.External)
        {
            fields.Add("companyName", "NOT_EXTERNAL", "A company name is only for an external person.");
            person.CompanyName = null;
        }

        var cleanEmail = Optional(email, "email", MaxEmail, fields);
        if (cleanEmail is not null && !EmailPattern().IsMatch(cleanEmail))
            fields.Add("email", "INVALID", "Enter a valid e-mail address like name@example.com.", ErrorCodes.InvalidEmail);

        person.Email = cleanEmail;
    }

    private static string Required(string? value, string field, string message, Fields fields)
    {
        var text = value?.Trim() ?? string.Empty;
        if (text.Length == 0)
            fields.Add(field, "REQUIRED", message);

        return text;
    }

    private static string? Optional(string? value, string field, int max, Fields fields)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
            return null;

        if (text.Length > max)
        {
            fields.Add(field, "MAX_LENGTH", $"Use at most {max} characters.");
            return text[..max];
        }

        return text;
    }

    private static List<string> Terms(string? search) =>
        (search ?? string.Empty).Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(5).ToList();

    private async Task<PersonRow?> ReadAsync(int personId, CancellationToken ct) =>
        await db.Set<Person>().AsNoTracking()
            .Where(p => p.Id == personId)
            .Select(p => new PersonRow(p, p.User == null ? null : p.User.IsActive))
            .SingleOrDefaultAsync(ct);

    private static PersonDto ToDto(PersonRow row)
    {
        var p = row.Person;
        return new PersonDto(
            p.Id, p.FirstName, p.LastName, DisplayName(p), p.PersonType, p.Title, p.Email, p.Comments, p.CompanyName,
            p.UserId, p.UserId is not null, row.UserIsActive, p.IsActive, Convert.ToBase64String(p.RowVersion));
    }

    private static PersonLookupItem ToLookup(Person p) =>
        new(p.Id, DisplayName(p), p.PersonType, p.Title, p.Email, p.CompanyName, p.UserId, p.UserId is not null);

    internal static string DisplayName(Person p) => $"{p.FirstName} {p.LastName}".Trim();

    private static bool TryDecodeRowVersion(string? text, out byte[] bytes)
    {
        bytes = [];
        if (string.IsNullOrEmpty(text))
            return false;

        try
        {
            bytes = Convert.FromBase64String(text);
            return bytes.Length > 0;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static Error NotFound(int personId) => Error.NotFound($"Person {personId} was not found.");

    [GeneratedRegex(@"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 200)]
    private static partial Regex EmailPattern();

    private sealed record PersonRow(Person Person, bool? UserIsActive);

    private sealed class Fields
    {
        private readonly Dictionary<string, List<FieldError>> _errors = [];
        private string _code = ErrorCodes.ValidationFailed;

        public void Add(string field, string fieldCode, string message, string? code = null)
        {
            if (!_errors.TryGetValue(field, out var list))
                _errors[field] = list = [];

            list.Add(new FieldError(fieldCode, message));
            if (code is not null)
                _code = code;
        }

        public Error? ToError() =>
            _errors.Count == 0
                ? null
                : Error.Validation(
                    "Some fields are not valid.",
                    _errors.ToDictionary(e => e.Key, e => (IReadOnlyList<FieldError>)e.Value),
                    _errors.Count == 1 ? _code : ErrorCodes.ValidationFailed);
    }
}
