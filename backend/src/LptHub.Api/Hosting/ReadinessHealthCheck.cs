using System.Text.Json;
using MatterFlow.Data.SchemaMigrations;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace MatterFlow.Api.Hosting;

/// <summary>
/// <c>/health/ready</c>: healthy when the database is reachable with the application's own connection and <c>dbo.SchemaMigration</c> lists every
/// script that this build embeds as successfully applied (architecture section 17). The reason is one of a few fixed codes, never an exception
/// message, because the endpoint is anonymous.
/// </summary>
public sealed class ReadinessHealthCheck(IConfiguration configuration, MigrationsOptions options) : IHealthCheck
{
    public const string Tag = "ready";
    public const string Ready = "ready";
    public const string NotConfigured = "database_not_configured";
    public const string Unreachable = "database_unreachable";
    public const string MigrationsPending = "migrations_pending";
    public const string MigrationFailed = "migration_failed";
    public const string ReasonKey = "reason";

    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        var connectionString = configuration.GetConnectionString("MatterFlow") ?? configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
            return NotReady(NotConfigured);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        try
        {
            var builder = new SqlConnectionStringBuilder(connectionString) { ConnectTimeout = (int)Timeout.TotalSeconds, Pooling = true };
            await using var connection = new SqlConnection(builder.ConnectionString);
            await connection.OpenAsync(timeout.Token);

            var applied = new Dictionary<string, bool>(StringComparer.Ordinal);
            await using (var command = connection.CreateCommand())
            {
                command.CommandText = "SELECT ScriptName, Success FROM dbo.SchemaMigration;";
                command.CommandTimeout = (int)Timeout.TotalSeconds;
                try
                {
                    await using var reader = await command.ExecuteReaderAsync(timeout.Token);
                    while (await reader.ReadAsync(timeout.Token))
                        applied[reader.GetString(0)] = reader.GetBoolean(1);
                }
                catch (SqlException ex) when (ex.Number == 208)
                {
                    // Reachable but empty: the runner has never run.
                    return NotReady(MigrationsPending);
                }
            }

            if (applied.ContainsValue(false))
                return NotReady(MigrationFailed);

            IMigrationScriptSource source = options.ScriptsFolder is null
                ? new EmbeddedMigrationScriptSource()
                : new FolderMigrationScriptSource(options.ScriptsFolder);
            var pending = ScriptCatalog.Load(source).Any(s => !applied.ContainsKey(s.Name));
            return pending ? NotReady(MigrationsPending) : HealthCheckResult.Healthy(Ready, new Dictionary<string, object> { [ReasonKey] = Ready });
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException or OperationCanceledException or SchemaMigrationException)
        {
            // Anonymous endpoint: no connection string, server name or SQL error text in the response.
            return NotReady(Unreachable);
        }
    }

    private static HealthCheckResult NotReady(string reason) =>
        HealthCheckResult.Unhealthy(reason, data: new Dictionary<string, object> { [ReasonKey] = reason });

    /// <summary>Writes <c>{"status":"ready"}</c> or <c>{"status":"not_ready","reason":"..."}</c>.</summary>
    public static Task WriteResponseAsync(HttpContext context, HealthReport report)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        var ready = report.Status == HealthStatus.Healthy;
        var reason = report.Entries.Values.Select(e => e.Data.TryGetValue(ReasonKey, out var r) ? r as string : null).FirstOrDefault(r => r is not null);
        return ready
            ? context.Response.WriteAsync(JsonSerializer.Serialize(new { status = "ready" }))
            : context.Response.WriteAsync(JsonSerializer.Serialize(new { status = "not_ready", reason = reason ?? Unreachable }));
    }

    public static HealthCheckOptions EndpointOptions() => new() { Predicate = r => r.Tags.Contains(Tag), ResponseWriter = WriteResponseAsync };
}
