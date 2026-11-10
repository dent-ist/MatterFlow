using LptHub.Reports.Application.Starters;
using Microsoft.Data.SqlClient;

namespace LptHub.Reports.Infrastructure;

/// <summary>The seed markers of the starter reports in <c>dbo.SeedMarker</c> (application connection; the report login cannot read this table).</summary>
internal sealed class ReportStarterMarkers(ReportAppConnection app) : IReportStarterMarkers
{
    public async Task<bool> ExistsAsync(string name, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1 FROM dbo.SeedMarker WHERE Name = @name";
        command.Parameters.Add(new SqlParameter("@name", System.Data.SqlDbType.VarChar, 100) { Value = name });
        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    public async Task AddAsync(string name, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "IF NOT EXISTS (SELECT 1 FROM dbo.SeedMarker WHERE Name = @name) INSERT dbo.SeedMarker (Name) VALUES (@name)";
        command.Parameters.Add(new SqlParameter("@name", System.Data.SqlDbType.VarChar, 100) { Value = name });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
