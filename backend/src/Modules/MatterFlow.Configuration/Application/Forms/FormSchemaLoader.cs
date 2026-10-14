using System.Collections.Concurrent;
using MatterFlow.Configuration.Contracts.Forms;
using MatterFlow.Configuration.Domain.Forms;
using MatterFlow.Configuration.Domain.Forms.Rules;
using MatterFlow.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Configuration.Application.Forms;

/// <summary>Process-wide cache of compiled schemas of immutable (published or retired) versions; they never change, so entries never expire (architecture 7.2).</summary>
public sealed class FormSchemaCache
{
    private readonly ConcurrentDictionary<int, FormSchema> _schemas = new();

    internal bool TryGet(int formVersionId, out FormSchema schema) => _schemas.TryGetValue(formVersionId, out schema!);

    internal void Set(int formVersionId, FormSchema schema) => _schemas[formVersionId] = schema;

    /// <summary>Number of cached versions (diagnostics and tests).</summary>
    public int Count => _schemas.Count;
}

/// <summary>A form version ready to evaluate.</summary>
/// <param name="Version">Version facts.</param>
/// <param name="Schema">The compiled schema.</param>
internal sealed record LoadedForm(FormVersionRef Version, FormSchema Schema);

/// <summary>Loads and compiles form versions, using <see cref="FormSchemaCache"/> for immutable ones.</summary>
internal sealed class FormSchemaLoader(DbContext db, FormSchemaCache cache)
{
    /// <summary>Loads a version for evaluation. NOT_FOUND for an unknown id; a draft whose definition does not compile is reported as PUBLISH_VALIDATION_FAILED.</summary>
    public async Task<Result<LoadedForm>> LoadAsync(int formVersionId, CancellationToken cancellationToken)
    {
        var head = await db.Set<FormVersion>().AsNoTracking()
            .Where(v => v.Id == formVersionId)
            .Select(v => new FormVersionRef(v.FormDefinitionId, v.Id, v.VersionNo, v.Status))
            .SingleOrDefaultAsync(cancellationToken);
        if (head is null)
        {
            return Error.NotFound($"Form version {formVersionId} does not exist.");
        }

        if (head.Status != FormVersionStatus.Draft && cache.TryGet(formVersionId, out var cached))
        {
            return new LoadedForm(head, cached);
        }

        var fields = await db.Set<FormField>().AsNoTracking()
            .Include(f => f.Options)
            .Where(f => f.FormVersionId == formVersionId)
            .ToListAsync(cancellationToken);
        var compiled = FormSchema.Compile(FormSpecs.ToDefinitions(FormSpecs.FromEntities(fields)));
        if (compiled.Schema is null)
        {
            var codes = string.Join(", ", compiled.Errors.Select(e => e.Code.ToWireName()).Distinct());
            return Error.Validation($"Form version {formVersionId} is not a valid definition ({codes}).", code: ErrorCodes.PublishValidationFailed);
        }

        if (head.Status != FormVersionStatus.Draft)
        {
            cache.Set(formVersionId, compiled.Schema);
        }

        return new LoadedForm(head, compiled.Schema);
    }
}
