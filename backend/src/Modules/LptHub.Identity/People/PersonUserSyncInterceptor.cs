using LptHub.Identity.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace LptHub.Identity.People;

/// <summary>
/// Keeps the linked person of every user in step (epic #1373): a new user gets its person in the same save (so in the same transaction and with the
/// same audit trail), and a changed display name or e-mail is copied to the person. A person is never removed or deactivated with its user. It runs in the
/// DbContext, not in one service, because users are created in several places (first sign-in, the administrator, the Dev seed, tests). A user whose person
/// is missing (a row written outside the application) gets one the next time the user is saved.
/// Register it before the audit interceptors so the person it adds is stamped and audited like any other save.
/// </summary>
public sealed class PersonUserSyncInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is { } context)
            Sync(context, null).GetAwaiter().GetResult();

        return base.SavingChanges(eventData, result);
    }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context)
            await Sync(context, cancellationToken);

        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private static async Task Sync(DbContext context, CancellationToken? ct)
    {
        context.ChangeTracker.DetectChanges();
        var users = context.ChangeTracker.Entries<AppUser>()
            .Where(e => e.State == EntityState.Added || (e.State == EntityState.Modified && (e.Property(u => u.DisplayName).IsModified || e.Property(u => u.Email).IsModified)))
            .ToList();
        foreach (var entry in users)
        {
            var user = entry.Entity;
            var (first, last) = PersonNameSplitter.Split(user.DisplayName);
            if (first.Length == 0)
                continue; // a user without a name cannot have a person (FirstName is required); it gets one when it is named

            var email = string.IsNullOrWhiteSpace(user.Email) ? null : user.Email.Trim();
            Person? person = null;
            if (entry.State == EntityState.Modified)
            {
                person = context.ChangeTracker.Entries<Person>().Select(e => e.Entity).FirstOrDefault(p => p.UserId == user.Id);
                if (person is null)
                {
                    var query = context.Set<Person>().Where(p => p.UserId == user.Id);
                    person = ct is { } token ? await query.FirstOrDefaultAsync(token) : query.FirstOrDefault();
                }
            }

            if (person is null)
            {
                context.Set<Person>().Add(new Person { FirstName = first, LastName = last, Email = email, PersonType = PersonTypes.Internal, User = user, IsActive = true });
                continue;
            }

            if (person.FirstName != first)
                person.FirstName = first;
            if (person.LastName != last)
                person.LastName = last;
            if (person.Email != email)
                person.Email = email;
        }
    }
}
