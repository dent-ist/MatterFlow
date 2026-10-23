using System.Data;
using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>Writes report events to the append-only <c>dbo.AuditEvent</c> with the application connection, inside the caller's transaction so the change and its audit row stand or fall together.</summary>
internal static class ReportAuditSql
{
    private const string Insert =
        """
        INSERT dbo.AuditEvent (ActorUserId, EventType, ObjectType, ObjectId, FieldKey, OldValue, NewValue, Summary, CorrelationId)
        VALUES (@actor, @eventType, @objectType, @objectId, @fieldKey, @old, @new, @summary, @correlation)
        """;

    public static async Task WriteAsync(SqlConnection connection, SqlTransaction? transaction, int? actorUserId, Guid correlationId, ReportAuditEntry entry, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = Insert;
        command.Parameters.Add(new SqlParameter("@actor", SqlDbType.Int) { Value = (object?)actorUserId ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@eventType", SqlDbType.VarChar, 64) { Value = entry.EventType });
        command.Parameters.Add(new SqlParameter("@objectType", SqlDbType.VarChar, 40) { Value = entry.ObjectType });
        command.Parameters.Add(new SqlParameter("@objectId", SqlDbType.VarChar, 40) { Value = entry.ReportId.ToString(System.Globalization.CultureInfo.InvariantCulture) });
        command.Parameters.Add(new SqlParameter("@fieldKey", SqlDbType.VarChar, 100) { Value = (object?)entry.FieldKey ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@old", SqlDbType.NVarChar, -1) { Value = (object?)entry.OldValue ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@new", SqlDbType.NVarChar, -1) { Value = (object?)entry.NewValue ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@summary", SqlDbType.NVarChar, 500) { Value = entry.Summary });
        command.Parameters.Add(new SqlParameter("@correlation", SqlDbType.UniqueIdentifier) { Value = correlationId });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
