using MatterFlow.SharedKernel.Audit;
using MatterFlow.SharedKernel.Entities;

namespace MatterFlow.Configuration.Domain;

/// <summary>A task priority. Tasks reference <see cref="Entity{TKey}.Id"/>, so deactivating one never breaks history.</summary>
[Audited(ObjectType = "Priority")]
public class Priority : AuditedEntity<int>
{
    public string Label { get; set; } = string.Empty;

    /// <summary>Lower is more urgent.</summary>
    public int SortOrder { get; set; }

    /// <summary>Badge color token or <c>#RRGGBB</c> override.</summary>
    public string Color { get; set; } = PriorityColors.Neutral;

    public bool IsActive { get; set; } = true;

    /// <summary>Exactly one priority is the default. Changes are written as explicit PRIORITY_DEFAULT_CHANGED events.</summary>
    [AuditExplicit]
    public bool IsDefault { get; set; }
}

/// <summary>Badge color tokens (docs/ux/tokens.css <c>--mf-pr-*</c>); anything else must be a <c>#RRGGBB</c> override.</summary>
public static class PriorityColors
{
    public const string Critical = "critical";
    public const string High = "high";
    public const string Normal = "normal";
    public const string Low = "low";
    public const string Neutral = "neutral";

    public static readonly IReadOnlyList<string> Tokens = [Critical, High, Normal, Low, Neutral];

    public static bool IsValid(string? value) =>
        value is not null
        && (Tokens.Contains(value, StringComparer.Ordinal)
            || (value.Length == 7 && value[0] == '#' && value.Skip(1).All(Uri.IsHexDigit)));
}

/// <summary>
/// One of the five fixed lifecycle codes with its editable display label. The code is the key and is immutable; rows cannot be
/// created or deleted (also enforced by a database trigger). Not an <see cref="Entity{TKey}"/> because the key is a string.
/// </summary>
[Audited(ObjectType = "StatusLabel")]
public class TaskStatusLabel : IAuditStamped
{
    public string StatusCode { get; set; } = string.Empty;

    public string DisplayLabel { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public DateTime CreatedAtUtc { get; set; }

    public int? CreatedByUserId { get; set; }

    public DateTime? ModifiedAtUtc { get; set; }

    public int? ModifiedByUserId { get; set; }

    public byte[] RowVersion { get; set; } = [];
}

/// <summary>How a Task relates to a linked Asset (Source, Destination, Subject, Result, ...).</summary>
[Audited(ObjectType = "AssetLinkRole")]
public class AssetLinkRole : AuditedEntity<int>
{
    public string Name { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public bool IsActive { get; set; } = true;
}
