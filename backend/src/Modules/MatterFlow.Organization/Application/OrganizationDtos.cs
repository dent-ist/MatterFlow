using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace MatterFlow.Organization.Application;

/// <summary>A Client.</summary>
/// <param name="ClientId">Internal immutable id.</param>
/// <param name="ClientNumber">Normalized zero-padded number, for example <c>00343</c>.</param>
/// <param name="Name">Client name.</param>
/// <param name="IsActive">An inactive Client cannot receive new Matters; existing records keep working.</param>
/// <param name="MatterCount">Number of Matters under the Client.</param>
/// <param name="OpenTaskCount">Open Tasks (New, In Progress, On Hold) of all the Client's Matters, project Tasks included; null when the viewer lacks <c>Task.View</c>.</param>
/// <param name="OverdueTaskCount">Open Tasks past their due moment in the viewer's time zone (same rule as the Dashboard and the Task Queue); null when the viewer lacks <c>Task.View</c>.</param>
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
    int? OpenTaskCount,
    int? OverdueTaskCount,
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
/// <param name="PrimaryManager">The Primary project manager; null when none is set (normal, not a warning).</param>
/// <param name="SecondaryManager">The Secondary project manager (same rights as the Primary); null when none is set. May be set without a Primary.</param>
/// <param name="ProjectCount">Number of Projects in the Matter.</param>
/// <param name="OpenTaskCount">Open Tasks (New, In Progress, On Hold) of the Matter, project Tasks included; null when the viewer lacks <c>Task.View</c>.</param>
/// <param name="OverdueTaskCount">Open Tasks past their due moment in the viewer's time zone; null when the viewer lacks <c>Task.View</c>.</param>
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
    MatterManagerResponse? PrimaryManager,
    MatterManagerResponse? SecondaryManager,
    [property: Required] int ProjectCount,
    int? OpenTaskCount,
    int? OverdueTaskCount,
    int? FormVersionId,
    int? PublishedFormVersionId,
    Dictionary<string, JsonElement>? FormValues,
    [property: Required] IReadOnlyList<string> DroppedFields,
    [property: Required] string RowVersion,
    [property: Required] DateTime CreatedAtUtc,
    DateTime? ModifiedAtUtc);

/// <summary>A matter's project manager as lists and headers show them.</summary>
/// <param name="UserId">User id.</param>
/// <param name="DisplayName">Display name (history keeps the name of a user who has since been disabled).</param>
/// <param name="IsActive">False once the user is disabled; the person stays on the matter until someone changes it.</param>
public sealed record MatterManagerResponse(
    [property: Required] int UserId,
    [property: Required] string DisplayName,
    [property: Required] bool IsActive);

/// <summary>Sets or clears a matter's project managers. Both values are replaced: leave one out (or null) to clear it.</summary>
public sealed class SetMatterManagersRequest
{
    /// <summary>The Primary project manager (an active user holding <c>Matter.BeManager</c>), or null for none. An unchanged current value is always accepted, also for a person who has lost the role since.</summary>
    [Range(1, int.MaxValue)]
    public int? PrimaryManagerId { get; init; }

    /// <summary>The Secondary project manager (same rules as the Primary; different from it), or null for none. Allowed without a Primary.</summary>
    [Range(1, int.MaxValue)]
    public int? SecondaryManagerId { get; init; }

    /// <summary>The <c>rowVersion</c> last read (the matters list carries it per row, so a bulk change sends each row's own).</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;
}

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

    /// <summary>Mark the matter sensitive: a warning banner, and with sensitive-matter access control on, visible only to its managers and holders of <c>Matter.ViewSensitive</c> (and people assigned a task on it). Without <c>Matter.ViewSensitive</c> a manager must be named (400 <c>SENSITIVE_NEEDS_MANAGER</c>).</summary>
    public bool IsSensitive { get; init; }

    /// <summary>Optional Primary project manager. Accepted only with <c>Matter.AssignManagers</c> (403 otherwise); an active user holding <c>Matter.BeManager</c>.</summary>
    [Range(1, int.MaxValue)]
    public int? PrimaryManagerId { get; init; }

    /// <summary>Optional Secondary project manager (same rules; different from the Primary).</summary>
    [Range(1, int.MaxValue)]
    public int? SecondaryManagerId { get; init; }

    /// <summary>Custom-field values keyed by field key, validated against the published custom-field form (hidden values are dropped). Null means none.</summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }
}

/// <summary>Updates a Matter's name and sensitivity flag (number and active state have their own endpoints).</summary>
public sealed class UpdateMatterRequest
{
    [Required, StringLength(300, MinimumLength = 1)]
    public string Name { get; init; } = string.Empty;

    public bool IsSensitive { get; init; }

    /// <summary>
    /// True to go ahead when marking the matter sensitive would end the caller's own access to it (the caller is neither a manager of it afterwards nor holds
    /// <c>Matter.ViewSensitive</c>). Without it the server answers 409 <c>SENSITIVE_CONFIRMATION_REQUIRED</c>, which the screen turns into a confirmation
    /// dialog. Ignored while sensitive-matter access control is off.
    /// </summary>
    public bool ConfirmLossOfAccess { get; init; }

    /// <summary>The <c>rowVersion</c> last read.</summary>
    [Required]
    public string RowVersion { get; init; } = string.Empty;

    /// <summary>
    /// A patch over the stored custom-field values keyed by field key: a JSON <c>null</c> clears a value, omitted keys stay as they are.
    /// Omit the property to leave the values untouched. Only the changed fields are validated.
    /// </summary>
    public Dictionary<string, JsonElement>? FormValues { get; init; }

    /// <summary>Sets the Primary project manager when given (needs <c>Matter.AssignManagers</c>, 403 otherwise). Omitted means unchanged; to clear a manager use <c>PUT /matters/{id}/managers</c>.</summary>
    [Range(1, int.MaxValue)]
    public int? PrimaryManagerId { get; init; }

    /// <summary>Sets the Secondary project manager when given; same rules as <see cref="PrimaryManagerId"/>.</summary>
    [Range(1, int.MaxValue)]
    public int? SecondaryManagerId { get; init; }
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
/// <param name="ClientNumber">Number of the Matter's Client, zero-padded.</param>
/// <param name="ClientName">Name of the Matter's Client.</param>
/// <param name="MatterRef">Matter reference <c>00343-00012</c>.</param>
/// <param name="MatterName">Matter name.</param>
/// <param name="MatterIsActive">False when the Matter is inactive.</param>
/// <param name="Name">Project name, unique within the Matter.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IsActive">False means archived: new Tasks cannot select it.</param>
/// <param name="OpenTaskCount">Open Tasks (New, In Progress, On Hold) of the Project; null when the viewer lacks <c>Task.View</c>.</param>
/// <param name="OverdueTaskCount">Open Tasks past their due moment in the viewer's time zone; null when the viewer lacks <c>Task.View</c>.</param>
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
    [property: Required] string ClientNumber,
    [property: Required] string ClientName,
    [property: Required] string MatterRef,
    [property: Required] string MatterName,
    [property: Required] bool MatterIsActive,
    [property: Required] string Name,
    string? Description,
    [property: Required] bool IsActive,
    int? OpenTaskCount,
    int? OverdueTaskCount,
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

/// <summary>A Matter in a Client's "most open tasks" list.</summary>
/// <param name="MatterId">Matter id (the link target).</param>
/// <param name="Reference">Matter reference <c>00343-00012</c>.</param>
/// <param name="Name">Matter name.</param>
/// <param name="IsActive">False when the Matter is inactive.</param>
/// <param name="OpenTasks">Open Tasks of the Matter, project Tasks included.</param>
/// <param name="Overdue">Overdue Tasks of the Matter.</param>
public sealed record TopMatterResponse(
    [property: Required] int MatterId,
    [property: Required] string Reference,
    [property: Required] string Name,
    [property: Required] bool IsActive,
    [property: Required] int OpenTasks,
    [property: Required] int Overdue);

/// <summary>
/// Counts for the Client overview strip, in the Dashboard and Task Queue vocabulary and the viewer's time zone. The five Task numbers are null when
/// the viewer lacks <c>Task.View</c> (the response is still 200).
/// </summary>
/// <param name="ClientId">The Client.</param>
/// <param name="OpenTasks">Tasks that are New, In Progress or On Hold, over all the Client's Matters (project Tasks included).</param>
/// <param name="Overdue">Open Tasks past their due moment.</param>
/// <param name="Asap">Open Tasks with no due date.</param>
/// <param name="OnHold">Tasks On Hold.</param>
/// <param name="DueSoon">Open Tasks that are not overdue and not ASAP, due today to two days ahead (the Dashboard's Due soon).</param>
/// <param name="MatterCount">Number of Matters under the Client.</param>
/// <param name="ActiveMatterCount">Number of active Matters under the Client.</param>
/// <param name="TopMatters">Up to 5 Matters with open Tasks, most open first, then most overdue, then by reference. Null when the viewer lacks <c>Task.View</c> or <c>Matter.View</c> (a Matter is never listed without a link target).</param>
public sealed record ClientSummaryResponse(
    [property: Required] int ClientId,
    int? OpenTasks,
    int? Overdue,
    int? Asap,
    int? OnHold,
    int? DueSoon,
    [property: Required] int MatterCount,
    [property: Required] int ActiveMatterCount,
    IReadOnlyList<TopMatterResponse>? TopMatters);

/// <summary>Counts for the Matter overview strip; the five Task numbers are null when the viewer lacks <c>Task.View</c>. Same meaning as <see cref="ClientSummaryResponse"/>, over the Matter's Tasks (project Tasks included).</summary>
/// <param name="MatterId">The Matter.</param>
/// <param name="OpenTasks">Tasks that are New, In Progress or On Hold.</param>
/// <param name="Overdue">Open Tasks past their due moment.</param>
/// <param name="Asap">Open Tasks with no due date.</param>
/// <param name="OnHold">Tasks On Hold.</param>
/// <param name="DueSoon">Open Tasks that are not overdue and not ASAP, due today to two days ahead.</param>
/// <param name="Unassigned">Open Tasks with no person assigned (the Task Queue's <c>unassigned=true</c>); null without <c>Task.View</c>.</param>
/// <param name="ProjectCount">Number of Projects in the Matter (archived included).</param>
/// <param name="AssetCount">Number of Assets of the Matter (retired included).</param>
public sealed record MatterSummaryResponse(
    [property: Required] int MatterId,
    int? OpenTasks,
    int? Overdue,
    int? Asap,
    int? OnHold,
    int? DueSoon,
    int? Unassigned,
    [property: Required] int ProjectCount,
    [property: Required] int AssetCount);

/// <summary>Counts for the Project overview strip; the five Task numbers are null when the viewer lacks <c>Task.View</c>. Same meaning as <see cref="ClientSummaryResponse"/>, over the Project's Tasks.</summary>
/// <param name="ProjectId">The Project.</param>
/// <param name="OpenTasks">Tasks that are New, In Progress or On Hold.</param>
/// <param name="Overdue">Open Tasks past their due moment.</param>
/// <param name="Asap">Open Tasks with no due date.</param>
/// <param name="OnHold">Tasks On Hold.</param>
/// <param name="DueSoon">Open Tasks that are not overdue and not ASAP, due today to two days ahead.</param>
public sealed record ProjectSummaryResponse(
    [property: Required] int ProjectId,
    int? OpenTasks,
    int? Overdue,
    int? Asap,
    int? OnHold,
    int? DueSoon);
