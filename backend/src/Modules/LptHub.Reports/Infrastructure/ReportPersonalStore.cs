using System.Data;
using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// <c>dbo.ReportFavourite</c> and the Recent line (derived from <c>dbo.ReportRun</c>, owner decision 15: <c>ReportRecent</c> stays unused) with the
/// application connection. Every statement carries the person's id; the reads repeat <see cref="ReportCatalog.MayRun"/>.
/// </summary>
internal sealed class ReportPersonalStore(ReportAppConnection app) : IReportPersonalStore
{
    // The count behind the limit only counts marks of reports the person can still use, so a mark kept for a report that was unassigned never blocks a new one.
    private const string CountSql =
        $"""
        SELECT COUNT(*)
        FROM dbo.ReportFavourite f WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.ReportDefinition d ON d.ReportId = f.ReportId
        WHERE f.UserId = @userId AND {ReportCatalog.MayRun}
        """;

    // Same successful-run rule as the Last Run column of the list (a run, not a preview, export or choice query; a truncated result is a success).
    private const string RecentSql =
        $"""
        SELECT TOP (@top) d.ReportId, d.Name, c.Name, MAX(r.StartedAt) AS LastRunAt
        FROM dbo.ReportRun r
        JOIN dbo.ReportDefinition d ON d.ReportId = r.ReportId
        JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId
        JOIN dbo.ReportCategory c ON c.ReportCategoryId = d.ReportCategoryId
        WHERE r.UserId = @userId AND r.Kind = 'Run' AND r.Status IN ('Succeeded', 'Truncated') AND {ReportCatalog.MayRun}
        GROUP BY d.ReportId, d.Name, c.Name
        ORDER BY MAX(r.StartedAt) DESC, d.ReportId DESC
        """;

    public async Task<FavouriteWrite> AddFavouriteAsync(int reportId, int userId, int maxFavourites, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);

        await using (var exists = connection.CreateCommand())
        {
            exists.Transaction = transaction;
            exists.CommandText = "SELECT COUNT(*) FROM dbo.ReportFavourite WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @userId AND ReportId = @reportId";
            Bind(exists, userId);
            exists.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = reportId });
            if (Convert.ToInt32(await exists.ExecuteScalarAsync(cancellationToken), System.Globalization.CultureInfo.InvariantCulture) > 0)
            {
                await transaction.CommitAsync(cancellationToken);
                return FavouriteWrite.Ok;
            }
        }

        await using (var count = connection.CreateCommand())
        {
            count.Transaction = transaction;
            count.CommandText = CountSql;
            Bind(count, userId);
            if (Convert.ToInt32(await count.ExecuteScalarAsync(cancellationToken), System.Globalization.CultureInfo.InvariantCulture) >= maxFavourites)
                return FavouriteWrite.LimitReached;
        }

        await using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText = "INSERT dbo.ReportFavourite (UserId, ReportId) VALUES (@userId, @reportId)";
            Bind(insert, userId);
            insert.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = reportId });
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return FavouriteWrite.Ok;
    }

    public async Task RemoveFavouriteAsync(int reportId, int userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE dbo.ReportFavourite WHERE UserId = @userId AND ReportId = @reportId";
        Bind(command, userId);
        command.Parameters.Add(new SqlParameter("@reportId", SqlDbType.Int) { Value = reportId });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<RecentReportRow>> ListRecentAsync(int userId, int top, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = RecentSql;
        Bind(command, userId);
        command.Parameters.Add(new SqlParameter("@top", SqlDbType.Int) { Value = top });
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<RecentReportRow>();
        while (await reader.ReadAsync(cancellationToken))
            rows.Add(new RecentReportRow(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), DateTime.SpecifyKind(reader.GetDateTime(3), DateTimeKind.Utc)));
        return rows;
    }

    private static void Bind(SqlCommand command, int userId) => command.Parameters.Add(new SqlParameter("@userId", SqlDbType.Int) { Value = userId });
}
