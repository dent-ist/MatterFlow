-- Top statements by total elapsed time since the plan cache was last cleared (run after a load test, before restoring/restarting).
-- sqlcmd -I -d MatterFlow -W -w 400 -i top-queries.sql
SET NOCOUNT ON;
SELECT TOP (25)
    qs.execution_count AS execs,
    CAST(qs.total_elapsed_time / 1000.0 AS DECIMAL(12, 0)) AS total_ms,
    CAST(qs.total_elapsed_time / 1000.0 / qs.execution_count AS DECIMAL(10, 1)) AS avg_ms,
    CAST(qs.max_elapsed_time / 1000.0 AS DECIMAL(10, 0)) AS max_ms,
    CAST(qs.total_worker_time / 1000.0 / qs.execution_count AS DECIMAL(10, 1)) AS avg_cpu_ms,
    qs.total_logical_reads / qs.execution_count AS avg_reads,
    qs.total_rows / qs.execution_count AS avg_rows,
    LEFT(REPLACE(REPLACE(SUBSTRING(st.text, qs.statement_start_offset / 2 + 1,
        (CASE WHEN qs.statement_end_offset = -1 THEN LEN(CONVERT(NVARCHAR(MAX), st.text)) * 2 ELSE qs.statement_end_offset END - qs.statement_start_offset) / 2 + 1), CHAR(13), ' '), CHAR(10), ' '), 260) AS stmt
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
WHERE st.dbid = DB_ID() OR st.dbid IS NULL
ORDER BY qs.total_elapsed_time DESC;
GO
-- missing index suggestions (ranked by impact)
SELECT TOP (15) CAST(gs.avg_total_user_cost * gs.avg_user_impact * (gs.user_seeks + gs.user_scans) AS DECIMAL(14, 0)) AS impact,
    gs.user_seeks, gs.user_scans, mid.statement, mid.equality_columns, mid.inequality_columns, mid.included_columns
FROM sys.dm_db_missing_index_group_stats gs
JOIN sys.dm_db_missing_index_groups mig ON mig.index_group_handle = gs.group_handle
JOIN sys.dm_db_missing_index_details mid ON mid.index_handle = mig.index_handle
WHERE mid.database_id = DB_ID()
ORDER BY impact DESC;
GO
