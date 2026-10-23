using System.Diagnostics;
using System.Globalization;
using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// Runs one validated query on the **read-only report connection** (spec 6.1, 6.2): a session preamble as its own batch, then the query as its
/// own batch with typed parameters, streamed into a sink. It stops at <c>MaxRows + 1</c> rows (the extra row proves truncation), enforces the
/// time limit as a wall clock that cancels the command, and maps every failure to a stable code. SQL Server's own message is returned only in
/// <see cref="ExecutionOutcome.AdminDetail"/> and is shown to administrators in preview; run-only users never see it.
/// </summary>
internal sealed class ReportExecutor(IReportsAvailability availability, IOptions<ReportsOptions> options, ILogger<ReportExecutor> logger) : IReportExecutor
{
    private const int TimeoutErrorNumber = -2;

    public async Task<ExecutionOutcome> ExecuteAsync(ExecutionRequest request, IRowSink sink, CancellationToken cancellationToken)
    {
        // The only connection a report may use. Null while the login is missing, shared with the application or too privileged.
        var connectionString = availability.ReportConnectionString;
        if (connectionString is null)
            return new(ReportRunStatus.Failed, [], 0, false, 0, "REPORTS_UNAVAILABLE", availability.Current.Message, null);

        var watch = Stopwatch.StartNew();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(request.TimeoutSeconds));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        IReadOnlyList<ResultColumn> columns = [];
        var rows = 0;
        var truncated = false;

        try
        {
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync(linked.Token);

            await using (var preamble = connection.CreateCommand())
            {
                preamble.CommandText = Preamble(options.Value.LockTimeoutMilliseconds);
                preamble.CommandTimeout = 10;
                await preamble.ExecuteNonQueryAsync(linked.Token);
            }

            await using var command = connection.CreateCommand();
            command.CommandText = request.SqlText;
            command.CommandTimeout = request.TimeoutSeconds + 5; // the wall clock above fires first and cancels
            foreach (var p in request.Parameters)
                command.Parameters.Add(SqlParameterFactory.Create(p));

            await using var reader = await command.ExecuteReaderAsync(linked.Token);
            columns = ReadColumns(reader);
            sink.Begin(columns);
            var buffer = new object?[columns.Count];
            var retaining = true;
            while (await reader.ReadAsync(linked.Token))
            {
                if (rows >= request.MaxRows)
                {
                    truncated = true; // one row more than the cap exists
                    break;
                }

                rows++;
                if (retaining && rows <= request.RetainRows)
                {
                    reader.GetValues(buffer);
                    var copy = new object?[buffer.Length];
                    for (var i = 0; i < copy.Length; i++)
                        copy[i] = buffer[i] is DBNull ? null : buffer[i];
                    retaining = sink.TryAdd(copy);

                    // The sink refused a row before the cap (its memory budget): a full run keeps nothing partial, so stop reading now.
                    if (!retaining && rows < request.MaxRows && request.RetainRows >= request.MaxRows)
                    {
                        command.Cancel();
                        break;
                    }
                }
            }

            // A cancelled command leaves unread data on the wire: cancelling here makes closing the reader immediate.
            if (truncated)
                command.Cancel();

            watch.Stop();
            return new(truncated ? ReportRunStatus.Truncated : ReportRunStatus.Succeeded, columns, rows, truncated, (int)watch.ElapsedMilliseconds, null, null, null);
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            return TimedOut(columns, rows, watch);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            watch.Stop();
            return new(ReportRunStatus.Cancelled, columns, rows, false, (int)watch.ElapsedMilliseconds, "CANCELLED", null, null);
        }
        catch (SqlException ex) when (ex.Number == TimeoutErrorNumber || timeout.IsCancellationRequested)
        {
            return TimedOut(columns, rows, watch);
        }
        catch (SqlException ex) when (cancellationToken.IsCancellationRequested && ex.Number == 0)
        {
            watch.Stop();
            return new(ReportRunStatus.Cancelled, columns, rows, false, (int)watch.ElapsedMilliseconds, "CANCELLED", null, null);
        }
        catch (SqlException ex)
        {
            watch.Stop();
            logger.LogWarning("A report query failed with SQL error {Number} (state {State}, line {Line}).", ex.Number, ex.State, ex.LineNumber);
            return new(ReportRunStatus.Failed, columns, rows, false, (int)watch.ElapsedMilliseconds, "SQL_" + ex.Number.ToString(CultureInfo.InvariantCulture), ex.Message, ex.LineNumber > 0 ? ex.LineNumber : null);
        }
        catch (InvalidOperationException ex)
        {
            watch.Stop();
            logger.LogWarning(ex, "A report could not use its connection.");
            return new(ReportRunStatus.Failed, columns, rows, false, (int)watch.ElapsedMilliseconds, "CONNECTION", ex.Message, null);
        }
    }

    internal static string Preamble(int lockTimeoutMilliseconds) =>
        $"SET LOCK_TIMEOUT {Math.Clamp(lockTimeoutMilliseconds, 0, 60_000).ToString(CultureInfo.InvariantCulture)}; SET DEADLOCK_PRIORITY LOW; SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SET ROWCOUNT 0; SET NOCOUNT ON; SET DATEFIRST 7;";

    private static ExecutionOutcome TimedOut(IReadOnlyList<ResultColumn> columns, int rows, Stopwatch watch)
    {
        watch.Stop();
        return new(ReportRunStatus.TimedOut, columns, rows, false, (int)watch.ElapsedMilliseconds, "TIMEOUT", null, null);
    }

    /// <summary>Column names must be unique and non-empty for the grid, sorting and filters; the SQL may give none (<c>SELECT 1</c>) or repeat one.</summary>
    internal static IReadOnlyList<ResultColumn> ReadColumns(SqlDataReader reader)
    {
        var columns = new List<ResultColumn>(reader.FieldCount);
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < reader.FieldCount; i++)
        {
            var name = reader.GetName(i);
            if (string.IsNullOrWhiteSpace(name))
                name = "Column " + (i + 1).ToString(CultureInfo.InvariantCulture);
            var candidate = name;
            for (var n = 2; !used.Add(candidate); n++)
                candidate = $"{name} ({n.ToString(CultureInfo.InvariantCulture)})";
            columns.Add(new ResultColumn(candidate, TypeOf(reader.GetFieldType(i), reader.GetDataTypeName(i)), reader.GetFieldType(i) == typeof(double) || reader.GetFieldType(i) == typeof(float)));
        }

        return columns;
    }

    private static ReportColumnType TypeOf(Type clr, string sqlTypeName)
    {
        if (clr == typeof(bool))
            return ReportColumnType.Boolean;
        if (clr == typeof(byte) || clr == typeof(short) || clr == typeof(int) || clr == typeof(long))
            return ReportColumnType.Integer;
        if (clr == typeof(decimal) || clr == typeof(double) || clr == typeof(float))
            return ReportColumnType.Decimal;
        if (clr == typeof(DateTime))
            return string.Equals(sqlTypeName, "date", StringComparison.OrdinalIgnoreCase) ? ReportColumnType.Date : ReportColumnType.DateTime;
        if (clr == typeof(DateTimeOffset))
            return ReportColumnType.DateTime;
        return ReportColumnType.Text;
    }
}
