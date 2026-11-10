-- schema-fingerprint.sql
-- Purpose: describe an LPT Hub database as sorted text lines, so two databases can be compared with a plain diff (issue #1307).
-- Used by: backend/tests/LptHub.SchemaTests/BaselineEquivalenceTests.cs and tools/db/compare-schema.sh.
-- Run it as ONE batch (no GO) in the database to describe; it returns one column, `line`, already ordered.
-- It covers: tables, columns (position, type, nullability, identity, computed, collation, default constraints), primary key / unique / check /
--   foreign key constraints, every index (type, uniqueness, filter, key and included columns), sequences, functions, procedures and triggers (by a
--   hash of the normalised text), database roles and their members, every permission (database, schema, object and column level), extended
--   properties, identity counters, and the content of every table that has rows (time and row-version columns are masked, the runner journal is skipped).
-- Names that SQL Server generates (object ids, column ids) are not used; positions are ranks.

SET NOCOUNT ON;
CREATE TABLE #o (section VARCHAR(20) NOT NULL, line NVARCHAR(MAX) NOT NULL);

-- Columns
INSERT #o
SELECT 'column', t.name + N'.' + RIGHT(N'000' + CAST(ROW_NUMBER() OVER (PARTITION BY t.object_id ORDER BY c.column_id) AS NVARCHAR(10)), 3) + N' ' + c.name
  + N' ' + ty.name + N'(' + CAST(c.max_length AS NVARCHAR(10)) + N',' + CAST(c.precision AS NVARCHAR(10)) + N',' + CAST(c.scale AS NVARCHAR(10)) + N')'
  + CASE WHEN c.is_nullable = 1 THEN N' NULL' ELSE N' NOT NULL' END
  + CASE WHEN c.is_identity = 1 THEN N' IDENTITY(' + CAST(ic.seed_value AS NVARCHAR(30)) + N',' + CAST(ic.increment_value AS NVARCHAR(30)) + N')' ELSE N'' END
  + CASE WHEN c.is_computed = 1 THEN N' AS ' + cc.definition + CASE WHEN cc.is_persisted = 1 THEN N' PERSISTED' ELSE N'' END ELSE N'' END
  + ISNULL(N' COLLATE ' + c.collation_name, N'')
  + ISNULL(N' DEFAULT ' + dc.name + N'=' + dc.definition, N'')
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id;

-- Indexes, primary keys and unique constraints
INSERT #o
SELECT 'index', t.name + N'.' + i.name + N' ' + i.type_desc
  + CASE WHEN i.is_unique = 1 THEN N' UNIQUE' ELSE N'' END + CASE WHEN i.is_primary_key = 1 THEN N' PK' ELSE N'' END
  + CASE WHEN i.is_unique_constraint = 1 THEN N' UQ-CONSTRAINT' ELSE N'' END + CASE WHEN i.is_disabled = 1 THEN N' DISABLED' ELSE N'' END
  + N' fill=' + CAST(i.fill_factor AS NVARCHAR(10)) + N' pad=' + CAST(i.is_padded AS NVARCHAR(10)) + N' ignoredup=' + CAST(i.ignore_dup_key AS NVARCHAR(10))
  + N' KEY(' + ISNULL((SELECT STRING_AGG(c.name + CASE WHEN ic.is_descending_key = 1 THEN N' DESC' ELSE N'' END, N',') WITHIN GROUP (ORDER BY ic.key_ordinal)
      FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0), N'') + N')'
  + N' INCLUDE(' + ISNULL((SELECT STRING_AGG(c.name, N',') WITHIN GROUP (ORDER BY c.name)
      FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1), N'') + N')'
  + ISNULL(N' WHERE ' + i.filter_definition, N'')
FROM sys.tables t JOIN sys.indexes i ON i.object_id = t.object_id WHERE i.type > 0;

-- Check constraints (with their creation order within the table: SQL Server evaluates them in that order, and the first violated one names the error)
INSERT #o
SELECT 'check', t.name + N'.' + k.name + N' #' + CAST(ROW_NUMBER() OVER (PARTITION BY k.parent_object_id ORDER BY k.object_id) AS NVARCHAR(10)) + N' ' + k.definition + CASE WHEN k.is_disabled = 1 THEN N' DISABLED' ELSE N'' END + CASE WHEN k.is_not_trusted = 1 THEN N' NOT-TRUSTED' ELSE N'' END
FROM sys.check_constraints k JOIN sys.tables t ON t.object_id = k.parent_object_id;

-- Foreign keys
INSERT #o
SELECT 'fk', t.name + N'.' + f.name + N' (' + (SELECT STRING_AGG(pc.name, N',') WITHIN GROUP (ORDER BY fc.constraint_column_id)
      FROM sys.foreign_key_columns fc JOIN sys.columns pc ON pc.object_id = fc.parent_object_id AND pc.column_id = fc.parent_column_id WHERE fc.constraint_object_id = f.object_id)
  + N') -> ' + rt.name + N'(' + (SELECT STRING_AGG(rc.name, N',') WITHIN GROUP (ORDER BY fc.constraint_column_id)
      FROM sys.foreign_key_columns fc JOIN sys.columns rc ON rc.object_id = fc.referenced_object_id AND rc.column_id = fc.referenced_column_id WHERE fc.constraint_object_id = f.object_id)
  + N') delete=' + f.delete_referential_action_desc + N' update=' + f.update_referential_action_desc
  + CASE WHEN f.is_disabled = 1 THEN N' DISABLED' ELSE N'' END + CASE WHEN f.is_not_trusted = 1 THEN N' NOT-TRUSTED' ELSE N'' END
FROM sys.foreign_keys f JOIN sys.tables t ON t.object_id = f.parent_object_id JOIN sys.tables rt ON rt.object_id = f.referenced_object_id;

-- Sequences
INSERT #o
SELECT 'sequence', name + N' ' + TYPE_NAME(user_type_id) + N' start=' + CAST(start_value AS NVARCHAR(30)) + N' inc=' + CAST(increment AS NVARCHAR(30))
  + N' min=' + CAST(minimum_value AS NVARCHAR(30)) + N' max=' + CAST(maximum_value AS NVARCHAR(30)) + N' cycle=' + CAST(is_cycling AS NVARCHAR(5))
  + N' cached=' + CAST(is_cached AS NVARCHAR(5)) + N' current=' + CAST(current_value AS NVARCHAR(30))
FROM sys.sequences;

-- Functions, procedures, triggers: kind, name, parent, flags and a hash of the text (line endings and leading/trailing blanks removed, CREATE OR ALTER read as CREATE)
INSERT #o
SELECT 'module', o.type + N' ' + o.name + N' parent=' + ISNULL(po.name, N'') + N' ansi=' + CAST(m.uses_ansi_nulls AS NVARCHAR(5)) + N' qi=' + CAST(m.uses_quoted_identifier AS NVARCHAR(5))
  + ISNULL(N' disabled=' + CAST(tr.is_disabled AS NVARCHAR(5)), N'') + ISNULL(N' instead=' + CAST(tr.is_instead_of_trigger AS NVARCHAR(5)), N'')
  + N' sha=' + CONVERT(NVARCHAR(64), HASHBYTES('SHA2_256', LTRIM(RTRIM(REPLACE(REPLACE(m.definition, NCHAR(13), N''), N'CREATE OR ALTER', N'CREATE')))), 2)
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id LEFT JOIN sys.objects po ON po.object_id = o.parent_object_id LEFT JOIN sys.triggers tr ON tr.object_id = o.object_id;
INSERT #o
SELECT 'module', N'DDL-TRIGGER ' + name + N' disabled=' + CAST(is_disabled AS NVARCHAR(5)) + N' sha=' + CONVERT(NVARCHAR(64), HASHBYTES('SHA2_256', LTRIM(RTRIM(REPLACE(REPLACE(OBJECT_DEFINITION(object_id), NCHAR(13), N''), N'CREATE OR ALTER', N'CREATE')))), 2)
FROM sys.triggers WHERE parent_class = 0;
INSERT #o
SELECT 'module', N'DDL-EVENTS ' + t.name + N' ' + e.type_desc FROM sys.triggers t JOIN sys.trigger_events e ON e.object_id = t.object_id WHERE t.parent_class = 0;
INSERT #o
SELECT 'module', N'EVENTS ' + t.name + N' ' + e.type_desc FROM sys.triggers t JOIN sys.trigger_events e ON e.object_id = t.object_id WHERE t.parent_class = 1;

-- Principals, role membership
INSERT #o SELECT 'principal', name + N' ' + type_desc FROM sys.database_principals WHERE is_fixed_role = 0 AND name NOT IN (N'public', N'guest', N'INFORMATION_SCHEMA', N'sys');
INSERT #o
SELECT 'member', r.name + N' <- ' + m.name FROM sys.database_role_members rm
JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id;

-- Permissions of the application roles (public / guest defaults are SQL Server's own)
INSERT #o
SELECT 'permission', dp.name + N' ' + p.state_desc + N' ' + p.permission_name + N' on ' + p.class_desc + N' '
  + CASE p.class WHEN 1 THEN ISNULL(OBJECT_NAME(p.major_id), N'?') + ISNULL(N'.' + c.name, N'') WHEN 3 THEN ISNULL(SCHEMA_NAME(p.major_id), N'?') ELSE N'' END
FROM sys.database_permissions p
JOIN sys.database_principals dp ON dp.principal_id = p.grantee_principal_id
LEFT JOIN sys.columns c ON c.object_id = p.major_id AND c.column_id = p.minor_id AND p.class = 1 AND p.minor_id > 0
WHERE dp.name NOT IN (N'public', N'guest', N'dbo');

-- Extended properties
INSERT #o SELECT 'extprop', CAST(class AS NVARCHAR(5)) + N' ' + name + N'=' + CAST(value AS NVARCHAR(MAX)) FROM sys.extended_properties;

-- Table data (seed rows) and identity counters
DECLARE @t SYSNAME, @sql NVARCHAR(MAX), @cols NVARCHAR(MAX), @n BIGINT;
DECLARE tabs CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.tables WHERE name <> N'SchemaMigration' ORDER BY name;
OPEN tabs; FETCH NEXT FROM tabs INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @n = 0;
  SET @sql = N'SELECT @n = COUNT_BIG(*) FROM dbo.' + QUOTENAME(@t);
  EXEC sp_executesql @sql, N'@n BIGINT OUTPUT', @n OUTPUT;
  INSERT #o VALUES ('rows', @t + N' count=' + CAST(@n AS NVARCHAR(30)));
  IF @n > 0
  BEGIN
    SELECT @cols = STRING_AGG(QUOTENAME(c.name), N',') WITHIN GROUP (ORDER BY c.column_id)
    FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.' + @t) AND ty.name NOT IN (N'datetime', N'datetime2', N'datetimeoffset', N'smalldatetime', N'timestamp', N'date', N'time');
    SET @sql = N'INSERT #o SELECT ''rows'', N''' + @t + N' '' + (SELECT ' + @cols + N' FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) FROM dbo.' + QUOTENAME(@t);
    EXEC sp_executesql @sql;
  END;
  FETCH NEXT FROM tabs INTO @t;
END;
CLOSE tabs; DEALLOCATE tabs;
INSERT #o
SELECT 'identity', t.name + N' next=' + CAST(ISNULL(IDENT_CURRENT(N'dbo.' + t.name), 0) AS NVARCHAR(30))
FROM sys.tables t WHERE t.name <> N'SchemaMigration' AND OBJECTPROPERTY(t.object_id, 'TableHasIdentity') = 1;

SELECT section + N' | ' + line AS line FROM #o ORDER BY section, line COLLATE Latin1_General_BIN2;
DROP TABLE #o;
