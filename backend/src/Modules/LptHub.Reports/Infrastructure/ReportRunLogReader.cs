using System.Data;
using System.Text.Json;
using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

internal sealed class ReportRunLogReader(ReportAppConnection app) : IReportRunLogReader
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;

    private const string ListSql =
        """
        SELECT TOP (@take) r.ReportRunId, r.ReportId, d.Name, v.VersionNo, r.UserId, u.DisplayName, r.StartedAt, r.FinishedAt, r.Status, r.Kind,
               r.[RowCount], r.Truncated, r.DurationMs, r.ErrorCode, r.ParametersJson
        FROM dbo.ReportRun r
        JOIN dbo.ReportDefinition d ON d.ReportId = r.ReportId
        JOIN dbo.ReportVersion v ON v.ReportVersionId = r.ReportVersionId
        JOIN dbo.AppUser u ON u.UserId = r.UserId
        WHERE (@reportId IS NULL OR r.ReportId = @reportId)
          AND (@status IS NULL OR r.Status = @status)
          AND (@kind IS NULL OR r.Kind = @kind)
          AND (@userId IS NULL OR r.UserId = @userId)
          AND (@before IS NULL OR r.ReportRunId < @before)
        ORDER BY r.ReportRunId DESC
        """;

    public async Task<RunLogPage> ListAsync(RunLogQuery query, CancellationToken cancellationToken)
    {
        var size = Math.Clamp(query.PageSize <= 0 ? DefaultPageSize : query.PageSize, 1, MaxPageSize);
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = ListSql;
        command.Parameters.Add(new SqlParameter("@take", SqlDbType.Int) { Value = size + 1 });
        command.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = (object?)query.ReportId ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@status", SqlDbType.VarChar, 12) { Value = (object?)Clean(query.Status, 12) ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@kind", SqlDbType.VarChar, 12) { Value = (object?)Clean(query.Kind, 12) ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@userId", SqlDbType.Int) { Value = (object?)query.UserId ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@before", SqlDbType.BigInt) { Value = (object?)query.Before ?? DBNull.Value });

        var items = new List<RunLogItem>(size + 1);
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                items.Add(new RunLogItem(
                    reader.GetInt64(0),
                    reader.GetInt32(1),
                    reader.GetString(2),
                    reader.GetInt32(3),
                    reader.GetInt32(4),
                    reader.GetString(5),
                    reader.GetDateTime(6),
                    reader.IsDBNull(7) ? null : reader.GetDateTime(7),
                    reader.GetString(8),
                    reader.GetString(9),
                    reader.IsDBNull(10) ? null : reader.GetInt32(10),
                    reader.GetBoolean(11),
                    reader.IsDBNull(12) ? null : reader.GetInt32(12),
                    reader.IsDBNull(13) ? null : reader.GetString(13),
                    ParseParameters(reader.IsDBNull(14) ? null : reader.GetString(14))));
            }
        }

        var more = items.Count > size;
        if (more)
            items.RemoveAt(items.Count - 1);
        return new RunLogPage(items, more ? items[^1].RunId : null);
    }

    private static string? Clean(string? value, int max) => string.IsNullOrWhiteSpace(value) ? null : value.Trim()[..Math.Min(value.Trim().Length, max)];

    private static IReadOnlyList<string> ParseParameters(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return [];
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
