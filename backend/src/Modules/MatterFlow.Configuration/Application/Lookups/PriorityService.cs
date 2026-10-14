using System.ComponentModel.DataAnnotations;
using MatterFlow.Audit.Contracts;
using MatterFlow.Configuration.Contracts;
using MatterFlow.Configuration.Domain;
using MatterFlow.Configuration.Infrastructure;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Lookups;

/// <summary>A priority for the admin screen and the Task screens' lookups.</summary>
/// <param name="Id">Priority id.</param>
/// <param name="Label">Display label.</param>
/// <param name="SortOrder">Position, 1 = most urgent. Never shown to users as a number.</param>
/// <param name="Color">Badge color token (critical, high, normal, low, neutral) or a <c>#RRGGBB</c> override.</param>
/// <param name="IsActive">False = not offered for new or changed tasks; historical tasks still show it.</param>
/// <param name="IsDefault">True for exactly one priority: the one pre-selected for new tasks.</param>
/// <param name="RowVersion">Optimistic-concurrency token (base64); send it back on update.</param>
public sealed record PriorityView(
    [property: Required] int Id,
    [property: Required] string Label,
    [property: Required] int SortOrder,
    [property: Required] string Color,
    [property: Required] bool IsActive,
    [property: Required] bool IsDefault,
    [property: Required] string RowVersion);

/// <summary>Body to create a priority. It is appended as the least urgent and is never the default.</summary>
public sealed record CreatePriorityRequest(
    [Required, StringLength(50)] string Label,
    [Required, StringLength(20)] string Color,
    bool IsActive = true);

/// <summary>Body to change a priority. The default flag changes only through the set-default action.</summary>
public sealed record UpdatePriorityRequest(
    [Required, StringLength(50)] string Label,
    [Required, StringLength(20)] string Color,
    [Required] bool IsActive,
    [Required] string RowVersion);

/// <summary>Priority ids from most to least urgent. Must list every priority exactly once.</summary>
public sealed record ReorderRequest([Required] IReadOnlyList<int> Ids);

/// <summary>Priorities: admin commands (audited) and the <see cref="IPriorityCatalog"/> read side for other modules.</summary>
public sealed class PriorityService(DbContext db, IAuditWriter audit, IEnumerable<IPriorityUsage> usage) : IPriorityCatalog
{
    private const string ObjectType = "Priority";

    public static PriorityView ToView(Priority p) =>
        new(p.Id, p.Label, p.SortOrder, p.Color, p.IsActive, p.IsDefault, LookupSupport.FormatRowVersion(p.RowVersion));

    private static PriorityInfo ToInfo(Priority p) => new(p.Id, p.Label, p.SortOrder, p.Color, p.IsActive, p.IsDefault);

    // ---- read side

    public async Task<IReadOnlyList<PriorityView>> ListViewsAsync(CancellationToken ct = default) =>
        (await db.Set<Priority>().AsNoTracking().OrderBy(p => p.SortOrder).ThenBy(p => p.Id).ToListAsync(ct)).Select(ToView).ToList();

    public async Task<IReadOnlyList<PriorityInfo>> ListAsync(bool includeInactive, CancellationToken cancellationToken = default) =>
        (await db.Set<Priority>().AsNoTracking()
            .Where(p => includeInactive || p.IsActive)
            .OrderBy(p => p.SortOrder).ThenBy(p => p.Id)
            .ToListAsync(cancellationToken)).Select(ToInfo).ToList();

    public async Task<PriorityInfo?> GetAsync(int priorityId, CancellationToken cancellationToken = default)
    {
        var row = await db.Set<Priority>().AsNoTracking().FirstOrDefaultAsync(p => p.Id == priorityId, cancellationToken);
        return row is null ? null : ToInfo(row);
    }

    public async Task<PriorityInfo> GetDefaultAsync(CancellationToken cancellationToken = default) =>
        ToInfo(await db.Set<Priority>().AsNoTracking().FirstAsync(p => p.IsDefault, cancellationToken));

    public Task<bool> IsAssignableAsync(int priorityId, CancellationToken cancellationToken = default) =>
        db.Set<Priority>().AnyAsync(p => p.Id == priorityId && p.IsActive, cancellationToken);

    // ---- commands

    public async Task<Result<PriorityView>> CreateAsync(CreatePriorityRequest request, CancellationToken ct = default)
    {
        var label = LookupSupport.CleanText(request.Label, "label", "Enter a label.");
        if (label.IsFailure)
            return label.Error!;
        if (!PriorityColors.IsValid(request.Color))
            return InvalidColor();
        if (await LabelExistsAsync(label.Value, null, ct))
            return DuplicateLabel(label.Value);

        var max = await db.Set<Priority>().MaxAsync(p => (int?)p.SortOrder, ct) ?? 0;
        var hasDefault = await db.Set<Priority>().AnyAsync(p => p.IsDefault, ct);
        var priority = new Priority
        {
            Label = label.Value,
            Color = request.Color,
            IsActive = request.IsActive || !hasDefault,
            IsDefault = !hasDefault,
            SortOrder = max + 1,
        };
        db.Set<Priority>().Add(priority);
        var failure = await LookupSupport.SaveAsync(db, DuplicateLabel(label.Value), null, ct);
        return failure is not null ? failure : ToView(priority);
    }

    public async Task<Result<PriorityView>> UpdateAsync(int id, UpdatePriorityRequest request, CancellationToken ct = default)
    {
        var version = LookupSupport.ParseRowVersion(request.RowVersion);
        if (version is null)
            return LookupErrors.InvalidRowVersion();
        var label = LookupSupport.CleanText(request.Label, "label", "Enter a label.");
        if (label.IsFailure)
            return label.Error!;
        if (!PriorityColors.IsValid(request.Color))
            return InvalidColor();

        var priority = await db.Set<Priority>().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (priority is null)
            return Error.NotFound("Priority not found.");
        if (!LookupSupport.VersionMatches(priority, version))
            return LookupErrors.Concurrency();
        if (priority.IsDefault && !request.IsActive)
            return LookupErrors.DefaultRequired("The default priority cannot be deactivated. Choose another default first.");
        if (await LabelExistsAsync(label.Value, id, ct))
            return DuplicateLabel(label.Value);

        priority.Label = label.Value;
        priority.Color = request.Color;
        priority.IsActive = request.IsActive;
        LookupSupport.ExpectVersion(db, priority, version);
        var failure = await LookupSupport.SaveAsync(db, DuplicateLabel(label.Value), null, ct);
        return failure is not null ? failure : ToView(priority);
    }

    /// <summary>Makes <paramref name="id"/> the single default (it must be active). Clears the previous default first so the unique filtered index holds.</summary>
    public async Task<Result<IReadOnlyList<PriorityView>>> SetDefaultAsync(int id, CancellationToken ct = default)
    {
        var target = await db.Set<Priority>().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (target is null)
            return Error.NotFound("Priority not found.");
        if (!target.IsActive)
            return LookupErrors.DefaultRequired("An inactive priority cannot be the default. Activate it first.");

        if (!target.IsDefault)
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            var previous = await db.Set<Priority>().Where(p => p.IsDefault).ToListAsync(ct);
            foreach (var old in previous)
                old.IsDefault = false;
            var oldLabel = previous.Count == 0 ? null : string.Join(", ", previous.Select(p => p.Label));
            if (previous.Count > 0)
            {
                var cleared = await LookupSupport.SaveAsync(db, null, null, ct);
                if (cleared is not null)
                    return cleared;
            }

            target.IsDefault = true;
            audit.Write(new AuditEntry
            {
                EventType = "PRIORITY_DEFAULT_CHANGED",
                ObjectType = ObjectType,
                ObjectId = target.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                FieldKey = nameof(Priority.IsDefault),
                OldValue = oldLabel,
                NewValue = target.Label,
                Summary = $"Default priority is now {target.Label}",
            });
            var failure = await LookupSupport.SaveAsync(db, null, null, ct);
            if (failure is not null)
                return failure;
            await tx.CommitAsync(ct);
        }

        return Result<IReadOnlyList<PriorityView>>.Success(await ListViewsAsync(ct));
    }

    public async Task<Result<IReadOnlyList<PriorityView>>> ReorderAsync(IReadOnlyList<int> ids, CancellationToken ct = default)
    {
        var all = await db.Set<Priority>().ToListAsync(ct);
        if (ids.Count != all.Count || ids.Distinct().Count() != ids.Count || !all.Select(p => p.Id).ToHashSet().SetEquals(ids))
            return Error.Validation("ids", "INVALID", "List every priority exactly once.");

        var byId = all.ToDictionary(p => p.Id);
        for (var i = 0; i < ids.Count; i++)
            byId[ids[i]].SortOrder = i + 1;

        var failure = await LookupSupport.SaveAsync(db, null, null, ct);
        return failure is not null ? failure : Result<IReadOnlyList<PriorityView>>.Success(await ListViewsAsync(ct));
    }

    /// <summary>Deletes an unused, non-default priority. A priority tasks reference can only be deactivated.</summary>
    public async Task<Result> DeleteAsync(int id, CancellationToken ct = default)
    {
        var priority = await db.Set<Priority>().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (priority is null)
            return Error.NotFound("Priority not found.");
        if (priority.IsDefault)
            return LookupErrors.DefaultRequired("The default priority cannot be deleted. Choose another default first.");

        var inUse = LookupErrors.InUse("Tasks use this priority, so it cannot be deleted. Deactivate it instead.");
        foreach (var probe in usage)
        {
            if (await probe.IsInUseAsync(id, ct))
                return inUse;
        }

        db.Set<Priority>().Remove(priority);
        var failure = await LookupSupport.SaveAsync(db, null, inUse, ct);
        return failure is not null ? failure : Result.Success();
    }

    private Task<bool> LabelExistsAsync(string label, int? exceptId, CancellationToken ct) =>
        db.Set<Priority>().AnyAsync(p => p.Label == label && (exceptId == null || p.Id != exceptId), ct);

    private static Error DuplicateLabel(string label) => LookupErrors.Duplicate("label", $"A priority named '{label}' exists.");

    private static Error InvalidColor() =>
        Error.Validation("color", "INVALID", "Choose a color token (critical, high, normal, low, neutral) or a #RRGGBB value.");
}
