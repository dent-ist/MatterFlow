namespace MatterFlow.SharedKernel.Entities;

/// <summary>Non-generic view of the standard audit columns, used by the Data layer to stamp them on save.</summary>
public interface IAuditStamped
{
    DateTime CreatedAtUtc { get; set; }

    int? CreatedByUserId { get; set; }

    DateTime? ModifiedAtUtc { get; set; }

    int? ModifiedByUserId { get; set; }

    byte[] RowVersion { get; set; }
}

/// <summary>Base for all persisted entities. The primary key column is named <c>&lt;Entity&gt;Id</c> by the DbContext convention.</summary>
public abstract class Entity<TKey>
    where TKey : struct, IEquatable<TKey>
{
    public TKey Id { get; set; }
}

/// <summary>
/// Entity with the standard audit columns (CreatedAt/By, ModifiedAt/By; UTC) and an optimistic-concurrency
/// <c>rowversion</c> token (architecture section 10). Audit columns are stamped by the Data layer on save.
/// </summary>
public abstract class AuditedEntity<TKey> : Entity<TKey>, IAuditStamped
    where TKey : struct, IEquatable<TKey>
{
    public DateTime CreatedAtUtc { get; set; }

    public int? CreatedByUserId { get; set; }

    public DateTime? ModifiedAtUtc { get; set; }

    public int? ModifiedByUserId { get; set; }

    /// <summary>SQL Server rowversion. Exposed in DTOs as a base64 string.</summary>
    public byte[] RowVersion { get; set; } = [];
}
