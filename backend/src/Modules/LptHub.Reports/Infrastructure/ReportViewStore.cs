using System.Data;
using LptHub.Reports.Application;
using Microsoft.Data.SqlClient;

namespace LptHub.Reports.Infrastructure;

/// <summary>
/// <c>dbo.SavedReportView</c> with the application connection (the table is denied to the report login). Every statement carries the report id and the
/// person's id in its WHERE, so no id of a view alone can reach another person's row.
/// </summary>
internal sealed class ReportViewStore(ReportAppConnection app) : IReportViewStore
{
    private const int DuplicateKey = 2627;
    private const int DuplicateIndex = 2601;

    private const string Columns = "SavedReportViewId, Name, IsDefault, ViewJson, CreatedAt, ModifiedAt";

    public async Task<IReadOnlyList<SavedViewRow>> ListAsync(int reportId, int userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {Columns} FROM dbo.SavedReportView WHERE ReportId = @report AND UserId = @user ORDER BY IsDefault DESC, Name";
        Bind(command, reportId, userId);
        return await ReadAsync(command, cancellationToken);
    }

    public async Task<(ViewWrite Result, SavedViewRow? Row)> CreateAsync(int reportId, int userId, string name, string viewJson, bool isDefault, int maxViews, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            await using (var count = connection.CreateCommand())
            {
                count.Transaction = transaction;
                count.CommandText = "SELECT COUNT(*) FROM dbo.SavedReportView WITH (UPDLOCK, HOLDLOCK) WHERE ReportId = @report AND UserId = @user";
                Bind(count, reportId, userId);
                if (Convert.ToInt32(await count.ExecuteScalarAsync(cancellationToken), System.Globalization.CultureInfo.InvariantCulture) >= maxViews)
                    return (ViewWrite.LimitReached, null);
            }

            if (isDefault)
                await ClearDefaultAsync(connection, transaction, reportId, userId, null, cancellationToken);

            int id;
            await using (var insert = connection.CreateCommand())
            {
                insert.Transaction = transaction;
                insert.CommandText = "INSERT dbo.SavedReportView (ReportId, UserId, Name, IsDefault, ViewJson) OUTPUT INSERTED.SavedReportViewId VALUES (@report, @user, @name, @default, @json)";
                Bind(insert, reportId, userId);
                insert.Parameters.Add(new SqlParameter("@name", SqlDbType.NVarChar, 100) { Value = name });
                insert.Parameters.Add(new SqlParameter("@default", SqlDbType.Bit) { Value = isDefault });
                insert.Parameters.Add(new SqlParameter("@json", SqlDbType.NVarChar, -1) { Value = viewJson });
                id = Convert.ToInt32(await insert.ExecuteScalarAsync(cancellationToken), System.Globalization.CultureInfo.InvariantCulture);
            }

            var row = await GetAsync(connection, transaction, id, reportId, userId, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return (ViewWrite.Ok, row);
        }
        catch (SqlException ex) when (ex.Number is DuplicateKey or DuplicateIndex)
        {
            return (ViewWrite.NameTaken, null);
        }
    }

    public async Task<(ViewWrite Result, SavedViewRow? Row)> UpdateAsync(int viewId, int reportId, int userId, string? name, string? viewJson, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await using (var update = connection.CreateCommand())
            {
                update.Transaction = transaction;
                update.CommandText =
                    """
                    UPDATE dbo.SavedReportView
                    SET Name = COALESCE(@name, Name), ViewJson = COALESCE(@json, ViewJson), ModifiedAt = SYSUTCDATETIME()
                    WHERE SavedReportViewId = @view AND ReportId = @report AND UserId = @user
                    """;
                Bind(update, reportId, userId);
                update.Parameters.Add(new SqlParameter("@view", SqlDbType.Int) { Value = viewId });
                update.Parameters.Add(new SqlParameter("@name", SqlDbType.NVarChar, 100) { Value = (object?)name ?? DBNull.Value });
                update.Parameters.Add(new SqlParameter("@json", SqlDbType.NVarChar, -1) { Value = (object?)viewJson ?? DBNull.Value });
                if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
                    return (ViewWrite.NotFound, null);
            }

            var row = await GetAsync(connection, transaction, viewId, reportId, userId, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return (ViewWrite.Ok, row);
        }
        catch (SqlException ex) when (ex.Number is DuplicateKey or DuplicateIndex)
        {
            return (ViewWrite.NameTaken, null);
        }
    }

    public async Task<bool> DeleteAsync(int viewId, int reportId, int userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE dbo.SavedReportView WHERE SavedReportViewId = @view AND ReportId = @report AND UserId = @user";
        Bind(command, reportId, userId);
        command.Parameters.Add(new SqlParameter("@view", SqlDbType.Int) { Value = viewId });
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<SavedViewRow?> SetDefaultAsync(int viewId, int reportId, int userId, bool isDefault, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        if (await GetAsync(connection, transaction, viewId, reportId, userId, cancellationToken) is null)
            return null;

        // The filtered unique index allows one default per person and report: clear the old one first, in the same transaction.
        await ClearDefaultAsync(connection, transaction, reportId, userId, isDefault ? null : viewId, cancellationToken);
        if (isDefault)
        {
            await using var set = connection.CreateCommand();
            set.Transaction = transaction;
            set.CommandText = "UPDATE dbo.SavedReportView SET IsDefault = 1, ModifiedAt = SYSUTCDATETIME() WHERE SavedReportViewId = @view AND ReportId = @report AND UserId = @user";
            Bind(set, reportId, userId);
            set.Parameters.Add(new SqlParameter("@view", SqlDbType.Int) { Value = viewId });
            await set.ExecuteNonQueryAsync(cancellationToken);
        }

        var row = await GetAsync(connection, transaction, viewId, reportId, userId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return row;
    }

    /// <summary>Clears the person's default for the report; with <paramref name="onlyView"/> only when that view holds it.</summary>
    private static async Task ClearDefaultAsync(SqlConnection connection, SqlTransaction transaction, int reportId, int userId, int? onlyView, CancellationToken cancellationToken)
    {
        await using var clear = connection.CreateCommand();
        clear.Transaction = transaction;
        clear.CommandText = "UPDATE dbo.SavedReportView SET IsDefault = 0 WHERE ReportId = @report AND UserId = @user AND IsDefault = 1 AND (@only IS NULL OR SavedReportViewId = @only)";
        Bind(clear, reportId, userId);
        clear.Parameters.Add(new SqlParameter("@only", SqlDbType.Int) { Value = (object?)onlyView ?? DBNull.Value });
        await clear.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<SavedViewRow?> GetAsync(SqlConnection connection, SqlTransaction transaction, int viewId, int reportId, int userId, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"SELECT {Columns} FROM dbo.SavedReportView WHERE SavedReportViewId = @view AND ReportId = @report AND UserId = @user";
        Bind(command, reportId, userId);
        command.Parameters.Add(new SqlParameter("@view", SqlDbType.Int) { Value = viewId });
        return (await ReadAsync(command, cancellationToken)).FirstOrDefault();
    }

    private static void Bind(SqlCommand command, int reportId, int userId)
    {
        command.Parameters.Add(new SqlParameter("@report", SqlDbType.Int) { Value = reportId });
        command.Parameters.Add(new SqlParameter("@user", SqlDbType.Int) { Value = userId });
    }

    private static async Task<IReadOnlyList<SavedViewRow>> ReadAsync(SqlCommand command, CancellationToken cancellationToken)
    {
        var rows = new List<SavedViewRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new SavedViewRow(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.GetBoolean(2),
                reader.GetString(3),
                DateTime.SpecifyKind(reader.GetDateTime(4), DateTimeKind.Utc),
                reader.IsDBNull(5) ? null : DateTime.SpecifyKind(reader.GetDateTime(5), DateTimeKind.Utc)));
        }

        return rows;
    }
}
