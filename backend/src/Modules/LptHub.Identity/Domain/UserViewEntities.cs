namespace MatterFlow.Identity.Domain;

/// <summary>
/// A person's remembered screen state (<see cref="Name"/> null: one row per person and surface) or a named saved view (script 41). Personal
/// preferences, not audited. <see cref="StateJson"/> is opaque to the server apart from being a JSON object of at most 4 KB.
/// </summary>
public class UserView
{
    public long Id { get; set; }

    public int UserId { get; set; }

    public string Surface { get; set; } = string.Empty;

    public string? Name { get; set; }

    public bool IsDefault { get; set; }

    public string StateJson { get; set; } = "{}";

    public DateTime CreatedAtUtc { get; set; }

    public DateTime ModifiedAtUtc { get; set; }

    public byte[] RowVersion { get; set; } = [];
}
