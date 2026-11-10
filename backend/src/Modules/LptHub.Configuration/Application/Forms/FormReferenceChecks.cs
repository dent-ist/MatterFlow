using System.Globalization;
using System.Text.Json;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms.Rules;
using MatterFlow.Identity.Contracts;

namespace MatterFlow.Configuration.Application.Forms;

/// <summary>
/// Runs the reference checks (ASSET_REF, USER_REF; SEC2-04) behind the pure rule evaluator: the evaluator only knows that such a value is a
/// positive integer. Checks only the fields that are visible, valid and (with <c>ValidateOnly</c>) changed, so stored legacy values never block an unrelated edit.
/// </summary>
internal static class FormReferenceChecks
{
    public static async Task<FormSubmissionResult> ApplyAsync(
        IEnumerable<IFormReferenceValidator> validators,
        LoadedForm form,
        FormSubmissionResult result,
        IReadOnlyCollection<string>? only,
        FormReferenceContext? context,
        CancellationToken cancellationToken)
    {
        if (context is null)
        {
            return result;
        }

        var byKind = new Dictionary<FormReferenceKind, List<FormReferenceValue>>();
        foreach (var definition in form.Schema.Definitions)
        {
            var kind = definition.Control switch
            {
                FormControl.AssetRef => FormReferenceKind.Asset,
                FormControl.UserRef => FormReferenceKind.User,
                _ => (FormReferenceKind?)null,
            };
            if (kind is null
                || (only is not null && !only.Contains(definition.Key))
                || !result.NormalizedValues.TryGetValue(definition.Key, out var value)
                || value.ValueKind != JsonValueKind.Number
                || !value.TryGetDouble(out var number))
            {
                continue;
            }

            var id = (long)number;

            if (!byKind.TryGetValue(kind.Value, out var list))
            {
                byKind[kind.Value] = list = [];
            }

            list.Add(new FormReferenceValue(definition.Key, id));
        }

        if (byKind.Count == 0)
        {
            return result;
        }

        var errors = new List<FormSubmissionError>(result.Errors);
        foreach (var (kind, references) in byKind)
        {
            var validator = validators.FirstOrDefault(v => v.Kind == kind);
            if (validator is null)
            {
                // Fail closed: a reference field whose owner module is not registered cannot be trusted.
                errors.AddRange(references.Select(r => new FormSubmissionError(r.FieldKey, FormReferenceCodes.InvalidReference, "The reference cannot be checked.")));
                continue;
            }

            errors.AddRange(await validator.ValidateAsync(references, context, cancellationToken));
        }

        return result with { Errors = errors };
    }
}

/// <summary>USER_REF: the user must exist and be active. Assignable users are not restricted further (Access Pending users are active).</summary>
internal sealed class UserReferenceValidator(IUserDirectory users) : IFormReferenceValidator
{
    public FormReferenceKind Kind => FormReferenceKind.User;

    public async Task<IReadOnlyList<FormSubmissionError>> ValidateAsync(IReadOnlyList<FormReferenceValue> references, FormReferenceContext context, CancellationToken cancellationToken = default)
    {
        var ids = references.Where(r => r.Id <= int.MaxValue).Select(r => (int)r.Id).Distinct().ToList();
        var found = await users.FindManyAsync(ids, cancellationToken);
        return
        [
            .. references
                .Where(r => r.Id > int.MaxValue || !found.TryGetValue((int)r.Id, out var user) || !user.IsActive)
                .Select(r => new FormSubmissionError(r.FieldKey, FormReferenceCodes.InvalidReference, string.Create(CultureInfo.InvariantCulture, $"User {r.Id} does not exist or is not active."))),
        ];
    }
}
