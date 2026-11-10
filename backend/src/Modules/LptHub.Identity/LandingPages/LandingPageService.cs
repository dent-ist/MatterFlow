using System.Text.Json;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.LandingPages;

/// <summary>
/// Landing pages (epic #1330): a role's default page, the signed-in person's own choice and the page the fallback chain picks. Permissions are always
/// evaluated here from the server's own data (never from the client); a person only ever reads and writes their own choice.
/// The person's choice is the remembered state of the surface <see cref="Surface"/> in <c>dbo.UserView</c> (<c>{"page":"dashboard"}</c>): a personal preference
/// that must not bump the row version of the user record an administrator edits, nor be audited per click. The role default is a column of the role and is
/// audited by the Role entity's field-level audit.
/// </summary>
public sealed class LandingPageService(DbContext db, ICurrentUser currentUser, IPermissionChecker caller, IClock clock)
{
    /// <summary>The <c>UserView</c> surface holding the choice. Not in <c>UserViewService.Surfaces</c>, so the generic views API can neither write nor list it.</summary>
    public const string Surface = "landing-page";

    private static LandingPageCatalog Catalog => LandingPageCatalog.Default;

    private int UserId => currentUser.UserId ?? throw new InvalidOperationException("No signed-in user.");

    public LandingPageListResponse ListMine() => new([.. Catalog.OpenableBy(caller.Has).Select(ToDto)]);

    public async Task<MyLandingPageDto> GetMineAsync(CancellationToken ct) => await BuildAsync(await ReadChoiceAsync(ct), ct);

    public async Task<Result<MyLandingPageDto>> SetMineAsync(SetMyLandingPageRequest request, CancellationToken ct)
    {
        var key = Normalize(request.LandingPage);
        if (key is not null && Catalog.Find(key) is null)
            return UnknownPage();

        // A known page is stored even when the person cannot open it now: it is kept in case access returns; the chain skips it.
        var userId = UserId;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var row = await db.Set<UserView>().FirstOrDefaultAsync(v => v.UserId == userId && v.Surface == Surface && v.Name == null, ct);
            if (key is null)
            {
                if (row is not null)
                {
                    db.Set<UserView>().Remove(row);
                    await db.SaveChangesAsync(ct);
                }

                break;
            }

            var created = row is null;
            var now = clock.UtcNow;
            if (row is null)
            {
                row = new UserView { UserId = userId, Surface = Surface, CreatedAtUtc = now };
                db.Set<UserView>().Add(row);
            }

            row.StateJson = JsonSerializer.Serialize(new { page = key });
            row.ModifiedAtUtc = now;
            try
            {
                await db.SaveChangesAsync(ct);
                break;
            }
            catch (DbUpdateException ex) when (created && ex.InnerException is SqlException { Number: 2627 or 2601 })
            {
                db.Entry(row).State = EntityState.Detached; // two tabs saved together: update the winner's row
            }
        }

        return await BuildAsync(key, ct);
    }

    public async Task<Result<RoleLandingPageDto>> GetRoleAsync(int roleId, CancellationToken ct)
    {
        var role = await db.Set<Role>().AsNoTracking().FirstOrDefaultAsync(r => r.Id == roleId, ct);
        return role is null ? NotFoundRole() : await ToRoleDtoAsync(role, ct);
    }

    public async Task<Result<RoleLandingPageDto>> SetRoleAsync(int roleId, SetRoleLandingPageRequest request, CancellationToken ct)
    {
        var role = await db.Set<Role>().FirstOrDefaultAsync(r => r.Id == roleId, ct);
        if (role is null)
            return NotFoundRole();
        if (role.IsSystemAdmin)
            return Error.Conflict(ErrorCodes.ImmutableField, "The System Admin role is built in and cannot be edited or deleted.");
        if (request.RowVersion != Convert.ToBase64String(role.RowVersion))
            return Error.Conflict(ErrorCodes.ConcurrencyConflict, "The role was changed by someone else. Reload and try again.");

        var key = Normalize(request.LandingPage);
        if (key is not null)
        {
            var page = Catalog.Find(key);
            if (page is null)
                return UnknownPage();
            var codes = await RolePermissionsAsync(role, ct);
            if (!Catalog.CanOpen(page, codes.Contains))
            {
                return Error.Validation(
                    "landingPage",
                    "PAGE_NOT_OPENABLE",
                    $"This role can't open {page.Label}. Choose another landing page.");
            }
        }

        if (!string.Equals(role.LandingPage, key, StringComparison.Ordinal))
        {
            role.LandingPage = key; // the field change is audited by [Audited] Role (FIELD_CHANGED, FieldKey LandingPage)
            role.ModifiedAtUtc = clock.UtcNow;
            await db.SaveChangesAsync(ct);
        }

        return await ToRoleDtoAsync(role, ct);
    }

    private async Task<MyLandingPageDto> BuildAsync(string? choice, CancellationToken ct)
    {
        var userId = UserId;
        var roles = await db.Set<UserRole>().AsNoTracking()
            .Where(ur => ur.UserId == userId && ur.Role.IsActive)
            .Select(ur => new RoleLanding(ur.Role.Name, ur.Role.LandingPage))
            .ToListAsync(ct);
        var first = LandingPageResolver.FirstRole(roles);

        var choicePage = Catalog.Find(choice);
        var defaultPage = Catalog.Find(first?.LandingPage);
        var resolution = LandingPageResolver.Resolve(Catalog, choice, first?.LandingPage, caller.Has);
        return new MyLandingPageDto(
            choicePage?.Key,
            choicePage is null || Catalog.CanOpen(choicePage, caller.Has),
            first?.Name,
            defaultPage?.Key,
            defaultPage is null || Catalog.CanOpen(defaultPage, caller.Has),
            resolution.Page?.Key,
            resolution.Page?.Path,
            resolution.Source);
    }

    /// <summary>The stored choice; a row that is not the expected JSON, or names no page of the catalogue, counts as "not set".</summary>
    private async Task<string?> ReadChoiceAsync(CancellationToken ct)
    {
        var userId = UserId;
        var json = await db.Set<UserView>().AsNoTracking()
            .Where(v => v.UserId == userId && v.Surface == Surface && v.Name == null)
            .Select(v => v.StateJson)
            .FirstOrDefaultAsync(ct);
        return json is null ? null : ParseChoice(json);
    }

    public static string? ParseChoice(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("page", out var page)
                && page.ValueKind == JsonValueKind.String
                    ? page.GetString()
                    : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task<HashSet<string>> RolePermissionsAsync(Role role, CancellationToken ct) =>
        role.IsSystemAdmin
            ? await db.Set<Permission>().Where(p => p.IsActive).Select(p => p.Code).ToHashSetAsync(ct)
            : await db.Set<RolePermission>().Where(rp => rp.RoleId == role.Id && rp.Permission.IsActive).Select(rp => rp.Permission.Code).ToHashSetAsync(ct);

    private async Task<Result<RoleLandingPageDto>> ToRoleDtoAsync(Role role, CancellationToken ct)
    {
        var codes = await RolePermissionsAsync(role, ct);
        return new RoleLandingPageDto(
            role.Id,
            Catalog.Find(role.LandingPage)?.Key,
            [.. Catalog.OpenableBy(codes.Contains).Select(ToDto)],
            Convert.ToBase64String(role.RowVersion));
    }

    private static string? Normalize(string? key) => string.IsNullOrWhiteSpace(key) ? null : key.Trim();

    private static LandingPageDto ToDto(LandingPageDefinition p) => new(p.Key, p.Label, p.Path);

    private static Error UnknownPage() => Error.Validation("landingPage", "UNKNOWN_PAGE", "The landing page is not known.");

    private static Error NotFoundRole() => Error.NotFound("The role does not exist.");
}
