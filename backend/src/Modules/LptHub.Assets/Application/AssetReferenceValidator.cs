using System.Globalization;
using MatterFlow.Assets.Domain;
using MatterFlow.Configuration.Contracts.Forms;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Assets.Application;

/// <summary>
/// ASSET_REF values (SEC2-04): the Asset must exist and be active, and belong to the same Matter as the Task or object that holds the value.
/// The ids of other Matters' Assets are reported exactly like missing ones when they are inactive; a cross-Matter id gets its own code.
/// </summary>
internal sealed class AssetReferenceValidator(DbContext db, AssetAccess access) : IFormReferenceValidator
{
    public FormReferenceKind Kind => FormReferenceKind.Asset;

    public async Task<IReadOnlyList<FormSubmissionError>> ValidateAsync(IReadOnlyList<FormReferenceValue> references, FormReferenceContext context, CancellationToken cancellationToken = default)
    {
        var ids = references.Where(r => r.Id <= int.MaxValue).Select(r => (int)r.Id).Distinct().ToList();
        // An asset the caller may not see (sensitive-matter rule, mode A) is reported exactly like a missing one.
        var found = await access.Visible(db.Set<Asset>().AsNoTracking())
            .Where(a => ids.Contains(a.Id))
            .Select(a => new { a.Id, a.MatterId, a.IsActive })
            .ToDictionaryAsync(a => a.Id, cancellationToken);

        var errors = new List<FormSubmissionError>();
        foreach (var reference in references)
        {
            if (reference.Id > int.MaxValue || !found.TryGetValue((int)reference.Id, out var asset) || !asset.IsActive)
            {
                errors.Add(new FormSubmissionError(reference.FieldKey, FormReferenceCodes.InvalidReference, string.Create(CultureInfo.InvariantCulture, $"Asset {reference.Id} does not exist or is not active.")));
            }
            else if (context.MatterId is { } matterId && asset.MatterId != matterId)
            {
                errors.Add(new FormSubmissionError(reference.FieldKey, FormReferenceCodes.CrossMatterReference, "The asset belongs to another matter."));
            }
        }

        return errors;
    }
}
