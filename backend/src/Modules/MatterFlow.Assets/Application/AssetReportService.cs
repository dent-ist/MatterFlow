using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Assets.Application;

/// <summary>
/// Saved asset reports (epic #851, issue #872): personal definitions of the built-in report builder. The owner is the caller; another person's id is a 404.
/// A definition is validated against the asset type and its published form before it is saved, is versioned (<c>v</c> = 1, an unknown version is rejected),
/// at most <see cref="MaxDefinitionBytes"/> bytes, and a person keeps at most <see cref="MaxReports"/> reports. A report stores no data: each run recomputes with
/// the viewer's current visibility.
/// </summary>
public sealed class AssetReportService(
    DbContext db,
    ICurrentUser currentUser,
    IFormFieldCatalog fieldCatalog,
    IMatterVisibility visibility)
{
    public const int MaxReports = 50;
    public const int MaxDefinitionBytes = 4096;
    public const int MaxMatters = 100;
    public const string ReportLimitCode = "REPORT_LIMIT_REACHED";
    public const string UnsupportedVersionCode = "UNSUPPORTED_VERSION";

    internal const string OwnerUnique = "UQ_AssetReport_OwnerName";

    private static readonly string[] Charts = ["table", "pie", "bar"];
    private static readonly string[] Scopes = ["mine", "all"];

    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public async Task<Result<IReadOnlyList<AssetReportResponse>>> ListAsync(CancellationToken ct)
    {
        if (Owner() is not { } owner)
            return NoPerson();

        var rows = await db.Set<AssetReport>().AsNoTracking().Where(r => r.OwnerUserId == owner).OrderBy(r => r.Name).ToListAsync(ct);
        return Result<IReadOnlyList<AssetReportResponse>>.Success([.. rows.Select(ToResponse)]);
    }

    public async Task<Result<AssetReportResponse>> GetAsync(int id, CancellationToken ct)
    {
        var report = await FindOwnAsync(id, tracked: false, ct);
        return report is null ? AssetSupport.NotFound("Asset report") : ToResponse(report);
    }

    public async Task<Result<AssetReportResponse>> CreateAsync(CreateAssetReportRequest request, CancellationToken ct)
    {
        if (Owner() is not { } owner)
            return NoPerson();

        var name = request.Name.Trim();
        if (name.Length == 0)
            return Error.Validation("name", "REQUIRED", "Enter a name.");

        var checkedDefinition = await ValidateAsync(request.Definition, ct);
        if (checkedDefinition.IsFailure)
            return checkedDefinition.Error!;

        if (await db.Set<AssetReport>().CountAsync(r => r.OwnerUserId == owner, ct) >= MaxReports)
            return Error.Conflict(ReportLimitCode, $"You can keep {MaxReports} saved reports. Delete one first.");

        if (await FindIdByNameAsync(owner, name, null, ct) is { } existing)
            return DuplicateName(name, existing);

        var report = new AssetReport { OwnerUserId = owner, Name = name, DefinitionJson = checkedDefinition.Value };
        db.Set<AssetReport>().Add(report);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (AssetSupport.IsUniqueViolation(ex, OwnerUnique))
        {
            db.ChangeTracker.Clear();
            return DuplicateName(name, await FindIdByNameAsync(owner, name, null, ct));
        }

        return ToResponse(report);
    }

    public async Task<Result<AssetReportResponse>> UpdateAsync(int id, UpdateAssetReportRequest request, CancellationToken ct)
    {
        var report = await FindOwnAsync(id, tracked: true, ct);
        if (report is null)
            return AssetSupport.NotFound("Asset report");

        var version = AssetSupport.CheckRowVersion(report.RowVersion, request.RowVersion);
        if (version.IsFailure)
            return version.Error!;

        var name = request.Name.Trim();
        if (name.Length == 0)
            return Error.Validation("name", "REQUIRED", "Enter a name.");

        var checkedDefinition = await ValidateAsync(request.Definition, ct);
        if (checkedDefinition.IsFailure)
            return checkedDefinition.Error!;

        if (!string.Equals(name, report.Name, StringComparison.OrdinalIgnoreCase) && await FindIdByNameAsync(report.OwnerUserId, name, id, ct) is { } existing)
            return DuplicateName(name, existing);

        report.Name = name;
        report.DefinitionJson = checkedDefinition.Value;
        AssetSupport.TrackOriginalRowVersion(db, report, request.RowVersion);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return AssetSupport.ConcurrencyError();
        }
        catch (DbUpdateException ex) when (AssetSupport.IsUniqueViolation(ex, OwnerUnique))
        {
            db.ChangeTracker.Clear();
            return DuplicateName(name, await FindIdByNameAsync(report.OwnerUserId, name, id, ct));
        }

        return ToResponse(report);
    }

    public async Task<Result> DeleteAsync(int id, CancellationToken ct)
    {
        var report = await FindOwnAsync(id, tracked: true, ct);
        if (report is null)
            return AssetSupport.NotFound("Asset report");

        db.Set<AssetReport>().Remove(report);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    /// <summary>What the builder can offer for one asset type (or, with null, for all types).</summary>
    public async Task<Result<AssetReportFieldsResponse>> FieldsAsync(int? assetTypeId, CancellationToken ct)
    {
        string? key = null;
        string? unit = null;
        IReadOnlyList<AssetReportNumberField> numbers = [];
        List<AssetReportGroupOption> groups = [.. AssetReportGroupBy.BuiltIn.Select(g => new AssetReportGroupOption(g, AssetReportGroupBy.Label(g)))];
        if (assetTypeId is { } typeId)
        {
            var type = await db.Set<AssetType>().AsNoTracking().Where(t => t.Id == typeId).Select(t => new { t.SizeFieldKey, t.SizeUnit }).SingleOrDefaultAsync(ct);
            if (type is null)
                return AssetSupport.NotFound("Asset type");

            key = type.SizeFieldKey;
            unit = type.SizeUnit;
            var published = await fieldCatalog.GetPublishedFieldsAsync(FormOwnerKind.AssetType, typeId, ct);
            numbers =
            [
                .. published.Where(f => f.IsNumber).Select(f => new AssetReportNumberField(f.Key, f.Label, f.Key == key, f.Key == key ? unit : null)),
            ];
            groups.AddRange(published.Where(f => f.IsSelect).Select(f => new AssetReportGroupOption(AssetReportGroupBy.FieldPrefix + f.Key, f.Label)));
        }

        return new AssetReportFieldsResponse(AssetReportMeasures.All, numbers, groups, AssetSize.Units, key, unit);
    }

    /// <summary>
    /// Validates a definition against the asset type and its published form, normalises it (trimmed, sorted, irrelevant fields cleared) and returns the JSON to store.
    /// The run endpoints use the same check, so a definition that was valid when saved is checked again against the form as it is today.
    /// </summary>
    internal async Task<Result<string>> ValidateAsync(AssetReportDefinition? definition, CancellationToken ct)
    {
        var normalised = await NormaliseAsync(definition, ct);
        if (normalised.IsFailure)
            return normalised.Error!;

        var json = JsonSerializer.Serialize(normalised.Value, Json);
        return Encoding.UTF8.GetByteCount(json) > MaxDefinitionBytes
            ? Error.Validation("definition", "TOO_LARGE", $"The report definition is larger than {MaxDefinitionBytes} bytes.")
            : json;
    }

    public async Task<Result<AssetReportDefinition>> NormaliseAsync(AssetReportDefinition? definition, CancellationToken ct)
    {
        if (definition is null)
            return Error.Validation("definition", "REQUIRED", "A report needs a definition.");
        if (definition.V != 1)
            return Error.Validation("definition.v", UnsupportedVersionCode, $"Definition version {definition.V} is not supported.");

        var measure = definition.Measure?.Trim().ToLowerInvariant() ?? string.Empty;
        if (!AssetReportMeasures.All.Contains(measure))
            return Error.Validation("definition.measure", "INVALID", "The measure must be count, sum or average.");

        var scope = definition.Scope?.Trim().ToLowerInvariant() ?? string.Empty;
        if (!Scopes.Contains(scope))
            return Error.Validation("definition.scope", "INVALID", "The scope must be mine or all.");

        var chart = definition.Chart?.Trim().ToLowerInvariant();
        if (chart is not null && !Charts.Contains(chart))
            return Error.Validation("definition.chart", "INVALID", "The chart must be table, pie or bar.");

        string[]? dispositions = null;
        if (definition.Dispositions is { Length: > 0 } wanted)
        {
            var codes = wanted.Select(d => d?.Trim().ToUpperInvariant() ?? string.Empty).Distinct().Order(StringComparer.Ordinal).ToArray();
            if (codes.Any(c => !AssetDisposition.IsValid(c)))
                return Error.Validation("definition.dispositions", "INVALID", "A disposition must be ACTIVE, INACTIVE, PENDING_DISPOSITION or DISPOSED.");

            dispositions = codes.Length == AssetDisposition.All.Count ? null : codes;
        }

        int[]? matterIds = null;
        if (definition.MatterIds is { Length: > 0 } matters)
        {
            matterIds = [.. matters.Distinct().Order()];
            if (matterIds.Length > MaxMatters)
                return Error.Validation("definition.matterIds", "TOO_MANY", $"Choose at most {MaxMatters} matters.");

            var visible = await visibility.VisibleMatters().Where(m => matterIds.Contains(m.MatterId)).Select(m => m.MatterId).ToListAsync(ct);
            if (visible.Count != matterIds.Length)
                return Error.Validation("definition.matterIds", "UNKNOWN", "One of the matters does not exist.");
        }

        var groupBy = definition.GroupBy?.Trim() ?? string.Empty;
        var numberField = AssetSupport.Clean(definition.NumberField);
        var numberUnit = AssetSupport.Clean(definition.NumberUnit);
        IReadOnlyList<FormFieldInfo> published = [];
        AssetType? type = null;
        if (definition.AssetTypeId is { } typeId)
        {
            type = await db.Set<AssetType>().AsNoTracking().SingleOrDefaultAsync(t => t.Id == typeId, ct);
            if (type is null)
                return Error.Validation("definition.assetTypeId", "UNKNOWN", "The asset type does not exist.");

            published = await fieldCatalog.GetPublishedFieldsAsync(FormOwnerKind.AssetType, typeId, ct);
        }

        if (!AssetReportGroupBy.BuiltIn.Contains(groupBy))
        {
            var fieldKey = groupBy.StartsWith(AssetReportGroupBy.FieldPrefix, StringComparison.Ordinal) ? groupBy[AssetReportGroupBy.FieldPrefix.Length..] : null;
            if (fieldKey is null || type is null || !published.Any(f => f.IsSelect && f.Key == fieldKey))
                return Error.Validation("definition.groupBy", "INVALID", "Group by disposition, matter, client, asset type or a select field of the chosen asset type.");
        }

        if (measure == AssetReportMeasures.Count)
        {
            if (numberField is not null || numberUnit is not null)
                return Error.Validation("definition.numberField", "NOT_ALLOWED", "A count has no number field.");
        }
        else if (type is null)
        {
            if (numberField is not null || numberUnit is not null)
                return Error.Validation("definition.numberField", "NOT_ALLOWED", "For all asset types the default size field of each type is used; choose an asset type to pick another field.");
        }
        else if (numberField is null)
        {
            if (type.SizeFieldKey is null)
                return Error.Validation("definition.numberField", "REQUIRED", "Choose the number field, or set a default size field on the asset type.");

            numberUnit = null;
        }
        else
        {
            if (!published.Any(f => f.IsNumber && f.Key == numberField))
                return Error.Validation("definition.numberField", "INVALID", "The field must be a number field of the published form of this asset type.");

            if (numberField == type.SizeFieldKey)
            {
                numberUnit = null;
            }
            else if (!AssetSize.IsKnownUnit(numberUnit))
            {
                return Error.Validation("definition.numberUnit", "REQUIRED", $"Choose the unit of this field: {string.Join(", ", AssetSize.Units)}.");
            }
        }

        return new AssetReportDefinition
        {
            V = 1,
            AssetTypeId = definition.AssetTypeId,
            Measure = measure,
            NumberField = measure == AssetReportMeasures.Count ? null : numberField,
            NumberUnit = measure == AssetReportMeasures.Count ? null : numberUnit,
            GroupBy = groupBy,
            Scope = scope,
            MatterIds = matterIds,
            Dispositions = dispositions,
            Chart = chart == "table" ? null : chart,
        };
    }

    /// <summary>Reads a stored definition; null when it is not version 1 or cannot be parsed.</summary>
    public static AssetReportDefinition? Parse(string json)
    {
        try
        {
            var definition = JsonSerializer.Deserialize<AssetReportDefinition>(json, Json);
            return definition is { V: 1 } ? definition : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public async Task<AssetReport?> FindOwnAsync(int id, bool tracked, CancellationToken ct)
    {
        if (Owner() is not { } owner)
            return null;

        var reports = tracked ? db.Set<AssetReport>() : db.Set<AssetReport>().AsNoTracking();
        return await reports.SingleOrDefaultAsync(r => r.Id == id && r.OwnerUserId == owner, ct);
    }

    private int? Owner() => currentUser.UserId;

    private static Error NoPerson() => Error.Forbidden("Saved reports belong to a person.");

    private async Task<int?> FindIdByNameAsync(int owner, string name, int? exceptId, CancellationToken ct) =>
        await db.Set<AssetReport>().AsNoTracking()
            .Where(r => r.OwnerUserId == owner && r.Name == name && (exceptId == null || r.Id != exceptId))
            .Select(r => (int?)r.Id)
            .FirstOrDefaultAsync(ct);

    private static Error DuplicateName(string name, int? existingId) =>
        AssetSupport.Duplicate("name", $"You already have a report named '{name}'.", existingId);

    private static AssetReportResponse ToResponse(AssetReport report)
    {
        var definition = Parse(report.DefinitionJson);
        return new AssetReportResponse(
            report.Id,
            report.Name,
            definition,
            definition is not null,
            AssetSupport.Encode(report.RowVersion),
            AssetSupport.Utc(report.CreatedAtUtc),
            AssetSupport.Utc(report.ModifiedAtUtc));
    }
}
