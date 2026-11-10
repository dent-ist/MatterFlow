namespace MatterFlow.Data.SchemaMigrations;

/// <summary>Any schema migration failure. Startup must abort when this is thrown.</summary>
public sealed class SchemaMigrationException : Exception
{
    public SchemaMigrationException(string message)
        : base(message)
    {
    }

    public SchemaMigrationException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
