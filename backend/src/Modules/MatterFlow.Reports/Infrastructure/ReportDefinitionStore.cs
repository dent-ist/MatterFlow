using System.Data;
using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>Authoring reads and writes of <c>dbo.ReportDefinition</c> / <c>dbo.ReportVersion</c> with the application connection.</summary>
internal sealed class ReportDefinitionStore(ReportAppConnection app) : IReportDefinitionStore
{
    private const string GetSql =
        """
        SELECT d.ReportId, d.Name, d.IsActive, d.CurrentVersionId, v.VersionNo, v.SqlText, v.SqlHash, v.ParametersJson,
               d.LastPreviewOkVersionId, d.TimeoutSeconds, d.MaxRows, d.RowVersion
        FROM dbo.ReportDefinition d
        LEFT JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId
        WHERE d.ReportId = @reportId
        """;

    public async Task<AuthoringReport?> GetAsync(int reportId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = GetSql;
        command.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = reportId });
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return null;
        return new AuthoringReport(
            reader.GetInt32(0),
            reader.GetString(1),
            reader.GetBoolean(2),
            reader.IsDBNull(3) ? null : reader.GetInt32(3),
            reader.IsDBNull(4) ? null : reader.GetInt32(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.IsDBNull(6) ? null : (byte[])reader.GetValue(6),
            reader.IsDBNull(7) ? null : reader.GetString(7),
            reader.IsDBNull(8) ? null : reader.GetInt32(8),
            reader.IsDBNull(9) ? null : reader.GetInt32(9),
            reader.IsDBNull(10) ? null : reader.GetInt32(10),
            (byte[])reader.GetValue(11));
    }

    public async Task<byte[]?> MarkPreviewOkAsync(int reportId, int versionId, int? userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            UPDATE dbo.ReportDefinition SET LastPreviewOkVersionId = @versionId, ModifiedAt = SYSUTCDATETIME(), ModifiedByUserId = @userId
            OUTPUT INSERTED.RowVersion
            WHERE ReportId = @reportId AND CurrentVersionId = @versionId
            """;
        command.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = reportId });
        command.Parameters.Add(new SqlParameter("@versionId", SqlDbType.Int) { Value = versionId });
        command.Parameters.Add(new SqlParameter("@userId", SqlDbType.Int) { Value = (object?)userId ?? DBNull.Value });
        return await command.ExecuteScalarAsync(cancellationToken) as byte[];
    }

    public async Task<byte[]?> SetActiveAsync(int reportId, bool active, int? userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        // The gate is in the statement itself: a report is never activated unless its current version is the one that passed a preview.
        command.CommandText =
            """
            UPDATE dbo.ReportDefinition SET IsActive = @active, ModifiedAt = SYSUTCDATETIME(), ModifiedByUserId = @userId
            OUTPUT INSERTED.RowVersion
            WHERE ReportId = @reportId
              AND (@active = 0 OR (CurrentVersionId IS NOT NULL AND LastPreviewOkVersionId = CurrentVersionId))
            """;
        command.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = reportId });
        command.Parameters.Add(new SqlParameter("@active", SqlDbType.Bit) { Value = active });
        command.Parameters.Add(new SqlParameter("@userId", SqlDbType.Int) { Value = (object?)userId ?? DBNull.Value });
        return await command.ExecuteScalarAsync(cancellationToken) as byte[];
    }

    public async Task<AddedVersion> AddVersionAsync(int reportId, string sqlText, byte[] sqlHash, string parametersJson, string? changeNote, bool previewedOk, int? userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText =
            """
            DECLARE @lock int = (SELECT ReportId FROM dbo.ReportDefinition WITH (UPDLOCK, HOLDLOCK) WHERE ReportId = @reportId);
            IF @lock IS NULL THROW 50404, 'Report not found.', 1;
            DECLARE @no int = (SELECT ISNULL(MAX(VersionNo), 0) + 1 FROM dbo.ReportVersion WHERE ReportId = @reportId);
            INSERT dbo.ReportVersion (ReportId, VersionNo, SqlText, SqlHash, ParametersJson, ChangeNote, CreatedByUserId)
            VALUES (@reportId, @no, @sql, @hash, @params, @note, @userId);
            DECLARE @v int = SCOPE_IDENTITY();
            UPDATE dbo.ReportDefinition
            SET CurrentVersionId = @v,
                IsActive = CASE WHEN @previewed = 1 THEN IsActive ELSE 0 END,
                LastPreviewOkVersionId = CASE WHEN @previewed = 1 THEN @v ELSE LastPreviewOkVersionId END,
                ModifiedAt = SYSUTCDATETIME(), ModifiedByUserId = @userId
            WHERE ReportId = @reportId;
            SELECT @v AS VersionId, @no AS VersionNo, d.IsActive, d.RowVersion FROM dbo.ReportDefinition d WHERE d.ReportId = @reportId;
            """;
        command.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = reportId });
        command.Parameters.Add(new SqlParameter("@sql", SqlDbType.NVarChar, -1) { Value = sqlText });
        command.Parameters.Add(new SqlParameter("@hash", SqlDbType.Binary, 32) { Value = sqlHash });
        command.Parameters.Add(new SqlParameter("@params", SqlDbType.NVarChar, -1) { Value = parametersJson });
        command.Parameters.Add(new SqlParameter("@note", SqlDbType.NVarChar, 300) { Value = (object?)changeNote ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@previewed", SqlDbType.Bit) { Value = previewedOk });
        command.Parameters.Add(new SqlParameter("@userId", SqlDbType.Int) { Value = (object?)userId ?? DBNull.Value });
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        var added = new AddedVersion(reader.GetInt32(0), reader.GetInt32(1), reader.GetBoolean(2), (byte[])reader.GetValue(3));
        await reader.CloseAsync();
        await transaction.CommitAsync(cancellationToken);
        return added;
    }
}
