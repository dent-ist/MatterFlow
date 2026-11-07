using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// Reads what a person may run: the current version of an <b>active</b> report that is assigned to one of the person's <b>active</b> roles
/// (spec section 3). Everything else is "not found", so the existence of a hidden report is not revealed.
/// </summary>
internal sealed class ReportCatalog(ReportAppConnection app) : IReportCatalog
{
    /// <summary>
    /// The one rule for "may run": the report is active, its category is active and one of the person's active roles holds it. Every read of this class uses it
    /// (run, definition, choice lists, the list, the export and the saved views), so a report in a deactivated category is as hidden as an inactive one.
    /// </summary>
    internal const string MayRun =
        """
        d.IsActive = 1
          AND EXISTS (SELECT 1 FROM dbo.ReportCategory rc WHERE rc.ReportCategoryId = d.ReportCategoryId AND rc.IsActive = 1)
          AND EXISTS (SELECT 1
                      FROM dbo.RoleReport rr
                      JOIN dbo.UserRole ur ON ur.RoleId = rr.RoleId
                      JOIN dbo.Role ro ON ro.RoleId = ur.RoleId AND ro.IsActive = 1
                      WHERE rr.ReportId = d.ReportId AND ur.UserId = @userId)
        """;

    internal const string RunnableSql =
        $"""
        SELECT d.ReportId, d.Name, v.ReportVersionId, v.VersionNo, v.SqlText, v.SqlHash, v.ParametersJson, d.TimeoutSeconds, d.MaxRows
        FROM dbo.ReportDefinition d
        JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId
        WHERE d.ReportId = @reportId
          AND {MayRun}
        """;

    internal const string DetailSql =
        $"""
        SELECT d.ReportId, d.Name, d.Description, d.HelpText, c.ReportCategoryId, c.Name, v.VersionNo, v.SqlText, v.ParametersJson, d.TimeoutSeconds, d.MaxRows
        FROM dbo.ReportDefinition d
        JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId
        JOIN dbo.ReportCategory c ON c.ReportCategoryId = d.ReportCategoryId
        WHERE d.ReportId = @reportId
          AND {MayRun}
        """;

    internal const string ListSql =
        $"""
        SELECT d.ReportId, d.Name, d.Description, d.SortOrder, c.ReportCategoryId, c.Name, c.SortOrder, v.VersionNo, v.SqlText, v.ParametersJson,
               (SELECT MAX(r.StartedAt) FROM dbo.ReportRun r
                WHERE r.ReportId = d.ReportId AND r.UserId = @userId AND r.Kind = 'Run' AND r.Status IN ('Succeeded', 'Truncated')) AS LastRunAt,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.ReportFavourite f WHERE f.ReportId = d.ReportId AND f.UserId = @userId) THEN 1 ELSE 0 END AS IsFavourite
        FROM dbo.ReportDefinition d
        JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId
        JOIN dbo.ReportCategory c ON c.ReportCategoryId = d.ReportCategoryId
        WHERE {MayRun}
        ORDER BY c.SortOrder, c.Name, d.SortOrder, d.Name
        """;

    public async Task<RunnableReport?> FindRunnableAsync(int reportId, int userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = RunnableSql;
        command.Parameters.Add(new SqlParameter("@reportId", System.Data.SqlDbType.Int) { Value = reportId });
        command.Parameters.Add(new SqlParameter("@userId", System.Data.SqlDbType.Int) { Value = userId });
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return null;

        return new RunnableReport(
            reader.GetInt32(0),
            reader.GetString(1),
            reader.GetInt32(2),
            reader.GetInt32(3),
            reader.GetString(4),
            (byte[])reader.GetValue(5),
            reader.GetString(6),
            reader.IsDBNull(7) ? null : reader.GetInt32(7),
            reader.IsDBNull(8) ? null : reader.GetInt32(8));
    }

    public async Task<RunnableDetail?> FindRunnableDetailAsync(int reportId, int userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = DetailSql;
        command.Parameters.Add(new SqlParameter("@reportId", System.Data.SqlDbType.Int) { Value = reportId });
        command.Parameters.Add(new SqlParameter("@userId", System.Data.SqlDbType.Int) { Value = userId });
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return null;

        return new RunnableDetail(
            reader.GetInt32(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.GetInt32(4),
            reader.GetString(5),
            reader.GetInt32(6),
            reader.GetString(7),
            reader.GetString(8),
            reader.IsDBNull(9) ? null : reader.GetInt32(9),
            reader.IsDBNull(10) ? null : reader.GetInt32(10));
    }

    public async Task<IReadOnlyList<RunnableListItem>> ListRunnableAsync(int userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = ListSql;
        command.Parameters.Add(new SqlParameter("@userId", System.Data.SqlDbType.Int) { Value = userId });
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var items = new List<RunnableListItem>();
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new RunnableListItem(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetInt32(3),
                reader.GetInt32(4),
                reader.GetString(5),
                reader.GetInt32(6),
                reader.GetInt32(7),
                reader.GetString(8),
                reader.GetString(9),
                reader.IsDBNull(10) ? null : DateTime.SpecifyKind(reader.GetDateTime(10), DateTimeKind.Utc),
                reader.GetInt32(11) == 1));
        }

        return items;
    }
}
