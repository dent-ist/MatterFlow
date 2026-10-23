using System.Data;
using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// Writes <c>dbo.ReportRun</c> with the application connection: an INSERT when a run starts, and one call of <c>dbo.usp_ReportRunComplete</c>
/// when it ends (the table is append-only; the application identity has no UPDATE or DELETE on it).
/// </summary>
internal sealed class ReportRunLog(ReportAppConnection app) : IReportRunLog
{
    private const string InsertSql =
        """
        INSERT dbo.ReportRun (ReportId, ReportVersionId, UserId, Status, Kind, ParametersJson, Truncated, ErrorCode, CorrelationId, FinishedAt, DurationMs)
        OUTPUT INSERTED.ReportRunId
        VALUES (@reportId, @versionId, @userId, @status, @kind, @parameters, 0, @errorCode, @correlation, @finished, @duration)
        """;

    public Task<long> StartAsync(RunStart start, CancellationToken cancellationToken) => InsertAsync(start, "Running", null, cancellationToken);

    public Task<long> RecordRejectedAsync(RunStart start, string errorCode, CancellationToken cancellationToken) => InsertAsync(start, "Rejected", errorCode, cancellationToken);

    private async Task<long> InsertAsync(RunStart start, string status, string? errorCode, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = InsertSql;
        command.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = start.ReportId });
        command.Parameters.Add(new SqlParameter("@versionId", SqlDbType.Int) { Value = start.VersionId });
        command.Parameters.Add(new SqlParameter("@userId", SqlDbType.Int) { Value = start.UserId });
        command.Parameters.Add(new SqlParameter("@status", SqlDbType.VarChar, 12) { Value = status });
        command.Parameters.Add(new SqlParameter("@kind", SqlDbType.VarChar, 12) { Value = start.Kind.ToString() });
        command.Parameters.Add(new SqlParameter("@parameters", SqlDbType.NVarChar, 4000) { Value = Trim(start.ParametersJson) });
        command.Parameters.Add(new SqlParameter("@errorCode", SqlDbType.VarChar, 40) { Value = (object?)errorCode ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@correlation", SqlDbType.UniqueIdentifier) { Value = start.CorrelationId });
        command.Parameters.Add(new SqlParameter("@finished", SqlDbType.DateTime2) { Value = status == "Running" ? DBNull.Value : DateTime.UtcNow });
        command.Parameters.Add(new SqlParameter("@duration", SqlDbType.Int) { Value = status == "Running" ? DBNull.Value : 0 });
        return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), System.Globalization.CultureInfo.InvariantCulture);
    }

    public async Task CompleteAsync(long runId, RunCompletion completion, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandType = CommandType.StoredProcedure;
        command.CommandText = "dbo.usp_ReportRunComplete";
        command.Parameters.Add(new SqlParameter("@ReportRunId", SqlDbType.BigInt) { Value = runId });
        command.Parameters.Add(new SqlParameter("@Status", SqlDbType.VarChar, 12) { Value = completion.Status.ToString() });
        command.Parameters.Add(new SqlParameter("@RowCount", SqlDbType.Int) { Value = (object?)completion.RowCount ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@Truncated", SqlDbType.Bit) { Value = completion.Truncated });
        command.Parameters.Add(new SqlParameter("@DurationMs", SqlDbType.Int) { Value = (object?)completion.DurationMs ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@ErrorCode", SqlDbType.VarChar, 40) { Value = (object?)completion.ErrorCode ?? DBNull.Value });
        command.Parameters.Add(new SqlParameter("@ExportedRowCount", SqlDbType.Int) { Value = (object?)completion.ExportedRowCount ?? DBNull.Value });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>The column holds 4,000 characters of valid JSON; long values were already shortened by the binder, this only guards the column.</summary>
    private static object Trim(string? json) =>
        json is null ? DBNull.Value : json.Length <= 4000 ? json : System.Text.Json.JsonSerializer.Serialize(new { truncated = true });
}
