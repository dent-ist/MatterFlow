using System.Globalization;
using MatterFlow.Reports.Application;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// Lists the tables and views of the database that the **report login** can SELECT from, with their columns. The metadata is read through the
/// report connection and filtered with <c>HAS_PERMS_BY_NAME</c>, so a table the login is denied (audit, credentials, the Reports tables) never
/// appears. Cached for 60 seconds (spec 7.12).
/// </summary>
internal sealed class ReportSchemaReader(IReportsAvailability availability, IMemoryCache cache) : IReportSchemaReader
{
    private const string CacheKey = "report-schema-v1";
    public static readonly TimeSpan CacheTime = TimeSpan.FromSeconds(60);

    private const string Sql =
        """
        SELECT s.name, o.name, o.type, c.name, TYPE_NAME(c.user_type_id), c.max_length, c.precision, c.scale, c.is_nullable,
               CAST(CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic
                                      JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                                      WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id) THEN 1 ELSE 0 END AS bit)
        FROM sys.objects o
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        JOIN sys.columns c ON c.object_id = o.object_id
        WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0 AND s.name = N'dbo'
          AND HAS_PERMS_BY_NAME(QUOTENAME(s.name) + N'.' + QUOTENAME(o.name), 'OBJECT', 'SELECT') = 1
        ORDER BY s.name, o.name, c.column_id
        """;

    public async Task<IReadOnlyList<SchemaTable>?> ReadAsync(CancellationToken cancellationToken)
    {
        var connectionString = availability.ReportConnectionString;
        if (connectionString is null)
            return null;
        if (cache.TryGetValue(CacheKey, out IReadOnlyList<SchemaTable>? cached) && cached is not null)
            return cached;

        var tables = new List<SchemaTable>();
        await using (var connection = new SqlConnection(connectionString))
        {
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = Sql;
            command.CommandTimeout = 15;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            string? schema = null, table = null;
            var isView = false;
            var columns = new List<SchemaColumn>();
            while (await reader.ReadAsync(cancellationToken))
            {
                var s = reader.GetString(0);
                var t = reader.GetString(1);
                if (table is not null && (s != schema || t != table))
                {
                    tables.Add(new SchemaTable(schema!, table, isView, columns));
                    columns = [];
                }

                schema = s;
                table = t;
                isView = reader.GetString(2).Trim() == "V";
                columns.Add(new SchemaColumn(reader.GetString(3), Format(reader.GetString(4), reader.GetInt16(5), reader.GetByte(6), reader.GetByte(7)), reader.GetBoolean(8), reader.GetBoolean(9)));
            }

            if (table is not null)
                tables.Add(new SchemaTable(schema!, table, isView, columns));
        }

        cache.Set(CacheKey, (IReadOnlyList<SchemaTable>)tables, CacheTime);
        return tables;
    }

    /// <summary>The type as an author writes it: <c>nvarchar(200)</c>, <c>varchar(max)</c>, <c>decimal(18,2)</c>, <c>datetime2(3)</c>.</summary>
    internal static string Format(string type, short maxLength, byte precision, byte scale)
    {
        var inv = CultureInfo.InvariantCulture;
        return type switch
        {
            "nvarchar" or "nchar" => $"{type}({(maxLength == -1 ? "max" : (maxLength / 2).ToString(inv))})",
            "varchar" or "char" or "varbinary" or "binary" => $"{type}({(maxLength == -1 ? "max" : maxLength.ToString(inv))})",
            "decimal" or "numeric" => $"{type}({precision.ToString(inv)},{scale.ToString(inv)})",
            "datetime2" or "datetimeoffset" or "time" when scale != 7 => $"{type}({scale.ToString(inv)})",
            _ => type,
        };
    }
}
