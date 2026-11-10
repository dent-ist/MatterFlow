using Microsoft.EntityFrameworkCore;

namespace MatterFlow.Api.Security;

/// <summary>
/// Startup check for security review SEC-04: the identity that the API uses for its database connection must not be able to change or
/// remove audit rows, otherwise the "append-only" promise rests on a trigger that the same identity could drop. The check asks SQL
/// Server what the connection may do (<c>HAS_PERMS_BY_NAME</c>), so it works for sysadmin, db_owner and role-based grants alike.
/// </summary>
public static class AuditStoreGuard
{
    /// <summary>Set to true to start anyway with a privileged database identity (not recommended; the failure is then logged as an error).</summary>
    public const string AllowPrivilegedSetting = "Security:AllowPrivilegedDatabaseIdentity";

    internal const string ExposureSql =
        """
        SELECT CAST(CASE WHEN OBJECT_ID('dbo.AuditEvent') IS NOT NULL
                          AND (ISNULL(HAS_PERMS_BY_NAME('dbo.AuditEvent', 'OBJECT', 'UPDATE'), 0) = 1
                            OR ISNULL(HAS_PERMS_BY_NAME('dbo.AuditEvent', 'OBJECT', 'DELETE'), 0) = 1
                            OR ISNULL(HAS_PERMS_BY_NAME('dbo.AuditEvent', 'OBJECT', 'ALTER'), 0) = 1)
                         THEN 1 ELSE 0 END AS int) AS [Value]
        """;

    /// <summary>What the host does with the result of the check.</summary>
    public enum Outcome
    {
        Safe,
        Warn,
        Refuse,
    }

    /// <summary>Production refuses to start with an exposed audit table unless explicitly allowed; other environments only warn.</summary>
    public static Outcome Decide(bool exposed, bool isProduction, bool allowPrivileged) =>
        !exposed ? Outcome.Safe : isProduction && !allowPrivileged ? Outcome.Refuse : Outcome.Warn;

    public static async Task VerifyAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        var environment = services.GetRequiredService<IHostEnvironment>();
        var configuration = services.GetRequiredService<IConfiguration>();
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("MatterFlow.Security");

        await using var scope = services.CreateAsyncScope();
        bool exposed;
        try
        {
            var db = scope.ServiceProvider.GetRequiredService<DbContext>();
            exposed = await db.Database.SqlQueryRaw<int>(ExposureSql).SingleAsync(cancellationToken) == 1;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not verify the permissions of the database identity on dbo.AuditEvent.");
            return;
        }

        var allow = configuration.GetValue<bool>(AllowPrivilegedSetting);
        switch (Decide(exposed, environment.IsProduction(), allow))
        {
            case Outcome.Refuse:
                throw new InvalidOperationException(
                    "The database identity of the API can UPDATE, DELETE or ALTER dbo.AuditEvent, so the audit trail is not tamper-evident. "
                    + "Run the API as a member of the mf_app database role (not db_owner or sysadmin) and use ConnectionStrings:Migrations for schema changes, "
                    + $"or set {AllowPrivilegedSetting}=true to accept the risk (docs/runbook.md section 3).");
            case Outcome.Warn:
                logger.LogWarning(
                    "The database identity of the API can modify dbo.AuditEvent (UPDATE, DELETE or ALTER). Use a member of the mf_app role in production (docs/runbook.md section 3).");
                break;
        }
    }
}
