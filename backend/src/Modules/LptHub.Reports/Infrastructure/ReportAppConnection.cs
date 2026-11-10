using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// The application's own connection, for the Reports tables (definitions, assignments, the run log). It is never used to run a report:
/// reports run on the separate read-only connection (<see cref="ReportsAvailability"/>).
/// </summary>
internal sealed class ReportAppConnection(IConfiguration configuration)
{
    private string ConnectionString =>
        configuration.GetConnectionString("MatterFlow") ?? configuration.GetConnectionString("Default")
        ?? throw new InvalidOperationException("ConnectionStrings:MatterFlow is not configured.");

    public async Task<SqlConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new SqlConnection(ConnectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }
}
