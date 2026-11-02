using System.Text.Json;
using MatterFlow.Audit.Contracts;
using MatterFlow.Productions.Domain;
using MatterFlow.SharedKernel.Paging;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Productions.Application;

/// <summary>
/// Production specs: the agreed format of a matter's productions. Create, edit, duplicate, retire and reinstate; never deleted. A retired spec stays on the productions that use it
/// but cannot be chosen for a new or changed one (see <see cref="ProductionService"/>). Every change is audited with its matter, so the sensitive-matter rule restricts the history too.
/// </summary>
public sealed class ProductionSpecService(DbContext db, IAuditWriter audit, ProductionAccess access, IAuditReader auditReader)
{
    public const string ObjectType = nameof(ProductionSpec);
    public const string CreatedEvent = "PRODUCTION_SPEC_CREATED";
    public const string RetiredEvent = "PRODUCTION_SPEC_RETIRED";
    public const string ReinstatedEvent = "PRODUCTION_SPEC_REINSTATED";

    public const int MaxMetadataFields = 100;
    public const int MaxMetadataFieldLength = 100;

    public static readonly string[] SortFields = ["name", "status", "updatedAt", "createdAt"];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<Result<PagedResult<ProductionSpecResponse>>> ListAsync(ProductionSpecListQuery query, CancellationToken ct)
    {
        if (query.MatterId is not { } matterId)
            return Error.Validation("matterId", "REQUIRED", "matterId is required.");
        if (query.Status is { } status && !SpecStatus.All.Contains(status, StringComparer.Ordinal))
            return Error.Validation("status", "INVALID", "status must be Active or Retired.");

        var paging = ProductionSupport.PagingOf(query.Page, query.PageSize, query.Sort, SortFields);
        if (paging.IsFailure)
            return paging.Error!;

        if (await access.FindVisibleMatterAsync(matterId, ct) is null)
            return ProductionSupport.NotFound("Matter");

        var specs = access.Visible(db.Set<ProductionSpec>().AsNoTracking(), s => s.MatterId).Where(s => s.MatterId == matterId);
        if (query.Status is { } wanted)
            specs = specs.Where(s => s.StatusCode == wanted);
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var q = query.Q.Trim();
            specs = specs.Where(s => s.Name.Contains(q) || (s.SourceOfAgreement != null && s.SourceOfAgreement.Contains(q)) || (s.Description != null && s.Description.Contains(q)));
        }

        var (page, sort) = paging.Value;
        var total = await specs.CountAsync(ct);
        IOrderedQueryable<ProductionSpec>? ordered = null;
        foreach (var field in sort)
        {
            ordered = (field.Field, field.Descending, ordered) switch
            {
                ("name", false, null) => specs.OrderBy(s => s.Name),
                ("name", true, null) => specs.OrderByDescending(s => s.Name),
                ("name", false, { } o) => o.ThenBy(s => s.Name),
                ("name", true, { } o) => o.ThenByDescending(s => s.Name),
                ("status", false, null) => specs.OrderBy(s => s.StatusCode),
                ("status", true, null) => specs.OrderByDescending(s => s.StatusCode),
                ("status", false, { } o) => o.ThenBy(s => s.StatusCode),
                ("status", true, { } o) => o.ThenByDescending(s => s.StatusCode),
                ("updatedAt", false, null) => specs.OrderBy(s => s.ModifiedAtUtc ?? s.CreatedAtUtc),
                ("updatedAt", true, null) => specs.OrderByDescending(s => s.ModifiedAtUtc ?? s.CreatedAtUtc),
                ("updatedAt", false, { } o) => o.ThenBy(s => s.ModifiedAtUtc ?? s.CreatedAtUtc),
                ("updatedAt", true, { } o) => o.ThenByDescending(s => s.ModifiedAtUtc ?? s.CreatedAtUtc),
                (_, false, null) => specs.OrderBy(s => s.CreatedAtUtc),
                (_, true, null) => specs.OrderByDescending(s => s.CreatedAtUtc),
                (_, false, { } o) => o.ThenBy(s => s.CreatedAtUtc),
                (_, true, { } o) => o.ThenByDescending(s => s.CreatedAtUtc),
            };
        }

        var rows = await (ordered ?? specs.OrderBy(s => s.Name)).ThenBy(s => s.Id).Skip(page.Skip).Take(page.PageSize).ToListAsync(ct);
        var responses = await ToResponsesAsync(rows, withUsedBy: false, ct);
        return new PagedResult<ProductionSpecResponse>(responses, total, page.Page, page.PageSize);
    }

    public async Task<Result<ProductionSpecResponse>> GetAsync(int id, CancellationToken ct)
    {
        var spec = await access.Visible(db.Set<ProductionSpec>().AsNoTracking(), s => s.MatterId).SingleOrDefaultAsync(s => s.Id == id, ct);
        return spec is null ? ProductionSupport.NotFound("Production spec") : (await ToResponsesAsync([spec], withUsedBy: true, ct))[0];
    }

    public async Task<Result<ProductionSpecResponse>> CreateAsync(CreateProductionSpecRequest request, CancellationToken ct)
    {
        var matter = await access.FindVisibleMatterAsync(request.MatterId, ct);
        if (matter is null)
            return Error.Validation("matterId", "NOT_FOUND", "Select a matter.");
        if (!matter.IsActive)
            return Error.Conflict(ErrorCodes.MatterInactive, $"Matter {matter.MatterRef} is inactive; production specs can't be added to it.");

        var fields = Normalize(request);
        if (fields.IsFailure)
            return fields.Error!;

        var spec = new ProductionSpec { MatterId = matter.MatterId };
        Apply(spec, request, fields.Value);
        if (await NameTakenAsync(spec.MatterId, spec.Name, exceptId: null, ct))
            return ProductionSupport.Duplicate("name", $"An active spec named '{spec.Name}' already exists in this matter.");

        db.Set<ProductionSpec>().Add(spec);
        audit.Write(new AuditEntry
        {
            EventType = CreatedEvent,
            ObjectType = ObjectType,
            ObjectIdFactory = () => ProductionSupport.Id(spec.Id),
            MatterId = spec.MatterId,
            Summary = spec.Name,
        });
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(spec.Id, ct);
    }

    public async Task<Result<ProductionSpecResponse>> UpdateAsync(int id, UpdateProductionSpecRequest request, CancellationToken ct)
    {
        var spec = await access.Visible(db.Set<ProductionSpec>(), s => s.MatterId).SingleOrDefaultAsync(s => s.Id == id, ct);
        if (spec is null)
            return ProductionSupport.NotFound("Production spec");

        var version = ProductionSupport.CheckRowVersion(spec.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;
        if (spec.IsRetired)
            return Error.Conflict("SPEC_RETIRED", "This spec is retired. Reinstate it before editing.");

        var fields = Normalize(request);
        if (fields.IsFailure)
            return fields.Error!;

        var before = Snapshot(spec);
        Apply(spec, request, fields.Value);
        if (await NameTakenAsync(spec.MatterId, spec.Name, spec.Id, ct))
            return ProductionSupport.Duplicate("name", $"An active spec named '{spec.Name}' already exists in this matter.");

        ProductionSupport.WriteFieldChanges(audit, ObjectType, ProductionSupport.Id(spec.Id), spec.MatterId, before, Snapshot(spec));
        ProductionSupport.TrackOriginalRowVersion(db, spec, request.RowVersion);
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(id, ct);
    }

    public async Task<Result<ProductionSpecResponse>> DuplicateAsync(int id, DuplicateProductionSpecRequest request, CancellationToken ct)
    {
        var source = await access.Visible(db.Set<ProductionSpec>().AsNoTracking(), s => s.MatterId).SingleOrDefaultAsync(s => s.Id == id, ct);
        if (source is null)
            return ProductionSupport.NotFound("Production spec");

        var matter = await access.FindVisibleMatterAsync(source.MatterId, ct);
        if (matter is null)
            return ProductionSupport.NotFound("Production spec");
        if (!matter.IsActive)
            return Error.Conflict(ErrorCodes.MatterInactive, $"Matter {matter.MatterRef} is inactive; production specs can't be added to it.");

        string name;
        if (ProductionSupport.Clean(request.Name) is { } given)
        {
            name = given;
            if (await NameTakenAsync(source.MatterId, name, exceptId: null, ct))
                return ProductionSupport.Duplicate("name", $"An active spec named '{name}' already exists in this matter.");
        }
        else
        {
            name = await FreeCopyNameAsync(source.MatterId, source.Name, ct);
        }

        var copy = new ProductionSpec
        {
            MatterId = source.MatterId,
            Name = name,
            SourceOfAgreement = source.SourceOfAgreement,
            Description = source.Description,
            ImageFormat = source.ImageFormat,
            ColourMode = source.ColourMode,
            TextMode = source.TextMode,
            NativesRule = source.NativesRule,
            LoadFile = source.LoadFile,
            MetadataFieldsJson = source.MetadataFieldsJson,
            RedactionRule = source.RedactionRule,
            PrivilegeRule = source.PrivilegeRule,
            DedupRule = source.DedupRule,
            DateTimeRule = source.DateTimeRule,
            NumberingRule = source.NumberingRule,
            DeliveryRule = source.DeliveryRule,
            Notes = source.Notes,
        };
        db.Set<ProductionSpec>().Add(copy);
        audit.Write(new AuditEntry
        {
            EventType = CreatedEvent,
            ObjectType = ObjectType,
            ObjectIdFactory = () => ProductionSupport.Id(copy.Id),
            MatterId = copy.MatterId,
            Summary = $"{copy.Name} (copy of {source.Name})",
        });
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(copy.Id, ct);
    }

    public Task<Result<ProductionSpecResponse>> RetireAsync(int id, ChangeProductionSpecStatusRequest request, CancellationToken ct) =>
        ChangeStatusAsync(id, request, SpecStatus.Retired, ct);

    public Task<Result<ProductionSpecResponse>> ReinstateAsync(int id, ChangeProductionSpecStatusRequest request, CancellationToken ct) =>
        ChangeStatusAsync(id, request, SpecStatus.Active, ct);

    private async Task<Result<ProductionSpecResponse>> ChangeStatusAsync(int id, ChangeProductionSpecStatusRequest request, string target, CancellationToken ct)
    {
        var spec = await access.Visible(db.Set<ProductionSpec>(), s => s.MatterId).SingleOrDefaultAsync(s => s.Id == id, ct);
        if (spec is null)
            return ProductionSupport.NotFound("Production spec");

        var version = ProductionSupport.CheckRowVersion(spec.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        if (spec.StatusCode == target)
            return await GetAsync(id, ct); // already there: idempotent

        if (target == SpecStatus.Active && await NameTakenAsync(spec.MatterId, spec.Name, spec.Id, ct))
            return ProductionSupport.Duplicate("name", $"An active spec named '{spec.Name}' already exists in this matter. Rename one of them first.");

        spec.StatusCode = target;
        audit.Write(new AuditEntry
        {
            EventType = target == SpecStatus.Retired ? RetiredEvent : ReinstatedEvent,
            ObjectType = ObjectType,
            ObjectId = ProductionSupport.Id(spec.Id),
            MatterId = spec.MatterId,
            Summary = spec.Name,
        });
        ProductionSupport.TrackOriginalRowVersion(db, spec, request.RowVersion);
        var saved = await SaveAsync(ct);
        return saved.IsFailure ? saved.Error! : await GetAsync(id, ct);
    }

    public async Task<Result<ProductionHistoryResponse>> HistoryAsync(int id, ProductionHistoryQuery query, CancellationToken ct)
    {
        var visible = await access.Visible(db.Set<ProductionSpec>().AsNoTracking(), s => s.MatterId).AnyAsync(s => s.Id == id, ct);
        return visible
            ? await ProductionHistory.ReadAsync(auditReader, access, ObjectType, ProductionSupport.Id(id), query, valueNames: null, ct)
            : ProductionSupport.NotFound("Production spec");
    }

    /// <summary>True when an active spec of the matter already has the name (case-insensitive, like the unique index).</summary>
    private Task<bool> NameTakenAsync(int matterId, string name, int? exceptId, CancellationToken ct) =>
        db.Set<ProductionSpec>().AnyAsync(s => s.MatterId == matterId && s.StatusCode == SpecStatus.Active && s.Name == name && (exceptId == null || s.Id != exceptId), ct);

    private async Task<string> FreeCopyNameAsync(int matterId, string sourceName, CancellationToken ct)
    {
        var names = await db.Set<ProductionSpec>().AsNoTracking()
            .Where(s => s.MatterId == matterId && s.StatusCode == SpecStatus.Active && s.Name.StartsWith("Copy of "))
            .Select(s => s.Name).ToListAsync(ct);
        return ProductionSpecRules.CopyName(sourceName, names);
    }

    private async Task<Result> SaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return Result.Success();
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return ProductionSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (ProductionSupport.IsUniqueViolation(ex, ProductionSupport.ActiveSpecNameUnique))
        {
            db.ChangeTracker.Clear();
            return ProductionSupport.Duplicate("name", "An active spec with this name already exists in this matter.");
        }
    }

    private static Result<string?> Normalize(ProductionSpecInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Name))
            return Error.Validation("name", "REQUIRED", "Enter a name.");

        var names = (input.MetadataFields ?? [])
            .Select(f => f?.Trim() ?? string.Empty)
            .Where(f => f.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (names.Count > MaxMetadataFields)
            return Error.Validation("metadataFields", "TOO_MANY", $"At most {MaxMetadataFields} metadata fields.");
        if (names.Any(f => f.Length > MaxMetadataFieldLength))
            return Error.Validation("metadataFields", "TOO_LONG", $"A metadata field name is at most {MaxMetadataFieldLength} characters.");

        var json = names.Count == 0 ? null : JsonSerializer.Serialize(names, Json);
        return json is { Length: > 4000 }
            ? Error.Validation("metadataFields", "TOO_LONG", "The metadata field list is too long.")
            : json;
    }

    private static void Apply(ProductionSpec spec, ProductionSpecInput input, string? metadataJson)
    {
        spec.Name = input.Name.Trim();
        spec.SourceOfAgreement = ProductionSupport.Clean(input.SourceOfAgreement);
        spec.Description = ProductionSupport.Clean(input.Description);
        spec.ImageFormat = ProductionSupport.Clean(input.ImageFormat);
        spec.ColourMode = ProductionSupport.Clean(input.ColourMode);
        spec.TextMode = ProductionSupport.Clean(input.TextMode);
        spec.NativesRule = ProductionSupport.Clean(input.NativesRule);
        spec.LoadFile = ProductionSupport.Clean(input.LoadFile);
        spec.MetadataFieldsJson = metadataJson;
        spec.RedactionRule = ProductionSupport.Clean(input.RedactionRule);
        spec.PrivilegeRule = ProductionSupport.Clean(input.PrivilegeRule);
        spec.DedupRule = ProductionSupport.Clean(input.DedupRule);
        spec.DateTimeRule = ProductionSupport.Clean(input.DateTimeRule);
        spec.NumberingRule = ProductionSupport.Clean(input.NumberingRule);
        spec.DeliveryRule = ProductionSupport.Clean(input.DeliveryRule);
        spec.Notes = ProductionSupport.Clean(input.Notes);
    }

    /// <summary>The audited fields as text (the metadata field list as one comma-separated line).</summary>
    private static Dictionary<string, string?> Snapshot(ProductionSpec s) => new()
    {
        [nameof(ProductionSpec.Name)] = s.Name,
        [nameof(ProductionSpec.SourceOfAgreement)] = s.SourceOfAgreement,
        [nameof(ProductionSpec.Description)] = s.Description,
        [nameof(ProductionSpec.ImageFormat)] = s.ImageFormat,
        [nameof(ProductionSpec.ColourMode)] = s.ColourMode,
        [nameof(ProductionSpec.TextMode)] = s.TextMode,
        [nameof(ProductionSpec.NativesRule)] = s.NativesRule,
        [nameof(ProductionSpec.LoadFile)] = s.LoadFile,
        ["MetadataFields"] = string.Join(", ", ParseFields(s.MetadataFieldsJson)) is { Length: > 0 } list ? list : null,
        [nameof(ProductionSpec.RedactionRule)] = s.RedactionRule,
        [nameof(ProductionSpec.PrivilegeRule)] = s.PrivilegeRule,
        [nameof(ProductionSpec.DedupRule)] = s.DedupRule,
        [nameof(ProductionSpec.DateTimeRule)] = s.DateTimeRule,
        [nameof(ProductionSpec.NumberingRule)] = s.NumberingRule,
        [nameof(ProductionSpec.DeliveryRule)] = s.DeliveryRule,
        [nameof(ProductionSpec.Notes)] = s.Notes,
    };

    private static IReadOnlyList<string> ParseFields(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return [];

        try
        {
            return JsonSerializer.Deserialize<List<string>>(json, Json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task<IReadOnlyList<ProductionSpecResponse>> ToResponsesAsync(IReadOnlyList<ProductionSpec> specs, bool withUsedBy, CancellationToken ct)
    {
        if (specs.Count == 0)
            return [];

        var ids = specs.Select(s => s.Id).ToList();
        var counts = await access.Visible(db.Set<Production>().AsNoTracking(), p => p.MatterId)
            .Where(p => p.ProductionSpecId != null && ids.Contains(p.ProductionSpecId.Value))
            .GroupBy(p => p.ProductionSpecId!.Value)
            .Select(g => new { SpecId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.SpecId, x => x.Count, ct);

        var uses = new Dictionary<int, IReadOnlyList<ProductionSpecUse>>();
        if (withUsedBy)
        {
            foreach (var spec in specs)
            {
                uses[spec.Id] = await access.Visible(db.Set<Production>().AsNoTracking(), p => p.MatterId)
                    .Where(p => p.ProductionSpecId == spec.Id)
                    .OrderBy(p => p.Name).ThenBy(p => p.Id)
                    .Take(50)
                    .Select(p => new ProductionSpecUse(p.Id, p.Name, p.VolumeNo, p.BatesBegin, p.BatesEnd))
                    .ToListAsync(ct);
            }
        }

        var names = await access.NamesAsync(specs.SelectMany(s => new[] { s.CreatedByUserId, s.ModifiedByUserId }), ct);
        string? Name(int? userId) => userId is { } u && names.TryGetValue(u, out var n) ? n : null;

        return [.. specs.Select(s => new ProductionSpecResponse(
            s.Id,
            s.MatterId,
            s.Name,
            s.StatusCode,
            s.SourceOfAgreement,
            s.Description,
            s.ImageFormat,
            s.ColourMode,
            s.TextMode,
            s.NativesRule,
            s.LoadFile,
            ParseFields(s.MetadataFieldsJson),
            s.RedactionRule,
            s.PrivilegeRule,
            s.DedupRule,
            s.DateTimeRule,
            s.NumberingRule,
            s.DeliveryRule,
            s.Notes,
            counts.GetValueOrDefault(s.Id),
            uses.GetValueOrDefault(s.Id) ?? [],
            ProductionSupport.Encode(s.RowVersion),
            ProductionSupport.Utc(s.CreatedAtUtc),
            s.CreatedByUserId,
            Name(s.CreatedByUserId),
            ProductionSupport.Utc(s.ModifiedAtUtc),
            s.ModifiedByUserId,
            Name(s.ModifiedByUserId)))];
    }
}
