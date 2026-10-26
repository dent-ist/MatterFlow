namespace MatterFlow.Configuration.Contracts.Forms;

/// <summary>One option of a published SELECT field.</summary>
/// <param name="Key">Stable option key (what the filter index stores).</param>
/// <param name="Label">Display text.</param>
public sealed record FormFieldOptionInfo(string Key, string Label);

/// <summary>A field of a published form version as another module needs it (size field choice, report fields, group-by labels).</summary>
/// <param name="Key">Stable field key.</param>
/// <param name="Label">Display label.</param>
/// <param name="Control">Wire name of the control: NUMBER, SELECT, TEXT, ...</param>
/// <param name="IsFilterable">Whether the designer marked the field filterable.</param>
/// <param name="Options">Options of a SELECT, RADIO or MULTISELECT field in display order (empty otherwise).</param>
public sealed record FormFieldInfo(string Key, string Label, string Control, bool IsFilterable, IReadOnlyList<FormFieldOptionInfo> Options)
{
    /// <summary>True for the NUMBER control.</summary>
    public bool IsNumber => Control == "NUMBER";

    /// <summary>True for the SELECT control.</summary>
    public bool IsSelect => Control == "SELECT";
}

/// <summary>Reads the field list of an owner's published form (never creates anything).</summary>
public interface IFormFieldCatalog
{
    /// <summary>The input fields (headings and help blocks excluded) of the owner's PUBLISHED version in display order; empty when there is none.</summary>
    Task<IReadOnlyList<FormFieldInfo>> GetPublishedFieldsAsync(FormOwnerKind ownerKind, int ownerId, CancellationToken cancellationToken = default);

    /// <summary>The same for many owners in one read; owners without a published version are absent.</summary>
    Task<IReadOnlyDictionary<int, IReadOnlyList<FormFieldInfo>>> GetPublishedFieldsAsync(
        FormOwnerKind ownerKind,
        IReadOnlyCollection<int> ownerIds,
        CancellationToken cancellationToken = default);
}

/// <summary>One row of the derived typed index (<c>CustomFieldIndex</c>) that another module may query: text and number values only.</summary>
public sealed class FormIndexRow
{
    /// <summary>The kind of owner.</summary>
    public FormValueOwnerKind OwnerKind { get; init; }

    /// <summary>The owner's id (for example the Asset id).</summary>
    public long OwnerId { get; init; }

    /// <summary>The form definition the value was captured under.</summary>
    public int FormDefinitionId { get; init; }

    /// <summary>Field key.</summary>
    public string FieldKey { get; init; } = string.Empty;

    /// <summary>SELECT option key or text (up to 450 characters).</summary>
    public string? ValueText { get; init; }

    /// <summary>NUMBER value (4 decimals).</summary>
    public decimal? ValueNumber { get; init; }
}

/// <summary>
/// Read access to the typed index for aggregates (Sum, Average, group-by) that are computed in SQL, composed with the caller's own queries on the same
/// context. Asset forms index every NUMBER and SELECT field whether or not it is filterable.
/// </summary>
public interface IFormIndexReader
{
    /// <summary>The index rows of one owner kind, as a query to join and aggregate.</summary>
    IQueryable<FormIndexRow> Rows(FormValueOwnerKind ownerKind);
}

/// <summary>Rebuilds the derived index from the stored values (idempotent).</summary>
public interface IFormIndexMaintenance
{
    /// <summary>Rewrites the index rows of every value set of the definition; returns the number of value sets processed.</summary>
    Task<int> ReindexAsync(FormValueOwnerKind ownerKind, int formDefinitionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Rewrites the index of the value sets of the kind that have no index row at all (values saved before the indexing rule changed); returns the number
    /// of value sets processed. A set whose fields yield nothing to index is looked at again on the next call, which is cheap.
    /// </summary>
    Task<int> ReindexMissingAsync(FormValueOwnerKind ownerKind, CancellationToken cancellationToken = default);
}
