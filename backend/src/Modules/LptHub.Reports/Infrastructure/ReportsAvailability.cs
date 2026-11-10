using LptHub.Reports.Application;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LptHub.Reports.Infrastructure;

/// <summary>
/// Holds the current Reports health. The only place in the product that reads <c>ConnectionStrings:ReportsReadOnly</c>
/// (an architecture test keeps it that way); it never falls back to the application connection.
/// </summary>
internal sealed class ReportsAvailability(IConfiguration configuration, ILogger<ReportsAvailability> logger, TimeProvider time) : IReportsAvailability
{
    public const string ConnectionName = "ReportsReadOnly";

    private static readonly string[] ApplicationConnectionNames = ["LptHub", "Default", "Migrations"];

    private readonly SemaphoreSlim _check = new(1, 1);
    private volatile ReportsStatus _current = new(false, ReportsStates.Checking, "Reports are being checked.");
    private volatile string? _connectionString;

    public ReportsStatus Current => _current;

    public string? ReportConnectionString => _current.Enabled ? _connectionString : null;

    public async Task<ReportsStatus> CheckAsync(CancellationToken cancellationToken)
    {
        await _check.WaitAsync(cancellationToken);
        try
        {
            var guard = ReportsConnectionGuard.Evaluate(
                configuration.GetConnectionString(ConnectionName),
                ApplicationConnectionNames.Select(n => configuration.GetConnectionString(n)));
            if (!guard.Ok)
            {
                _connectionString = null;
                return Publish(new ReportsStatus(false, guard.State, guard.Message));
            }

            var status = await ReportLoginProbe.ProbeAsync(guard.ConnectionString!, ReportAccessCatalogue.Current, time.GetUtcNow().UtcDateTime, cancellationToken);
            _connectionString = status.Enabled ? guard.ConnectionString : null;
            return Publish(status);
        }
        finally
        {
            _check.Release();
        }
    }

    private ReportsStatus Publish(ReportsStatus status)
    {
        if (_current.State != status.State)
            logger.LogInformation("Reports state: {State}. {Message}", status.State, status.Message);
        if (status.Enabled && status.Details is { ServerProceduresDenied: false } && _current.Details?.ServerProceduresDenied != false)
            logger.LogWarning("The report login can still run extended procedures in master (xp_dirtree and others). Run the one-time DENY step: docs/runbook.md section 11.");
        _current = status;
        return status;
    }
}
