using MatterFlow.Identity.Contracts;
using MatterFlow.Identity.Domain;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Identity.Pods;

/// <summary>
/// Pod administration. Changes are audited field by field by the Data layer (<c>[Audited]</c> on Pod and PodMember) in the same
/// transaction as the change. Membership never restricts Task assignment; this service only maintains the data.
/// </summary>
public sealed class PodService(DbContext db, IPermissionChecker permissions)
{
    private const int UniqueIndexViolation = 2601;
    private const int UniqueConstraintViolation = 2627;

    public async Task<PagedResult<PodSummary>> ListAsync(string? search, bool? active, string? sort, PageRequest page, CancellationToken ct)
    {
        var query = db.Set<Pod>().AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(p => p.Name.Contains(term) || (p.Description != null && p.Description.Contains(term)));
        }

        if (active is { } isActive)
            query = query.Where(p => p.IsActive == isActive);

        var total = await query.CountAsync(ct);
        var ordered = sort switch
        {
            "-name" => query.OrderByDescending(p => p.Name),
            "memberCount" => query.OrderBy(p => p.Members.Count).ThenBy(p => p.Name),
            "-memberCount" => query.OrderByDescending(p => p.Members.Count).ThenBy(p => p.Name),
            _ => query.OrderBy(p => p.Name),
        };

        var rows = await ordered
            .Skip(page.Skip)
            .Take(page.PageSize)
            .Select(p => new { Pod = p, MemberCount = p.Members.Count })
            .ToListAsync(ct);

        return new PagedResult<PodSummary>(rows.Select(r => ToSummary(r.Pod, r.MemberCount)).ToList(), total, page.Page, page.PageSize);
    }

    public async Task<Result<PodDetail>> GetAsync(int podId, CancellationToken ct)
    {
        var pod = await db.Set<Pod>().AsNoTracking().SingleOrDefaultAsync(p => p.Id == podId, ct);
        return pod is null ? NotFound(podId) : await ToDetailAsync(pod, ct);
    }

    public async Task<Result<PodDetail>> CreateAsync(string? name, string? description, CancellationToken ct)
    {
        var validated = ValidateName(name);
        if (validated.IsFailure)
            return validated.Error!;

        if (await NameTakenAsync(validated.Value, null, ct))
            return DuplicateName(validated.Value);

        var pod = new Pod { Name = validated.Value, Description = Clean(description), IsActive = true };
        db.Set<Pod>().Add(pod);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException e) when (IsUniqueViolation(e))
        {
            db.Entry(pod).State = EntityState.Detached;
            return DuplicateName(validated.Value);
        }

        return await ToDetailAsync(pod, ct);
    }

    public async Task<Result<PodDetail>> UpdateAsync(int podId, string? name, string? description, bool isActive, string? rowVersion, CancellationToken ct)
    {
        var validated = ValidateName(name);
        if (validated.IsFailure)
            return validated.Error!;

        if (!TryDecodeRowVersion(rowVersion, out var version))
            return Error.Validation("rowVersion", "INVALID", "rowVersion is not valid. Reload the Pod and try again.");

        var pod = await db.Set<Pod>().SingleOrDefaultAsync(p => p.Id == podId, ct);
        if (pod is null)
            return NotFound(podId);

        if (await NameTakenAsync(validated.Value, podId, ct))
            return DuplicateName(validated.Value);

        db.Entry(pod).Property(p => p.RowVersion).OriginalValue = version;
        pod.Name = validated.Value;
        pod.Description = Clean(description);
        pod.IsActive = isActive;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException e) when (IsUniqueViolation(e))
        {
            return DuplicateName(validated.Value);
        }

        return await ToDetailAsync(pod, ct);
    }

    public async Task<Result<PodDetail>> AddMembersAsync(int podId, IReadOnlyCollection<int> userIds, CancellationToken ct)
    {
        var pod = await db.Set<Pod>().Include(p => p.Members).SingleOrDefaultAsync(p => p.Id == podId, ct);
        if (pod is null)
            return NotFound(podId);

        if (!pod.IsActive)
            return new Error(ErrorType.Conflict, ErrorCodes.PodInactive, $"Pod '{pod.Name}' is inactive. Reactivate it before adding members.");

        var wanted = userIds.Distinct().ToList();
        var users = await db.Set<AppUser>().Where(u => wanted.Contains(u.Id)).Select(u => new { u.Id, u.IsActive }).ToListAsync(ct);
        var missing = wanted.Except(users.Select(u => u.Id)).ToList();
        if (missing.Count > 0)
            return Error.Validation("userIds", "UNKNOWN_USER", $"Unknown user id(s): {string.Join(", ", missing)}.");

        var disabled = users.Where(u => !u.IsActive).Select(u => u.Id).ToList();
        if (disabled.Count > 0)
            return Error.Validation("userIds", "USER_INACTIVE", $"Disabled user(s) cannot be added: {string.Join(", ", disabled)}.");

        var existing = pod.Members.Select(m => m.UserId).ToHashSet();
        foreach (var userId in wanted.Where(id => !existing.Contains(id)))
            pod.Members.Add(new PodMember { UserId = userId });

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException e) when (IsUniqueViolation(e))
        {
            // A concurrent request added the same member: the intended state already holds.
            db.ChangeTracker.Clear();
        }

        return await GetAsync(podId, ct);
    }

    public async Task<Result> RemoveMemberAsync(int podId, int userId, CancellationToken ct)
    {
        var member = await db.Set<PodMember>().SingleOrDefaultAsync(m => m.PodId == podId && m.UserId == userId, ct);
        if (member is null)
        {
            return await db.Set<Pod>().AnyAsync(p => p.Id == podId, ct)
                ? Result.Success() // already not a member: idempotent
                : NotFound(podId);
        }

        db.Set<PodMember>().Remove(member);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<PodDetail>> SetPrimaryAsync(int podId, int userId, bool isPrimary, CancellationToken ct)
    {
        var memberships = await db.Set<PodMember>().Include(m => m.Pod).Where(m => m.UserId == userId).ToListAsync(ct);
        var target = memberships.SingleOrDefault(m => m.PodId == podId);
        if (target is null)
        {
            return await db.Set<Pod>().AnyAsync(p => p.Id == podId, ct)
                ? Error.NotFound($"User {userId} is not a member of pod {podId}.")
                : NotFound(podId);
        }

        if (isPrimary && !target.Pod.IsActive)
            return new Error(ErrorType.Conflict, ErrorCodes.PodInactive, $"Pod '{target.Pod.Name}' is inactive and cannot be a primary Pod.");

        if (target.IsPrimary != isPrimary)
        {
            // The unique index allows one primary per user, so clear the old one before setting the new one.
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var others = isPrimary ? memberships.Where(m => m.IsPrimary && m.PodId != podId).ToList() : [];
            if (others.Count > 0)
            {
                foreach (var other in others)
                    other.IsPrimary = false;
                await db.SaveChangesAsync(ct);
            }

            target.IsPrimary = isPrimary;
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }

        return await GetAsync(podId, ct);
    }

    public async Task<Result<IReadOnlyList<UserPodDto>>> GetUserPodsAsync(int userId, bool includeInactive, CancellationToken ct)
    {
        if (!await db.Set<AppUser>().AnyAsync(u => u.Id == userId, ct))
            return Error.NotFound($"User {userId} was not found.");

        var rows = await db.Set<PodMember>().AsNoTracking()
            .Where(m => m.UserId == userId && (includeInactive || m.Pod.IsActive))
            .OrderBy(m => m.Pod.Name)
            .Select(m => new UserPodDto(m.PodId, m.Pod.Name, m.Pod.IsActive, m.IsPrimary))
            .ToListAsync(ct);
        return Result<IReadOnlyList<UserPodDto>>.Success(rows);
    }

    public async Task<IReadOnlyList<PodMemberCandidate>> FindCandidatesAsync(string? search, CancellationToken ct)
    {
        var query = db.Set<AppUser>().AsNoTracking().Where(u => u.IsActive);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(u => u.DisplayName.Contains(term) || (u.Email != null && u.Email.Contains(term)));
        }

        return await query.OrderBy(u => u.DisplayName).Take(25)
            .Select(u => new PodMemberCandidate(u.Id, u.DisplayName, u.Email))
            .ToListAsync(ct);
    }

    private async Task<PodDetail> ToDetailAsync(Pod pod, CancellationToken ct)
    {
        var members = await db.Set<PodMember>().AsNoTracking()
            .Where(m => m.PodId == pod.Id)
            .OrderBy(m => m.User.DisplayName)
            .Select(m => new { m.UserId, m.User.DisplayName, m.User.Email, m.User.IsActive, m.IsPrimary })
            .ToListAsync(ct);

        // Pod.View is in every starter role; the directory details (e-mail, role names such as who the System Admins are) are shown only to
        // callers who may see the user directory or manage pods (security review SEC-14).
        var seesDirectory = permissions.Has(Permissions.User.View) || permissions.Has(Permissions.Pod.Manage);
        var ids = members.Select(m => m.UserId).ToList();
        var roles = seesDirectory
            ? (await db.Set<UserRole>().AsNoTracking()
                    .Where(r => ids.Contains(r.UserId) && r.Role.IsActive)
                    .Select(r => new { r.UserId, r.Role.Name })
                    .ToListAsync(ct))
                .ToLookup(r => r.UserId, r => r.Name)
            : Enumerable.Empty<(int UserId, string Name)>().ToLookup(r => r.UserId, r => r.Name);

        var dtos = members
            .Select(m => new PodMemberDto(
                m.UserId,
                m.DisplayName,
                seesDirectory ? m.Email : null,
                m.IsActive,
                m.IsPrimary,
                roles[m.UserId].Order(StringComparer.OrdinalIgnoreCase).ToArray()))
            .ToArray();
        return new PodDetail(ToSummary(pod, dtos.Length), dtos);
    }

    private static PodSummary ToSummary(Pod pod, int memberCount) =>
        new(pod.Id, pod.Name, pod.Description, pod.IsActive, memberCount, Convert.ToBase64String(pod.RowVersion));

    private static Result<string> ValidateName(string? name)
    {
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed))
            return Error.Validation("name", "REQUIRED", "Enter a pod name.");

        return trimmed.Length > 100
            ? Error.Validation("name", "MAX_LENGTH", "A pod name can have at most 100 characters.")
            : trimmed;
    }

    private static string? Clean(string? description) => string.IsNullOrWhiteSpace(description) ? null : description.Trim();

    private Task<bool> NameTakenAsync(string name, int? exceptPodId, CancellationToken ct) =>
        db.Set<Pod>().AnyAsync(p => p.Name == name && p.Id != exceptPodId, ct);

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

    private static bool IsUniqueViolation(DbUpdateException e) =>
        e.InnerException is SqlException { Number: UniqueIndexViolation or UniqueConstraintViolation };

    private static Error NotFound(int podId) => Error.NotFound($"Pod {podId} was not found.");

    private static Error DuplicateName(string name) =>
        Error.Conflict(ErrorCodes.DuplicateName, $"A pod named '{name}' already exists.");
}
