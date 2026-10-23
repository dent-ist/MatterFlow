using System.Data;
using System.Globalization;
using MatterFlow.Audit.Contracts;
using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>The admin reads and writes of the Reports tables with the application connection (categories, list, create, versions, assignment).</summary>
internal sealed class ReportAdminStore(ReportAppConnection app, IAuditCorrelation correlation) : IReportAdminStore
{
    private static SqlParameter Int(string name, int? value) => new(name, SqlDbType.Int) { Value = (object?)value ?? DBNull.Value };

    private static SqlParameter Text(string name, string? value, int size) => new(name, SqlDbType.NVarChar, size) { Value = (object?)value ?? DBNull.Value };

    private static string? Str(SqlDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);

    private static int? NullableInt(SqlDataReader r, int i) => r.IsDBNull(i) ? null : r.GetInt32(i);

    private static DateTime? NullableDate(SqlDataReader r, int i) => r.IsDBNull(i) ? null : DateTime.SpecifyKind(r.GetDateTime(i), DateTimeKind.Utc);

    // ---- Categories ----

    private const string CategorySelect =
        """
        SELECT c.ReportCategoryId, c.Name, c.SortOrder, c.IsActive,
               (SELECT COUNT(*) FROM dbo.ReportDefinition d WHERE d.ReportCategoryId = c.ReportCategoryId), c.RowVersion
        FROM dbo.ReportCategory c
        """;

    private static CategoryRow ReadCategory(SqlDataReader r) => new(r.GetInt32(0), r.GetString(1), r.GetInt32(2), r.GetBoolean(3), r.GetInt32(4), (byte[])r.GetValue(5));

    public async Task<IReadOnlyList<CategoryRow>> ListCategoriesAsync(CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = CategorySelect + " ORDER BY c.SortOrder, c.Name";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<CategoryRow>();
        while (await reader.ReadAsync(cancellationToken))
            rows.Add(ReadCategory(reader));
        return rows;
    }

    public async Task<StoreResult<CategoryRow>> CreateCategoryAsync(string name, int sortOrder, int? userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        int id;
        await using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText = "INSERT dbo.ReportCategory (Name, SortOrder, CreatedByUserId) OUTPUT INSERTED.ReportCategoryId VALUES (@name, @sort, @userId)";
            insert.Parameters.Add(Text("@name", name, 100));
            insert.Parameters.Add(Int("@sort", sortOrder));
            insert.Parameters.Add(Int("@userId", userId));
            try
            {
                id = Convert.ToInt32(await insert.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
            }
            catch (SqlException ex) when (ex.Number is 2627 or 2601)
            {
                return StoreResult<CategoryRow>.Fail(StoreStatus.DuplicateName);
            }
        }

        await ReportAuditSql.WriteAsync(connection, transaction, userId, correlation.Id, ReportAuditEntry.CategorySaved(id, name, null, true, ""), cancellationToken);
        var row = await ReadCategoryAsync(connection, transaction, id, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return StoreResult<CategoryRow>.Ok(row!);
    }

    public async Task<StoreResult<CategoryRow>> UpdateCategoryAsync(int categoryId, string name, int sortOrder, bool isActive, byte[] rowVersion, int? userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        var current = await ReadCategoryAsync(connection, transaction, categoryId, cancellationToken);
        if (current is null)
            return StoreResult<CategoryRow>.Fail(StoreStatus.NotFound);
        if (!current.RowVersion.AsSpan().SequenceEqual(rowVersion))
            return StoreResult<CategoryRow>.Fail(StoreStatus.Conflict);
        if (current.Name == name && current.SortOrder == sortOrder && current.IsActive == isActive)
            return StoreResult<CategoryRow>.Ok(current);

        await using (var update = connection.CreateCommand())
        {
            update.Transaction = transaction;
            update.CommandText = "UPDATE dbo.ReportCategory SET Name = @name, SortOrder = @sort, IsActive = @active, ModifiedAt = SYSUTCDATETIME(), ModifiedByUserId = @userId WHERE ReportCategoryId = @id";
            update.Parameters.Add(Int("@id", categoryId));
            update.Parameters.Add(Text("@name", name, 100));
            update.Parameters.Add(Int("@sort", sortOrder));
            update.Parameters.Add(new SqlParameter("@active", SqlDbType.Bit) { Value = isActive });
            update.Parameters.Add(Int("@userId", userId));
            try
            {
                await update.ExecuteNonQueryAsync(cancellationToken);
            }
            catch (SqlException ex) when (ex.Number is 2627 or 2601)
            {
                return StoreResult<CategoryRow>.Fail(StoreStatus.DuplicateName);
            }
        }

        var changes = new List<string>();
        if (current.Name != name)
            changes.Add($"renamed from '{current.Name}'");
        if (current.SortOrder != sortOrder)
            changes.Add($"order {current.SortOrder} to {sortOrder}");
        if (current.IsActive != isActive)
            changes.Add(isActive ? "activated" : "deactivated");
        await ReportAuditSql.WriteAsync(connection, transaction, userId, correlation.Id, ReportAuditEntry.CategorySaved(categoryId, name, current.Name, false, string.Join(", ", changes)), cancellationToken);
        var row = await ReadCategoryAsync(connection, transaction, categoryId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return StoreResult<CategoryRow>.Ok(row!);
    }

    private static async Task<CategoryRow?> ReadCategoryAsync(SqlConnection connection, SqlTransaction transaction, int id, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = CategorySelect + " WHERE c.ReportCategoryId = @id";
        command.Parameters.Add(Int("@id", id));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadCategory(reader) : null;
    }

    // ---- Reports ----

    public async Task<IReadOnlyList<ReportListRow>> ListReportsAsync(ReportListFilter filter, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT TOP (1000) d.ReportId, d.Name, d.ReportCategoryId, c.Name, d.SortOrder, d.Description, d.IsActive, v.VersionNo,
                   CAST(CASE WHEN d.CurrentVersionId IS NOT NULL AND d.LastPreviewOkVersionId = d.CurrentVersionId THEN 1 ELSE 0 END AS bit),
                   (SELECT COUNT(*) FROM dbo.RoleReport rr WHERE rr.ReportId = d.ReportId),
                   (SELECT MAX(r.StartedAt) FROM dbo.ReportRun r WHERE r.ReportId = d.ReportId AND r.Kind = 'Run'),
                   COALESCE(d.ModifiedAt, d.CreatedAt), d.RowVersion
            FROM dbo.ReportDefinition d
            JOIN dbo.ReportCategory c ON c.ReportCategoryId = d.ReportCategoryId
            LEFT JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId
            WHERE (@status IS NULL OR (@status = 'active' AND d.IsActive = 1) OR (@status = 'inactive' AND d.IsActive = 0))
              AND (@category IS NULL OR d.ReportCategoryId = @category)
              AND (@pattern IS NULL OR d.Name LIKE @pattern ESCAPE '\' OR d.Description LIKE @pattern ESCAPE '\' OR c.Name LIKE @pattern ESCAPE '\')
            ORDER BY c.SortOrder, c.Name, d.SortOrder, d.Name
            """;
        var status = filter.Status?.Trim().ToLowerInvariant();
        command.Parameters.Add(new SqlParameter("@status", SqlDbType.VarChar, 10) { Value = status is "active" or "inactive" ? status : DBNull.Value });
        command.Parameters.Add(Int("@category", filter.CategoryId));
        command.Parameters.Add(Text("@pattern", string.IsNullOrWhiteSpace(filter.Search) ? null : "%" + EscapeLike(filter.Search.Trim()) + "%", 400));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<ReportListRow>();
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new ReportListRow(
                reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2), reader.GetString(3), reader.GetInt32(4), Str(reader, 5), reader.GetBoolean(6),
                NullableInt(reader, 7), reader.GetBoolean(8), reader.GetInt32(9), NullableDate(reader, 10), NullableDate(reader, 11), (byte[])reader.GetValue(12)));
        }

        return rows;
    }

    internal static string EscapeLike(string text) =>
        text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal).Replace("[", "\\[", StringComparison.Ordinal);

    public async Task<ReportDetailRow?> GetReportAsync(int reportId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT d.ReportId, d.Name, d.ReportCategoryId, c.Name, d.Description, d.HelpText, d.SortOrder, d.IsActive, d.TimeoutSeconds, d.MaxRows,
                   d.CurrentVersionId, v.VersionNo, v.SqlText, v.ParametersJson, v.ChangeNote, d.LastPreviewOkVersionId,
                   (SELECT COUNT(*) FROM dbo.RoleReport rr WHERE rr.ReportId = d.ReportId),
                   d.CreatedAt, cu.DisplayName, d.ModifiedAt, mu.DisplayName, d.RowVersion
            FROM dbo.ReportDefinition d
            JOIN dbo.ReportCategory c ON c.ReportCategoryId = d.ReportCategoryId
            LEFT JOIN dbo.ReportVersion v ON v.ReportVersionId = d.CurrentVersionId
            LEFT JOIN dbo.AppUser cu ON cu.UserId = d.CreatedByUserId
            LEFT JOIN dbo.AppUser mu ON mu.UserId = d.ModifiedByUserId
            WHERE d.ReportId = @id
            """;
        command.Parameters.Add(Int("@id", reportId));
        await using var r = await command.ExecuteReaderAsync(cancellationToken);
        if (!await r.ReadAsync(cancellationToken))
            return null;
        return new ReportDetailRow(
            r.GetInt32(0), r.GetString(1), r.GetInt32(2), r.GetString(3), Str(r, 4), Str(r, 5), r.GetInt32(6), r.GetBoolean(7), NullableInt(r, 8), NullableInt(r, 9),
            NullableInt(r, 10), NullableInt(r, 11), Str(r, 12), Str(r, 13), Str(r, 14), NullableInt(r, 15), r.GetInt32(16),
            DateTime.SpecifyKind(r.GetDateTime(17), DateTimeKind.Utc), Str(r, 18), NullableDate(r, 19), Str(r, 20), (byte[])r.GetValue(21));
    }

    public async Task<StoreResult<CreatedReport>> CreateReportAsync(NewReport report, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using (var category = connection.CreateCommand())
        {
            category.Transaction = transaction;
            category.CommandText = "SELECT 1 FROM dbo.ReportCategory WHERE ReportCategoryId = @c AND IsActive = 1";
            category.Parameters.Add(Int("@c", report.Details.CategoryId));
            if (await category.ExecuteScalarAsync(cancellationToken) is null)
                return StoreResult<CreatedReport>.Fail(StoreStatus.CategoryInvalid);
        }

        int reportId;
        await using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText =
                """
                INSERT dbo.ReportDefinition (ReportCategoryId, Name, Description, HelpText, SortOrder, IsActive, TimeoutSeconds, MaxRows, CreatedByUserId)
                OUTPUT INSERTED.ReportId
                VALUES (@category, @name, @description, @help, @sort, 0, @timeout, @maxRows, @userId)
                """;
            insert.Parameters.Add(Int("@category", report.Details.CategoryId));
            insert.Parameters.Add(Text("@name", report.Details.Name, 150));
            insert.Parameters.Add(Text("@description", report.Details.Description, 1000));
            insert.Parameters.Add(Text("@help", report.Details.HelpText, -1));
            insert.Parameters.Add(Int("@sort", report.Details.SortOrder));
            insert.Parameters.Add(Int("@timeout", report.Details.TimeoutSeconds));
            insert.Parameters.Add(Int("@maxRows", report.Details.MaxRows));
            insert.Parameters.Add(Int("@userId", report.UserId));
            try
            {
                reportId = Convert.ToInt32(await insert.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
            }
            catch (SqlException ex) when (ex.Number is 2627 or 2601)
            {
                return StoreResult<CreatedReport>.Fail(StoreStatus.DuplicateName);
            }
        }

        int versionId;
        await using (var version = connection.CreateCommand())
        {
            version.Transaction = transaction;
            version.CommandText =
                """
                INSERT dbo.ReportVersion (ReportId, VersionNo, SqlText, SqlHash, ParametersJson, ChangeNote, CreatedByUserId)
                VALUES (@id, 1, @sql, @hash, @params, @note, @userId);
                DECLARE @v int = SCOPE_IDENTITY();
                UPDATE dbo.ReportDefinition SET CurrentVersionId = @v WHERE ReportId = @id;
                SELECT @v;
                """;
            version.Parameters.Add(Int("@id", reportId));
            version.Parameters.Add(Text("@sql", report.SqlText, -1));
            version.Parameters.Add(new SqlParameter("@hash", SqlDbType.Binary, 32) { Value = report.SqlHash });
            version.Parameters.Add(Text("@params", report.ParametersJson, -1));
            version.Parameters.Add(Text("@note", report.ChangeNote, 300));
            version.Parameters.Add(Int("@userId", report.UserId));
            versionId = Convert.ToInt32(await version.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
        }

        await ReportAuditSql.WriteAsync(connection, transaction, report.UserId, correlation.Id, ReportAuditEntry.Created(reportId, report.Details.Name), cancellationToken);
        foreach (var (parameter, oldHash, newHash) in ReportDefinitionStore.ChoiceSqlChanges(null, report.ParametersJson))
            await ReportAuditSql.WriteAsync(connection, transaction, report.UserId, correlation.Id, ReportAuditEntry.ChoiceSqlChanged(reportId, report.Details.Name, parameter, oldHash, newHash), cancellationToken);

        byte[] rowVersion;
        await using (var read = connection.CreateCommand())
        {
            read.Transaction = transaction;
            read.CommandText = "SELECT RowVersion FROM dbo.ReportDefinition WHERE ReportId = @id";
            read.Parameters.Add(Int("@id", reportId));
            rowVersion = (byte[])(await read.ExecuteScalarAsync(cancellationToken))!;
        }

        await transaction.CommitAsync(cancellationToken);
        return StoreResult<CreatedReport>.Ok(new CreatedReport(reportId, versionId, 1, rowVersion));
    }

    // ---- Versions ----

    private const string VersionSelect =
        """
        SELECT v.ReportVersionId, v.VersionNo, v.CreatedAt, v.CreatedByUserId, u.DisplayName, v.ChangeNote,
               CAST(CASE WHEN d.CurrentVersionId = v.ReportVersionId THEN 1 ELSE 0 END AS bit), v.SqlHash
        FROM dbo.ReportVersion v
        JOIN dbo.ReportDefinition d ON d.ReportId = v.ReportId
        LEFT JOIN dbo.AppUser u ON u.UserId = v.CreatedByUserId
        """;

    private static VersionRow ReadVersion(SqlDataReader r) =>
        new(r.GetInt32(0), r.GetInt32(1), DateTime.SpecifyKind(r.GetDateTime(2), DateTimeKind.Utc), NullableInt(r, 3), Str(r, 4), Str(r, 5), r.GetBoolean(6), ReportAuditEntry.ShortHash((byte[])r.GetValue(7)));

    public async Task<IReadOnlyList<VersionRow>?> ListVersionsAsync(int reportId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var exists = connection.CreateCommand();
        exists.CommandText = "SELECT 1 FROM dbo.ReportDefinition WHERE ReportId = @id";
        exists.Parameters.Add(Int("@id", reportId));
        if (await exists.ExecuteScalarAsync(cancellationToken) is null)
            return null;

        await using var command = connection.CreateCommand();
        command.CommandText = VersionSelect + " WHERE v.ReportId = @id ORDER BY v.VersionNo DESC";
        command.Parameters.Add(Int("@id", reportId));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<VersionRow>();
        while (await reader.ReadAsync(cancellationToken))
            rows.Add(ReadVersion(reader));
        return rows;
    }

    public async Task<VersionDetail?> GetVersionAsync(int reportId, int versionNo, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = VersionSelect.Replace("v.SqlHash", "v.SqlHash, v.SqlText, v.ParametersJson", StringComparison.Ordinal) + " WHERE v.ReportId = @id AND v.VersionNo = @no";
        command.Parameters.Add(Int("@id", reportId));
        command.Parameters.Add(Int("@no", versionNo));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? new VersionDetail(ReadVersion(reader), reader.GetString(8), reader.GetString(9)) : null;
    }

    // ---- Assignment ----

    public async Task<IReadOnlyList<RoleAssignmentRow>?> GetReportRolesAsync(int reportId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var exists = connection.CreateCommand();
        exists.CommandText = "SELECT 1 FROM dbo.ReportDefinition WHERE ReportId = @id";
        exists.Parameters.Add(Int("@id", reportId));
        if (await exists.ExecuteScalarAsync(cancellationToken) is null)
            return null;

        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT r.RoleId, r.Name, r.Description, r.IsActive, r.IsSystemAdmin,
                   (SELECT COUNT(*) FROM dbo.UserRole ur WHERE ur.RoleId = r.RoleId),
                   CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.RoleReport rr WHERE rr.RoleId = r.RoleId AND rr.ReportId = @id) THEN 1 ELSE 0 END AS bit)
            FROM dbo.Role r
            ORDER BY r.IsActive DESC, r.Name
            """;
        command.Parameters.Add(Int("@id", reportId));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<RoleAssignmentRow>();
        while (await reader.ReadAsync(cancellationToken))
            rows.Add(new RoleAssignmentRow(reader.GetInt32(0), reader.GetString(1), Str(reader, 2), reader.GetBoolean(3), reader.GetBoolean(4), reader.GetInt32(5), reader.GetBoolean(6)));
        return rows;
    }

    public async Task<StoreResult<AssignmentDiff>> ReplaceReportRolesAsync(int reportId, IReadOnlyCollection<int> roleIds, int? userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);

        string? name;
        await using (var report = connection.CreateCommand())
        {
            report.Transaction = transaction;
            report.CommandText = "SELECT Name FROM dbo.ReportDefinition WITH (UPDLOCK, HOLDLOCK) WHERE ReportId = @id";
            report.Parameters.Add(Int("@id", reportId));
            name = await report.ExecuteScalarAsync(cancellationToken) as string;
        }

        if (name is null)
            return StoreResult<AssignmentDiff>.Fail(StoreStatus.NotFound);

        var roles = await ReadNamesAsync(connection, transaction, "SELECT RoleId, Name FROM dbo.Role", cancellationToken);
        if (roleIds.Any(id => !roles.ContainsKey(id)))
            return StoreResult<AssignmentDiff>.Fail(StoreStatus.RoleMissing);

        var current = await ReadIdsAsync(connection, transaction, "SELECT RoleId FROM dbo.RoleReport WITH (UPDLOCK, HOLDLOCK) WHERE ReportId = @id", reportId, cancellationToken);
        var wanted = roleIds.ToHashSet();
        var added = wanted.Except(current).Order().ToList();
        var removed = current.Except(wanted).Order().ToList();

        foreach (var roleId in added)
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT dbo.RoleReport (RoleId, ReportId, GrantedByUserId) VALUES (@role, @report, @userId)";
            insert.Parameters.Add(Int("@role", roleId));
            insert.Parameters.Add(Int("@report", reportId));
            insert.Parameters.Add(Int("@userId", userId));
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var roleId in removed)
        {
            await using var delete = connection.CreateCommand();
            delete.Transaction = transaction;
            delete.CommandText = "DELETE dbo.RoleReport WHERE RoleId = @role AND ReportId = @report";
            delete.Parameters.Add(Int("@role", roleId));
            delete.Parameters.Add(Int("@report", reportId));
            await delete.ExecuteNonQueryAsync(cancellationToken);
        }

        var addedNames = added.Select(id => new NamedId(id, roles[id])).ToList();
        var removedNames = removed.Select(id => new NamedId(id, roles[id])).ToList();
        if (addedNames.Count + removedNames.Count > 0)
            await ReportAuditSql.WriteAsync(connection, transaction, userId, correlation.Id, ReportAuditEntry.RolesAssigned(reportId, name, addedNames.Select(n => n.Name).ToList(), removedNames.Select(n => n.Name).ToList()), cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return StoreResult<AssignmentDiff>.Ok(new AssignmentDiff(addedNames, removedNames, wanted.Count, name));
    }

    private const string RoleReportsSql =
        """
        SELECT d.ReportId, d.Name, d.ReportCategoryId, c.Name, c.SortOrder, d.SortOrder, d.Description, d.IsActive,
               CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.RoleReport rr WHERE rr.ReportId = d.ReportId AND rr.RoleId = @role) THEN 1 ELSE 0 END AS bit)
        FROM dbo.ReportDefinition d
        JOIN dbo.ReportCategory c ON c.ReportCategoryId = d.ReportCategoryId
        ORDER BY c.SortOrder, c.Name, d.SortOrder, d.Name
        """;

    private static ReportAssignmentRow ReadAssignmentReport(SqlDataReader r) =>
        new(r.GetInt32(0), r.GetString(1), r.GetInt32(2), r.GetString(3), r.GetInt32(4), r.GetInt32(5), Str(r, 6), r.GetBoolean(7), r.GetBoolean(8));

    public async Task<IReadOnlyList<ReportAssignmentRow>?> GetRoleReportsAsync(int roleId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var exists = connection.CreateCommand();
        exists.CommandText = "SELECT 1 FROM dbo.Role WHERE RoleId = @id";
        exists.Parameters.Add(Int("@id", roleId));
        if (await exists.ExecuteScalarAsync(cancellationToken) is null)
            return null;

        await using var command = connection.CreateCommand();
        command.CommandText = RoleReportsSql;
        command.Parameters.Add(Int("@role", roleId));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<ReportAssignmentRow>();
        while (await reader.ReadAsync(cancellationToken))
            rows.Add(ReadAssignmentReport(reader));
        return rows;
    }

    public async Task<StoreResult<AssignmentDiff>> ReplaceRoleReportsAsync(int roleId, IReadOnlyCollection<int> reportIds, int? userId, CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);

        string? roleName;
        await using (var role = connection.CreateCommand())
        {
            role.Transaction = transaction;
            role.CommandText = "SELECT Name FROM dbo.Role WITH (UPDLOCK, HOLDLOCK) WHERE RoleId = @id";
            role.Parameters.Add(Int("@id", roleId));
            roleName = await role.ExecuteScalarAsync(cancellationToken) as string;
        }

        if (roleName is null)
            return StoreResult<AssignmentDiff>.Fail(StoreStatus.NotFound);

        var reports = await ReadNamesAsync(connection, transaction, "SELECT ReportId, Name FROM dbo.ReportDefinition", cancellationToken);
        if (reportIds.Any(id => !reports.ContainsKey(id)))
            return StoreResult<AssignmentDiff>.Fail(StoreStatus.ReportMissing);

        var current = await ReadIdsAsync(connection, transaction, "SELECT ReportId FROM dbo.RoleReport WITH (UPDLOCK, HOLDLOCK) WHERE RoleId = @id", roleId, cancellationToken);
        var wanted = reportIds.ToHashSet();
        var added = wanted.Except(current).Order().ToList();
        var removed = current.Except(wanted).Order().ToList();

        foreach (var reportId in added)
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT dbo.RoleReport (RoleId, ReportId, GrantedByUserId) VALUES (@role, @report, @userId)";
            insert.Parameters.Add(Int("@role", roleId));
            insert.Parameters.Add(Int("@report", reportId));
            insert.Parameters.Add(Int("@userId", userId));
            await insert.ExecuteNonQueryAsync(cancellationToken);
            await ReportAuditSql.WriteAsync(connection, transaction, userId, correlation.Id, ReportAuditEntry.RolesAssigned(reportId, reports[reportId], [roleName], []), cancellationToken);
        }

        foreach (var reportId in removed)
        {
            await using var delete = connection.CreateCommand();
            delete.Transaction = transaction;
            delete.CommandText = "DELETE dbo.RoleReport WHERE RoleId = @role AND ReportId = @report";
            delete.Parameters.Add(Int("@role", roleId));
            delete.Parameters.Add(Int("@report", reportId));
            await delete.ExecuteNonQueryAsync(cancellationToken);
            await ReportAuditSql.WriteAsync(connection, transaction, userId, correlation.Id, ReportAuditEntry.RolesAssigned(reportId, reports[reportId], [], [roleName]), cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return StoreResult<AssignmentDiff>.Ok(new AssignmentDiff(
            added.Select(id => new NamedId(id, reports[id])).ToList(),
            removed.Select(id => new NamedId(id, reports[id])).ToList(),
            wanted.Count,
            roleName));
    }

    public async Task<AssignmentMatrixRow> GetMatrixAsync(CancellationToken cancellationToken)
    {
        await using var connection = await app.OpenAsync(cancellationToken);
        var roles = new List<NamedId>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT RoleId, Name FROM dbo.Role WHERE IsActive = 1 ORDER BY Name";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                roles.Add(new NamedId(reader.GetInt32(0), reader.GetString(1)));
        }

        var reports = new List<ReportAssignmentRow>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = RoleReportsSql.Replace("= @role", "= -1", StringComparison.Ordinal);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                reports.Add(ReadAssignmentReport(reader));
        }

        var cells = new List<AssignmentCell>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT rr.RoleId, rr.ReportId FROM dbo.RoleReport rr JOIN dbo.Role r ON r.RoleId = rr.RoleId WHERE r.IsActive = 1";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                cells.Add(new AssignmentCell(reader.GetInt32(0), reader.GetInt32(1)));
        }

        return new AssignmentMatrixRow(roles, reports, cells);
    }

    private static async Task<Dictionary<int, string>> ReadNamesAsync(SqlConnection connection, SqlTransaction transaction, string sql, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var names = new Dictionary<int, string>();
        while (await reader.ReadAsync(cancellationToken))
            names[reader.GetInt32(0)] = reader.GetString(1);
        return names;
    }

    private static async Task<HashSet<int>> ReadIdsAsync(SqlConnection connection, SqlTransaction transaction, string sql, int id, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        command.Parameters.Add(Int("@id", id));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var ids = new HashSet<int>();
        while (await reader.ReadAsync(cancellationToken))
            ids.Add(reader.GetInt32(0));
        return ids;
    }
}
