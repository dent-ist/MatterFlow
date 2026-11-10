using System.Data;
using System.Text.Json;
using MatterFlow.Audit.Contracts;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>Authoring reads and writes of <c>dbo.ReportDefinition</c> / <c>dbo.ReportVersion</c> with the application connection.</summary>
internal sealed class ReportDefinitionStore(ReportAppConnection app, IAuditCorrelation correlation) : IReportDefinitionStore
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
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        // The gate is in the statement itself: a report is never activated unless its current version is the one that passed a preview.
        command.CommandText =
            """
            UPDATE d SET IsActive = @active, ModifiedAt = SYSUTCDATETIME(), ModifiedByUserId = @userId
            OUTPUT INSERTED.RowVersion, DELETED.IsActive, INSERTED.Name, INSERTED.CurrentVersionId
            FROM dbo.ReportDefinition d
            WHERE d.ReportId = @reportId
              AND (@active = 0 OR (d.CurrentVersionId IS NOT NULL AND d.LastPreviewOkVersionId = d.CurrentVersionId))
            """;
        command.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = reportId });
        command.Parameters.Add(new SqlParameter("@active", SqlDbType.Bit) { Value = active });
        command.Parameters.Add(new SqlParameter("@userId", SqlDbType.Int) { Value = (object?)userId ?? DBNull.Value });
        byte[] rowVersion;
        bool wasActive;
        string name;
        int? currentVersionId;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
                return null;
            rowVersion = (byte[])reader.GetValue(0);
            wasActive = reader.GetBoolean(1);
            name = reader.GetString(2);
            currentVersionId = reader.IsDBNull(3) ? null : reader.GetInt32(3);
        }

        if (wasActive != active)
        {
            var versionNo = 0;
            if (currentVersionId is { } versionId)
            {
                await using var lookup = connection.CreateCommand();
                lookup.Transaction = transaction;
                lookup.CommandText = "SELECT VersionNo FROM dbo.ReportVersion WHERE ReportVersionId = @v";
                lookup.Parameters.Add(new SqlParameter("@v", SqlDbType.Int) { Value = versionId });
                versionNo = Convert.ToInt32(await lookup.ExecuteScalarAsync(cancellationToken) ?? 0, System.Globalization.CultureInfo.InvariantCulture);
            }

            var entry = active ? ReportAuditEntry.Activated(reportId, name, versionNo) : ReportAuditEntry.Deactivated(reportId, name, "");
            await ReportAuditSql.WriteAsync(connection, transaction, userId, correlation.Id, entry, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return rowVersion;
    }

    public async Task<StoreResult<SaveOutcome>> SaveAsync(SaveDefinition save, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);

        Current current;
        await using (var read = connection.CreateCommand())
        {
            read.Transaction = transaction;
            read.CommandText =
                """
                SELECT d.Name, d.ReportCategoryId, c.Name, d.Description, d.HelpText, d.SortOrder, d.TimeoutSeconds, d.MaxRows, d.IsActive, d.RowVersion,
                       v.VersionNo, v.SqlHash, v.ParametersJson
                FROM dbo.ReportDefinition d WITH (UPDLOCK, HOLDLOCK)
                JOIN dbo.ReportCategory c ON c.ReportCategoryId = d.ReportCategoryId
                LEFT JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId
                WHERE d.ReportId = @reportId
                """;
            read.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = save.ReportId });
            await using var reader = await read.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
                return StoreResult<SaveOutcome>.Fail(StoreStatus.NotFound);
            current = new Current(
                reader.GetString(0),
                reader.GetInt32(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetInt32(5),
                reader.IsDBNull(6) ? null : reader.GetInt32(6),
                reader.IsDBNull(7) ? null : reader.GetInt32(7),
                reader.GetBoolean(8),
                (byte[])reader.GetValue(9),
                reader.IsDBNull(10) ? null : reader.GetInt32(10),
                reader.IsDBNull(11) ? null : (byte[])reader.GetValue(11),
                reader.IsDBNull(12) ? null : reader.GetString(12));
        }

        if (save.ExpectedRowVersion is { } expected && !expected.AsSpan().SequenceEqual(current.RowVersion))
            return StoreResult<SaveOutcome>.Fail(StoreStatus.Conflict);

        var name = current.Name;
        var audits = new List<ReportAuditEntry>();
        if (save.Details is { } details && details != new ReportDetails(current.Name, current.CategoryId, current.Description, current.HelpText, current.SortOrder, current.TimeoutSeconds, current.MaxRows))
        {
            string newCategoryName = current.CategoryName;
            if (details.CategoryId != current.CategoryId)
            {
                await using var category = connection.CreateCommand();
                category.Transaction = transaction;
                category.CommandText = "SELECT Name FROM dbo.ReportCategory WHERE ReportCategoryId = @c AND IsActive = 1";
                category.Parameters.Add(new SqlParameter("@c", SqlDbType.Int) { Value = details.CategoryId });
                if (await category.ExecuteScalarAsync(cancellationToken) is not string categoryName)
                    return StoreResult<SaveOutcome>.Fail(StoreStatus.CategoryInvalid);
                newCategoryName = categoryName;
            }

            await using var update = connection.CreateCommand();
            update.Transaction = transaction;
            update.CommandText =
                """
                UPDATE dbo.ReportDefinition
                SET Name = @name, ReportCategoryId = @category, Description = @description, HelpText = @help, SortOrder = @sort,
                    TimeoutSeconds = @timeout, MaxRows = @maxRows, ModifiedAt = SYSUTCDATETIME(), ModifiedByUserId = @userId
                WHERE ReportId = @reportId
                """;
            update.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = save.ReportId });
            update.Parameters.Add(new SqlParameter("@name", SqlDbType.NVarChar, 150) { Value = details.Name });
            update.Parameters.Add(new SqlParameter("@category", SqlDbType.Int) { Value = details.CategoryId });
            update.Parameters.Add(new SqlParameter("@description", SqlDbType.NVarChar, 1000) { Value = (object?)details.Description ?? DBNull.Value });
            update.Parameters.Add(new SqlParameter("@help", SqlDbType.NVarChar, -1) { Value = (object?)details.HelpText ?? DBNull.Value });
            update.Parameters.Add(new SqlParameter("@sort", SqlDbType.Int) { Value = details.SortOrder });
            update.Parameters.Add(new SqlParameter("@timeout", SqlDbType.Int) { Value = (object?)details.TimeoutSeconds ?? DBNull.Value });
            update.Parameters.Add(new SqlParameter("@maxRows", SqlDbType.Int) { Value = (object?)details.MaxRows ?? DBNull.Value });
            update.Parameters.Add(new SqlParameter("@userId", SqlDbType.Int) { Value = (object?)save.UserId ?? DBNull.Value });
            try
            {
                await update.ExecuteNonQueryAsync(cancellationToken);
            }
            catch (SqlException ex) when (ex.Number is 2627 or 2601)
            {
                return StoreResult<SaveOutcome>.Fail(StoreStatus.DuplicateName);
            }

            name = details.Name;
            if (details.CategoryId != current.CategoryId)
                audits.Add(ReportAuditEntry.CategoryChanged(save.ReportId, name, current.CategoryName, newCategoryName));
            var changed = ChangedFields(current, details);
            if (changed.Count > 0)
                audits.Add(ReportAuditEntry.DetailsChanged(save.ReportId, name, changed));
        }

        var versionAdded = false;
        var deactivated = false;
        int versionId;
        int versionNo;
        var isActive = current.IsActive;
        if (save.SqlText is not null && save.SqlHash is not null && save.ParametersJson is not null)
        {
            var sameContent = current.VersionNo is not null
                && current.SqlHash is not null
                && save.SqlHash.AsSpan().SequenceEqual(current.SqlHash)
                && ReportAuthoringService.Canonical(save.ParametersJson) == ReportAuthoringService.Canonical(current.ParametersJson ?? "[]");
            versionAdded = save.RestoredFromVersionNo is not null || !sameContent;
        }

        if (versionAdded)
        {
            await using var add = connection.CreateCommand();
            add.Transaction = transaction;
            add.CommandText =
                """
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
                SELECT @v, @no, IsActive FROM dbo.ReportDefinition WHERE ReportId = @reportId;
                """;
            add.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = save.ReportId });
            add.Parameters.Add(new SqlParameter("@sql", SqlDbType.NVarChar, -1) { Value = save.SqlText });
            add.Parameters.Add(new SqlParameter("@hash", SqlDbType.Binary, 32) { Value = save.SqlHash });
            add.Parameters.Add(new SqlParameter("@params", SqlDbType.NVarChar, -1) { Value = save.ParametersJson });
            add.Parameters.Add(new SqlParameter("@note", SqlDbType.NVarChar, 300) { Value = (object?)save.ChangeNote ?? DBNull.Value });
            add.Parameters.Add(new SqlParameter("@previewed", SqlDbType.Bit) { Value = save.PreviewedOk });
            add.Parameters.Add(new SqlParameter("@userId", SqlDbType.Int) { Value = (object?)save.UserId ?? DBNull.Value });
            await using (var reader = await add.ExecuteReaderAsync(cancellationToken))
            {
                await reader.ReadAsync(cancellationToken);
                versionId = reader.GetInt32(0);
                versionNo = reader.GetInt32(1);
                isActive = reader.GetBoolean(2);
            }

            // The full SQL is never in an event: versions hold the text, events hold the version number and a short hash.
            if (save.RestoredFromVersionNo is { } restoredFrom)
            {
                audits.Add(ReportAuditEntry.VersionRestored(save.ReportId, name, restoredFrom, versionNo));
            }
            else if (current.VersionNo is not null)
            {
                audits.Add(ReportAuditEntry.Updated(save.ReportId, name, current.VersionNo, current.SqlHash, versionNo, save.SqlHash!));
                if (ReportAuthoringService.Canonical(current.ParametersJson ?? "[]") != ReportAuthoringService.Canonical(save.ParametersJson!))
                    audits.Add(ReportAuditEntry.ParametersChanged(save.ReportId, name, versionNo, ParameterNames(current.ParametersJson ?? "[]"), ParameterNames(save.ParametersJson!)));
            }

            foreach (var (parameter, oldHash, newHash) in ChoiceSqlChanges(current.ParametersJson, save.ParametersJson!))
                audits.Add(ReportAuditEntry.ChoiceSqlChanged(save.ReportId, name, parameter, oldHash, newHash));

            if (current.IsActive && !isActive)
            {
                deactivated = true;
                audits.Add(ReportAuditEntry.Deactivated(save.ReportId, name, $"version {versionNo} was not previewed"));
            }
        }
        else
        {
            await using var read = connection.CreateCommand();
            read.Transaction = transaction;
            read.CommandText = "SELECT d.CurrentVersionId, v.VersionNo FROM dbo.ReportDefinition d LEFT JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId WHERE d.ReportId = @reportId";
            read.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = save.ReportId });
            await using var reader = await read.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            versionId = reader.IsDBNull(0) ? 0 : reader.GetInt32(0);
            versionNo = reader.IsDBNull(1) ? 0 : reader.GetInt32(1);
        }

        foreach (var entry in audits)
            await ReportAuditSql.WriteAsync(connection, transaction, save.UserId, correlation.Id, entry, cancellationToken);

        byte[] rowVersion;
        await using (var final = connection.CreateCommand())
        {
            final.Transaction = transaction;
            final.CommandText = "SELECT RowVersion FROM dbo.ReportDefinition WHERE ReportId = @reportId";
            final.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = save.ReportId });
            rowVersion = (byte[])(await final.ExecuteScalarAsync(cancellationToken))!;
        }

        await transaction.CommitAsync(cancellationToken);
        return StoreResult<SaveOutcome>.Ok(new SaveOutcome(versionId, versionNo, isActive, versionAdded, deactivated, rowVersion));
    }

    private sealed record Current(
        string Name,
        int CategoryId,
        string CategoryName,
        string? Description,
        string? HelpText,
        int SortOrder,
        int? TimeoutSeconds,
        int? MaxRows,
        bool IsActive,
        byte[] RowVersion,
        int? VersionNo,
        byte[]? SqlHash,
        string? ParametersJson);

    private static List<string> ChangedFields(Current current, ReportDetails details)
    {
        var fields = new List<string>();
        if (current.Name != details.Name)
            fields.Add("name");
        if (current.Description != details.Description)
            fields.Add("description");
        if (current.HelpText != details.HelpText)
            fields.Add("help text");
        if (current.SortOrder != details.SortOrder)
            fields.Add("order");
        if (current.TimeoutSeconds != details.TimeoutSeconds)
            fields.Add("timeout");
        if (current.MaxRows != details.MaxRows)
            fields.Add("max rows");
        return fields;
    }

    /// <summary>The choice-list queries that were added or changed between two parameter snapshots, with the short hashes of the old and new text.</summary>
    internal static IReadOnlyList<(string Parameter, byte[]? OldHash, byte[] NewHash)> ChoiceSqlChanges(string? oldJson, string newJson)
    {
        IReadOnlyList<ReportParameterDefinition> before, after;
        try
        {
            before = oldJson is null ? [] : ParameterDefinitionJson.Deserialize(oldJson);
            after = ParameterDefinitionJson.Deserialize(newJson);
        }
        catch (JsonException)
        {
            return [];
        }

        var old = before.Where(d => d.OptionsSql is not null).ToDictionary(d => d.Name, d => SqlValidator.Hash(d.OptionsSql!), StringComparer.Ordinal);
        var changes = new List<(string, byte[]?, byte[])>();
        foreach (var d in after.Where(d => d.OptionsSql is not null))
        {
            var hash = SqlValidator.Hash(d.OptionsSql!);
            old.TryGetValue(d.Name, out var oldHash);
            if (oldHash is null || !oldHash.AsSpan().SequenceEqual(hash))
                changes.Add((d.Name, oldHash, hash));
        }

        return changes;
    }

    private static IReadOnlyList<string> ParameterNames(string json)
    {
        try
        {
            return ParameterDefinitionJson.Deserialize(json).Select(d => d.Name).ToList();
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
