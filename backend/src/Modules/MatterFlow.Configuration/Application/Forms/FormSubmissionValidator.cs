using System.Text.Json;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms.Rules;
using MatterFlow.SharedKernel.Results;

namespace MatterFlow.Configuration.Application.Forms;

/// <summary>Validates submitted values against a stored form version with the authoritative evaluator (<see cref="IFormSubmissionValidator"/>).</summary>
internal sealed class FormSubmissionValidator(FormSchemaLoader loader) : IFormSubmissionValidator
{
    public async Task<Result<FormSubmissionResult>> ValidateAsync(
        int formVersionId,
        IReadOnlyDictionary<string, JsonElement> values,
        FormSubmissionOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(values);

        var form = await loader.LoadAsync(formVersionId, cancellationToken);
        if (form.IsFailure)
        {
            return Result<FormSubmissionResult>.Failure(form.Error!);
        }

        return Evaluate(form.Value, values, options ?? new FormSubmissionOptions());
    }

    /// <summary>The evaluation shared by the validator and the value store.</summary>
    internal static FormSubmissionResult Evaluate(LoadedForm form, IReadOnlyDictionary<string, JsonElement> submitted, FormSubmissionOptions options)
    {
        var schema = form.Schema;
        var inputKeys = schema.Definitions.Where(d => d.Control.IsInput()).Select(d => d.Key).ToHashSet(StringComparer.Ordinal);

        // Merge: stored values the version knows, then the submitted patch. Stored keys it does not know are preserved, never evaluated.
        var merged = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        var preserved = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        if (options.ExistingValues is { } existing)
        {
            foreach (var (key, value) in existing)
            {
                (inputKeys.Contains(key) ? merged : preserved)[key] = value;
            }
        }

        foreach (var (key, value) in submitted)
        {
            if (value.ValueKind == JsonValueKind.Null && inputKeys.Contains(key))
            {
                merged.Remove(key); // an explicit null clears the stored value
            }
            else
            {
                merged[key] = value;
                preserved.Remove(key);
            }
        }

        var mode = options.Mode == FormSubmissionMode.Draft ? FormEvaluationMode.Draft : FormEvaluationMode.Submit;
        var result = FormEvaluator.Evaluate(schema, FormValues.From(merged), mode);

        var only = options.ValidateOnly is null ? null : options.ValidateOnly.ToHashSet(StringComparer.Ordinal);
        var errors = result.Errors
            .Where(e => only is null
                || e.Code == FormErrorCode.UnknownField
                || only.Contains(e.FieldKey)
                || (options.RequireAllWhenChanged && only.Count > 0 && e.Code == FormErrorCode.Required))
            .Select(e => new FormSubmissionError(e.FieldKey, e.Code.ToWireName(), e.Message))
            .ToList();

        var dropped = merged
            .Where(p => inputKeys.Contains(p.Key) && result.Visible.TryGetValue(p.Key, out var visible) && !visible && !FormValueRules.IsEmpty(p.Value))
            .Select(p => p.Key)
            .ToList();

        var normalized = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var (key, value) in result.Normalized)
        {
            normalized[key] = value;
        }

        if (only is not null)
        {
            // Unchanged values that are not valid today (for example written before a rule tightened) stay as stored instead of vanishing.
            foreach (var (key, value) in merged)
            {
                if (!only.Contains(key) && !normalized.ContainsKey(key) && result.Visible.TryGetValue(key, out var visible) && visible && !FormValueRules.IsEmpty(value))
                {
                    normalized[key] = value;
                }
            }
        }

        var index = FormIndexExtractor.Extract(schema, FormValues.From(normalized.Where(p => inputKeys.Contains(p.Key))))
            .Select(e => new FormIndexValue(e.FieldKey, e.ValueText, e.ValueNumber, e.ValueDate, e.ValueDateTime, e.ValueBool))
            .ToList();

        foreach (var (key, value) in preserved)
        {
            normalized[key] = value;
        }

        return new FormSubmissionResult(form.Version.FormVersionId, form.Version.FormDefinitionId, errors, normalized, dropped, index);
    }
}
