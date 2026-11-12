using LptHub.Identity.Contracts;
using LptHub.Identity.Domain;
using Microsoft.EntityFrameworkCore;

namespace LptHub.Identity.People;

/// <summary>The <see cref="IPersonDirectory"/> read side over the People list.</summary>
public sealed class PersonDirectory(DbContext db) : IPersonDirectory
{
    public async Task<IReadOnlyDictionary<int, PersonSummary>> FindManyAsync(IReadOnlyCollection<int> personIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(personIds);
        if (personIds.Count == 0)
            return new Dictionary<int, PersonSummary>();

        var ids = personIds.Distinct().ToList();
        var rows = await db.Set<Person>().AsNoTracking()
            .Where(p => ids.Contains(p.Id))
            .ToListAsync(cancellationToken);
        return rows.ToDictionary(p => p.Id, p => new PersonSummary(p.Id, PersonService.DisplayName(p), p.PersonType, p.Title, p.Email, p.CompanyName, p.UserId, p.IsActive));
    }
}
