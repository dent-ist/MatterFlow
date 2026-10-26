using System.Text;
using System.Text.Json;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Time;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Views;

/// <summary>
/// The signed-in person's remembered screen state and named views (PM v2, #856). A person only ever reads and writes their own rows: every
/// query is keyed by the caller's user id and an id that belongs to someone else answers 404, exactly like an id that does not exist.
/// Personal preferences: not audited, no business data, no matter data (so no matter-visibility rule applies).
/// </summary>
public sealed class UserViewService(DbContext db, ICurrentUser currentUser, IClock clock)
{
    /// <summary>State size limit in UTF-8 bytes (the column holds 4000 characters).</summary>
    public const int MaxStateBytes = 4096;

    public const int MaxStateChars = 4000;

    /// <summary>Named views one person may keep over all surfaces.</summary>
    public const int MaxNamedViews = 30;

    public const int MaxNameLength = 80;

    /// <summary>The screen sections that remember state. An unknown surface is a 400.</summary>
    public static readonly IReadOnlyList<string> Surfaces =
    [
        "my-matters.attention",
        "my-matters.deadlines",
        "my-matters.since-last-visit",
        "my-matters.activity",
        "my-matters.breakdown",
        "my-matters.data",
        "my-matters.focus",
        "task-queue",
        "assets",
    ];

    private int UserId => currentUser.UserId ?? throw new InvalidOperationException("No signed-in user.");

    public async Task<Result<UserViewListResponse>> ListAsync(string? surface, CancellationToken ct)
    {
        if (surface is not null && !Surfaces.Contains(surface))
            return UnknownSurface();
        var userId = UserId;
        var query = db.Set<UserView>().AsNoTracking().Where(v => v.UserId == userId);
        if (surface is not null)
            query = query.Where(v => v.Surface == surface);
        var rows = await query.OrderBy(v => v.Surface).ThenBy(v => v.Name != null).ThenBy(v => v.Name).ToListAsync(ct);
        return new UserViewListResponse([.. rows.Select(ToDto)]);
    }

    public async Task<Result<UserViewDto>> SaveRememberedAsync(string surface, SaveRememberedViewRequest request, CancellationToken ct)
    {
        if (!Surfaces.Contains(surface))
            return UnknownSurface();
        var state = CheckState(request.State, "state");
        if (state.IsFailure)
            return state.Error!;

        var userId = UserId;
        var now = clock.UtcNow;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var row = await db.Set<UserView>().FirstOrDefaultAsync(v => v.UserId == userId && v.Surface == surface && v.Name == null, ct);
            var created = row is null;
            if (row is null)
            {
                row = new UserView { UserId = userId, Surface = surface, CreatedAtUtc = now };
                db.Set<UserView>().Add(row);
            }

            row.StateJson = state.Value!;
            row.ModifiedAtUtc = now;
            try
            {
                await db.SaveChangesAsync(ct);
                return ToDto(row);
            }
            catch (DbUpdateException ex) when (created && IsUniqueViolation(ex))
            {
                db.Entry(row).State = EntityState.Detached; // two tabs saved the first state together: update the winner's row
            }
        }

        return Error.Conflict(ErrorCodes.ConcurrencyConflict, "The saved state was changed at the same moment. Try again.");
    }

    public async Task<Result<UserViewDto>> CreateAsync(CreateUserViewRequest request, CancellationToken ct)
    {
        if (!Surfaces.Contains(request.Surface))
            return UnknownSurface();
        var name = CheckName(request.Name);
        if (name.IsFailure)
            return name.Error!;
        var state = CheckState(request.State, "state");
        if (state.IsFailure)
            return state.Error!;

        var userId = UserId;
        if (await db.Set<UserView>().CountAsync(v => v.UserId == userId && v.Name != null, ct) >= MaxNamedViews)
            return Error.Validation("name", "LIMIT_REACHED", $"You can keep at most {MaxNamedViews} saved views. Delete one first.");
        if (await NameTakenAsync(userId, request.Surface, name.Value!, null, ct))
            return Duplicate(name.Value!);

        var now = clock.UtcNow;
        if (request.IsDefault)
            await ClearDefaultAsync(userId, request.Surface, null, ct);
        var row = new UserView
        {
            UserId = userId,
            Surface = request.Surface,
            Name = name.Value,
            IsDefault = request.IsDefault,
            StateJson = state.Value!,
            CreatedAtUtc = now,
            ModifiedAtUtc = now,
        };
        db.Set<UserView>().Add(row);
        var failure = await SaveAsync(name.Value!, ct);
        return failure is not null ? failure : ToDto(row);
    }

    public async Task<Result<UserViewDto>> UpdateAsync(long id, UpdateUserViewRequest request, CancellationToken ct)
    {
        var version = ParseRowVersion(request.RowVersion);
        if (version is null)
            return Error.Validation("rowVersion", "INVALID", "The row version is not valid.");
        var userId = UserId;
        var row = await db.Set<UserView>().FirstOrDefaultAsync(v => v.Id == id && v.UserId == userId && v.Name != null, ct);
        if (row is null)
            return Error.NotFound("The saved view does not exist.");
        if (!row.RowVersion.AsSpan().SequenceEqual(version))
            return Conflict();

        if (request.Name is not null)
        {
            var name = CheckName(request.Name);
            if (name.IsFailure)
                return name.Error!;
            if (await NameTakenAsync(userId, row.Surface, name.Value!, row.Id, ct))
                return Duplicate(name.Value!);
            row.Name = name.Value;
        }

        if (request.State is { } newState)
        {
            var state = CheckState(newState, "state");
            if (state.IsFailure)
                return state.Error!;
            row.StateJson = state.Value!;
        }

        if (request.IsDefault is { } isDefault && isDefault != row.IsDefault)
        {
            if (isDefault)
                await ClearDefaultAsync(userId, row.Surface, row.Id, ct);
            row.IsDefault = isDefault;
        }

        row.ModifiedAtUtc = clock.UtcNow;
        db.Entry(row).Property(v => v.RowVersion).OriginalValue = version;
        var failure = await SaveAsync(row.Name ?? string.Empty, ct);
        return failure is not null ? failure : ToDto(row);
    }

    public async Task<Result> DeleteAsync(long id, CancellationToken ct)
    {
        var userId = UserId;
        var row = await db.Set<UserView>().FirstOrDefaultAsync(v => v.Id == id && v.UserId == userId && v.Name != null, ct);
        if (row is null)
            return Error.NotFound("The saved view does not exist.");
        db.Set<UserView>().Remove(row);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    private async Task<Error?> SaveAsync(string name, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return null;
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict();
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            return Duplicate(name);
        }
    }

    private async Task ClearDefaultAsync(int userId, string surface, long? exceptId, CancellationToken ct)
    {
        // Tracked rows, so the unique index on the default never sees two defaults in one save.
        var others = await db.Set<UserView>().Where(v => v.UserId == userId && v.Surface == surface && v.IsDefault && v.Id != exceptId).ToListAsync(ct);
        foreach (var other in others)
            other.IsDefault = false;
        if (others.Count > 0)
            await db.SaveChangesAsync(ct);
    }

    private Task<bool> NameTakenAsync(int userId, string surface, string name, long? exceptId, CancellationToken ct) =>
        db.Set<UserView>().AnyAsync(v => v.UserId == userId && v.Surface == surface && v.Name == name && v.Id != exceptId, ct);

    private static Result<string> CheckName(string? value)
    {
        var name = value?.Trim();
        if (string.IsNullOrEmpty(name))
            return Error.Validation("name", "REQUIRED", "Enter a name for the view.");
        return name.Length > MaxNameLength
            ? Error.Validation("name", "TOO_LONG", $"Use at most {MaxNameLength} characters.")
            : Result<string>.Success(name);
    }

    /// <summary>The state must be a JSON object, at most 4 KB; it is stored as written (compact).</summary>
    private static Result<string> CheckState(JsonElement state, string field)
    {
        if (state.ValueKind != JsonValueKind.Object)
            return Error.Validation(field, "STATE_INVALID", "The state must be a JSON object.");
        var text = state.GetRawText();
        if (Encoding.UTF8.GetByteCount(text) > MaxStateBytes || text.Length > MaxStateChars)
            return Error.Validation(field, "STATE_TOO_LARGE", $"The state may be at most {MaxStateBytes / 1024} KB.");
        return text;
    }

    private static byte[]? ParseRowVersion(string? value)
    {
        try
        {
            return string.IsNullOrEmpty(value) ? null : Convert.FromBase64String(value);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static bool IsUniqueViolation(DbUpdateException ex) => ex.InnerException is SqlException { Number: 2627 or 2601 };

    private static Error UnknownSurface() => Error.Validation("surface", "UNKNOWN_SURFACE", "The screen section is not known.");

    private static Error Duplicate(string name) => Error.Conflict(ErrorCodes.DuplicateName, $"You already have a view named '{name}' here.");

    private static Error Conflict() => Error.Conflict(ErrorCodes.ConcurrencyConflict, "The view was changed elsewhere. Reload and try again.");

    private static UserViewDto ToDto(UserView v) =>
        new(v.Id, v.Surface, v.Name, v.IsDefault, JsonDocument.Parse(v.StateJson).RootElement.Clone(), v.ModifiedAtUtc, Convert.ToBase64String(v.RowVersion));
}
