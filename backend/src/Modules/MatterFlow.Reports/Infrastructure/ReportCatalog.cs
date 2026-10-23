using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// Reads what a person may run: the current version of an <b>active</b> report that is assigned to one of the person's <b>active</b> roles
/// (spec section 3). Everything else is "not found", so the existence of a hidden report is not revealed.
/// </summary>
internal sealed class ReportCatalog(ReportAppConnection app) : IReportCatalog
{
    internal const string RunnableSql =
        """
        SELECT d.ReportId, d.Name, v.ReportVersionId, v.VersionNo, v.SqlText, v.SqlHash, v.ParametersJson, d.TimeoutSeconds, d.MaxRows
        FROM dbo.ReportDefinition d
        JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId
        WHERE d.ReportId = @reportId
          AND d.IsActive = 1
          AND EXISTS (SELECT 1
                      FROM dbo.RoleReport rr
                      JOIN dbo.UserRole ur ON ur.RoleId = rr.RoleId
                      JOIN dbo.Role ro ON ro.RoleId = ur.RoleId AND ro.IsActive = 1
                      WHERE rr.ReportId = d.ReportId AND ur.UserId = @userId)
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
}
