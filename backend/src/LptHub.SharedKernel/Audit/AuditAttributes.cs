namespace MatterFlow.SharedKernel.Audit;

/// <summary>
/// Marks an entity whose property changes are recorded as field-level <c>FIELD_CHANGED</c> AuditEvents by the Data layer's
/// SaveChanges interceptor (architecture section 9). Excluded automatically: keys, rowversion/computed columns and the standard
/// audit stamp columns.
/// </summary>
[AttributeUsage(AttributeTargets.Class, Inherited = true)]
public sealed class AuditedAttribute : Attribute
{
    /// <summary>Overrides the AuditEvent <c>ObjectType</c> (max 40 chars); defaults to the CLR type name.</summary>
    public string? ObjectType { get; init; }
}

/// <summary>
/// Marks a property of an <see cref="AuditedAttribute"/> entity whose changes are written as explicit semantic events
/// (via <c>IAuditWriter</c>), so the interceptor must not also write a generic field event for it.
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class AuditExplicitAttribute : Attribute;

/// <summary>
/// Marks a string property holding a JSON object (e.g. FormValuesJson). Changes are diffed per top-level key and recorded
/// with <c>FieldKey = "&lt;prefix&gt;:&lt;key&gt;"</c> (e.g. <c>form:ocr_language</c>).
/// </summary>
/// <param name="prefix">Field key prefix.</param>
[AttributeUsage(AttributeTargets.Property)]
public sealed class AuditJsonFieldsAttribute(string prefix) : Attribute
{
    public string Prefix { get; } = prefix;
}

/// <summary>Optional: lets an audited entity expose the denormalized Matter/Task scope stored on its AuditEvents.</summary>
public interface IAuditScoped
{
    int? AuditMatterId { get; }

    long? AuditTaskId { get; }
}
