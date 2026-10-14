using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace MatterFlow.Organization.Application;

/// <summary>A Client.</summary>
/// <param name="ClientId">Internal immutable id.</param>
/// <param name="ClientNumber">Normalized zero-padded number, for example <c>00343</c>.</param>
/// <param name="Name">Client name.</param>
/// <param name="IsActive">An inactive Client cannot receive new Matters; existing records keep working.</param>
/// <param name="MatterCount">Number of Matters under the Client.</param>
/// <param name="FormVersionId">The custom-field form version the stored values were captured under; null when none were saved.</param>
/// <param name="PublishedFormVersionId">The currently published custom-field form version (the schema to edit with); null when there is none.</param>
/// <param name="FormValues">Custom-field values keyed by field key; only filled on the detail response (null in lists).</param>
/// <param name="DroppedFields">Keys of values dropped by this save because the form hides them (empty on reads).</param>
/// <param name="RowVersion">Concurrency token (base64); send it back on every update.</param>
/// <param name="CreatedAtUtc">When the Client was created (UTC).</param>
/// <param name="ModifiedAtUtc">When the Client was last changed (UTC), if ever.</param>
public sealed record ClientResponse(
    [property: Required] int ClientId,
    [property: Required] string ClientNumber,
    [property: Required] string Name,
    [property: Required] bool IsActive,
    [property: Required] int MatterCount,
    int? FormVersionId,
    int? PublishedFormVersionId,
    Dictionary<string, JsonElement>? FormValues,
    [property: Required] IReadOnlyList<string> DroppedFields,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? ModifiedAtUtc);

/// <summary>Creates a Client.</summary>
public sealed class CreateClientRequest
{
    /// <summary>1 to 5 digits as issued by the firm's main system; saved zero-padded (<c>343</c> becomes <c>00343</c>).</summary>
    [Required, StringLength(16)]
    public string ClientNumber { get; init; } = string.Empty;

    /// <summary>Client name (max 200).</summary>
    [Required, StringLength(200, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    /// <summary>Custom-field values keyed by field key, validated against the published custom-field form (hidden values are dropped). Null means none.</summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }
}

/// <summary>Updates a Client's name and active flag (the number has its own endpoint).</summary>
public sealed class UpdateClientRequest
{
    [Required, StringLength(200, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    public bool IsActive { get; init; }

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;

    /// <summary>
    /// A patch over the stored custom-field values keyed by field key: a JSON <c>null</c> clears a value, omitted keys stay as they are.
    /// Omit the property to leave the values untouched. Only the changed fields are validated.
    /// </summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }
}

/// <summary>Changes a Client or Matter number (restricted and audited).</summary>
public sealed class ChangeNumberRequest
{
    /// <summary>1 to 5 digits; saved zero-padded.</summary>
    [Required, StringLength(16)]
    public string Number { get; init; } = string.Empty;

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>A Matter with its Client.</summary>
/// <param name="MatterId">Internal id.</param>
/// <param name="ClientId">Owning Client id (cannot change).</param>
/// <param name="ClientNumber">Client number, zero-padded.</param>
/// <param name="ClientName">Client name.</param>
/// <param name="ClientIsActive">False when the Client is inactive.</param>
/// <param name="MatterNumber">Matter number, zero-padded; unique within the Client.</param>
/// <param name="MatterRef">Combined reference <c>00343-00012</c>, computed.</param>
/// <param name="Name">Matter name.</param>
/// <param name="IsActive">Tasks can be created only on an active Matter.</param>
/// <param name="IsSensitive">Display-only warning flag; does not restrict access.</param>
/// <param name="ProjectCount">Number of Projects in the Matter.</param>
/// <param name="OpenTaskCount">Tasks that are not Completed or Cancelled; only filled on the detail response.</param>
/// <param name="FormVersionId">The custom-field form version the stored values were captured under; null when none were saved.</param>
/// <param name="PublishedFormVersionId">The currently published custom-field form version (the schema to edit with); null when there is none.</param>
/// <param name="FormValues">Custom-field values keyed by field key; only filled on the detail response (null in lists).</param>
/// <param name="DroppedFields">Keys of values dropped by this save because the form hides them (empty on reads).</param>
/// <param name="RowVersion">Concurrency token (base64).</param>
/// <param name="CreatedAtUtc">When the Matter was created (UTC).</param>
/// <param name="ModifiedAtUtc">When the Matter was last changed (UTC), if ever.</param>
public sealed record MatterResponse(
    [property: Required] int MatterId,
    [property: Required] int ClientId,
    [property: Required] string ClientNumber,
    [property: Required] string ClientName,
    [property: Required] bool ClientIsActive,
    [property: Required] string MatterNumber,
    [property: Required] string MatterRef,
    [property: Required] string Name,
    [property: Required] bool IsActive,
    [property: Required] bool IsSensitive,
    [property: Required] int ProjectCount,
    int? OpenTaskCount,
    int? FormVersionId,
    int? PublishedFormVersionId,
    Dictionary<string, JsonElement>? FormValues,
    [property: Required] IReadOnlyList<string> DroppedFields,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? ModifiedAtUtc);

/// <summary>Creates a Matter under a Client.</summary>
public sealed class CreateMatterRequest
{
    /// <summary>Owning Client; must be active.</summary>
    [Range(1, int.MaxValue)]
    public int ClientId { get; init; }

    /// <summary>1 to 5 digits; saved zero-padded; unique within the Client.</summary>
    [Required, StringLength(16)]
    public string MatterNumber { get; init; } = string.Empty;

    /// <summary>Matter name (max 300).</summary>
    [Required, StringLength(300, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    /// <summary>Show the sensitive-matter warning banner (display only).</summary>
    public bool IsSensitive { get; init; }

    /// <summary>Custom-field values keyed by field key, validated against the published custom-field form (hidden values are dropped). Null means none.</summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }
}

/// <summary>Updates a Matter's name and sensitivity flag (number and active state have their own endpoints).</summary>
public sealed class UpdateMatterRequest
{
    [Required, StringLength(300, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    public bool IsSensitive { get; init; }

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;

    /// <summary>
    /// A patch over the stored custom-field values keyed by field key: a JSON <c>null</c> clears a value, omitted keys stay as they are.
    /// Omit the property to leave the values untouched. Only the changed fields are validated.
    /// </summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }
}

/// <summary>Sets a Matter or Project active or inactive.</summary>
public sealed class SetActiveRequest
{
    public bool IsActive { get; init; }

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

/// <summary>A Project with its Matter.</summary>
/// <param name="ProjectId">Internal id.</param>
/// <param name="MatterId">Owning Matter id (cannot change).</param>
/// <param name="MatterRef">Matter reference <c>00343-00012</c>.</param>
/// <param name="MatterName">Matter name.</param>
/// <param name="MatterIsActive">False when the Matter is inactive.</param>
/// <param name="Name">Project name, unique within the Matter.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IsActive">False means archived: new Tasks cannot select it.</param>
/// <param name="FormVersionId">The custom-field form version the stored values were captured under; null when none were saved.</param>
/// <param name="PublishedFormVersionId">The currently published custom-field form version (the schema to edit with); null when there is none.</param>
/// <param name="FormValues">Custom-field values keyed by field key; only filled on the detail response (null in lists).</param>
/// <param name="DroppedFields">Keys of values dropped by this save because the form hides them (empty on reads).</param>
/// <param name="RowVersion">Concurrency token (base64).</param>
/// <param name="CreatedAtUtc">When the Project was created (UTC).</param>
/// <param name="ModifiedAtUtc">When the Project was last changed (UTC), if ever.</param>
public sealed record ProjectResponse(
    [property: Required] int ProjectId,
    [property: Required] int MatterId,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] bool MatterIsActive,
    [property: Required] string Name,
    string? Description,
    [property: Required] bool IsActive,
    int? FormVersionId,
    int? PublishedFormVersionId,
    Dictionary<string, JsonElement>? FormValues,
    [property: Required] IReadOnlyList<string> DroppedFields,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? ModifiedAtUtc);

/// <summary>Creates a Project in a Matter.</summary>
public sealed class CreateProjectRequest
{
    [Range(1, int.MaxValue)]
    public int MatterId { get; init; }

    [Required, StringLength(200, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    [StringLength(2000)]
    public string? Description { get; init; }

    /// <summary>Custom-field values keyed by field key, validated against the published custom-field form (hidden values are dropped). Null means none.</summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }
}

/// <summary>Updates a Project's name and description (archive state has its own endpoint).</summary>
public sealed class UpdateProjectRequest
{
    [Required, StringLength(200, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    [StringLength(2000)]
    public string? Description { get; init; }

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;

    /// <summary>
    /// A patch over the stored custom-field values keyed by field key: a JSON <c>null</c> clears a value, omitted keys stay as they are.
    /// Omit the property to leave the values untouched. Only the changed fields are validated.
    /// </summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }
}

/// <summary>The published custom-field form of a Client, Matter or Project.</summary>
/// <param name="PublishedFormVersionId">The published form version to render (fetch its schema from the forms API); null when no custom fields are published.</param>
public sealed record CustomFieldFormResponse(int? PublishedFormVersionId);
