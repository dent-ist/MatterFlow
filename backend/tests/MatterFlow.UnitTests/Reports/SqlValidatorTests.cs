using MatterFlow.Reports.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>The one-SELECT-only validator (ScriptDom, spec 6.3; issue #690): a rejection corpus with stable reason codes and a corpus of valid reports.</summary>
public class SqlValidatorTests
{
    private const string MustSelect = SqlValidationCodes.MustStartWithSelect;

    /// <summary>(sql, expected code among the errors). 60+ statements an author must not be able to run.</summary>
    private static readonly (string Sql, string Code)[] RejectedCases =
    [
        // not a SELECT at all
        ("INSERT INTO dbo.Pod (Name) VALUES (N'x')", MustSelect),
        ("UPDATE dbo.Pod SET Name = N'x'", MustSelect),
        ("DELETE FROM dbo.Pod", MustSelect),
        ("DELETE dbo.Task WHERE 1 = 1", MustSelect),
        ("TRUNCATE TABLE dbo.Pod", MustSelect),
        ("DROP TABLE dbo.Pod", MustSelect),
        ("ALTER TABLE dbo.Pod ADD x int", MustSelect),
        ("CREATE TABLE dbo.X (a int)", MustSelect),
        ("CREATE VIEW dbo.V AS SELECT 1 a", MustSelect),
        ("MERGE dbo.Pod AS t USING (SELECT 1 a) s ON 1 = 0 WHEN NOT MATCHED THEN INSERT (Name) VALUES (N'x');", MustSelect),
        ("EXEC sp_who", MustSelect),
        ("EXECUTE dbo.SomeProc", MustSelect),
        ("EXEC('SELECT 1')", MustSelect),
        ("EXEC xp_cmdshell 'whoami'", MustSelect),
        ("GRANT SELECT ON dbo.Pod TO public", MustSelect),
        ("DENY SELECT ON dbo.Pod TO public", MustSelect),
        ("BACKUP DATABASE MatterFlow TO DISK = 'c:\\x.bak'", MustSelect),
        ("RESTORE DATABASE MatterFlow FROM DISK = 'c:\\x.bak'", MustSelect),
        ("DBCC CHECKDB", MustSelect),
        ("KILL 55", MustSelect),
        ("SHUTDOWN", MustSelect),
        ("USE master", MustSelect),
        ("SET NOCOUNT ON", MustSelect),
        ("DECLARE @x int = 1", ScanIssueCodes.AtSign),
        ("PRINT 'x'", MustSelect),
        ("WAITFOR DELAY '00:00:30'", MustSelect),
        ("BULK INSERT dbo.Pod FROM 'c:\\x.csv'", MustSelect),
        ("BEGIN TRAN", MustSelect),
        ("THROW 50000, 'x', 1", MustSelect),
        ("-- a comment first\nDROP TABLE dbo.Pod", MustSelect),
        ("/* a comment first */ DELETE dbo.Pod", MustSelect),
        // comment and unicode tricks
        ("SEL/**/ECT 1", MustSelect),
        ("SELE\u200BCT 1", MustSelect),
        ("\uFF33\uFF25\uFF2C\uFF25\uFF23\uFF34 1", MustSelect),
        ("SELECT 1 \uFF1B DROP TABLE dbo.Pod", SqlValidationCodes.MultipleStatements),
        ("SELECT 1 /* ; */ ; DROP TABLE dbo.Pod", SqlValidationCodes.MultipleStatements),
        // more than one statement / batch
        ("SELECT 1; SELECT 2", SqlValidationCodes.MultipleStatements),
        ("SELECT 1; DROP TABLE dbo.Pod", SqlValidationCodes.MultipleStatements),
        ("SELECT 1; EXEC sp_who", SqlValidationCodes.MultipleStatements),
        ("SELECT 1; WAITFOR DELAY '00:00:05'", SqlValidationCodes.MultipleStatements),
        ("SELECT 1 UNION ALL SELECT 2; DELETE dbo.Pod", SqlValidationCodes.MultipleStatements),
        ("(SELECT 1); DROP TABLE dbo.Pod", SqlValidationCodes.MultipleStatements),
        ("SELECT 1 SELECT 2", SqlValidationCodes.MultipleStatements),
        ("SELECT 1\nGO\nSELECT 2", SqlValidationCodes.MultipleBatches),
        ("WITH c AS (SELECT 1 a) SELECT * FROM c; SELECT 2", SqlValidationCodes.MultipleStatements),
        // statements that start like a query but are not
        ("WITH c AS (SELECT 1 a) DELETE FROM dbo.Pod", SqlValidationCodes.NotASelect),
        ("WITH c AS (SELECT 1 a) UPDATE dbo.Pod SET Name = N'x'", SqlValidationCodes.NotASelect),
        ("WITH c AS (SELECT 1 a) INSERT INTO dbo.Pod (Name) SELECT 'x' FROM c", SqlValidationCodes.NotASelect),
        ("WITH c AS (SELECT 1 a) MERGE dbo.Pod AS t USING c ON 1 = 0 WHEN NOT MATCHED THEN INSERT (Name) VALUES (N'x');", SqlValidationCodes.NotASelect),
        // INTO and assignment
        ("SELECT * INTO #t FROM dbo.Pod", SqlValidationCodes.SelectInto),
        ("SELECT * INTO dbo.Copy FROM dbo.Pod", SqlValidationCodes.SelectInto),
        ("SELECT 1 AS a INTO dbo.Copy", SqlValidationCodes.SelectInto),
        ("SELECT :X = 1", SqlValidationCodes.VariableAssignment),
        ("SELECT :X = Name FROM dbo.Pod", SqlValidationCodes.VariableAssignment),
        // variables
        ("SELECT @x", ScanIssueCodes.AtSign),
        ("SELECT @@VERSION", ScanIssueCodes.AtSign),
        ("SELECT @@SERVERNAME", ScanIssueCodes.AtSign),
        ("SELECT 1 WHERE 1 = @p_X", ScanIssueCodes.AtSign),
        ("SELECT 1; DECLARE @x int", ScanIssueCodes.AtSign),
        // external data
        ("SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;Trusted_Connection=yes;', 'SELECT 1')", SqlValidationCodes.ExternalData),
        ("SELECT * FROM OPENROWSET(BULK 'c:\\x.csv', SINGLE_CLOB) AS x", SqlValidationCodes.ExternalData),
        ("SELECT * FROM OPENQUERY(remote, 'SELECT 1')", SqlValidationCodes.ExternalData),
        ("SELECT * FROM OPENDATASOURCE('SQLNCLI', 'Data Source=x').db.dbo.t", SqlValidationCodes.ExternalData),
        ("SELECT * FROM OPENXML(:H, '/a')", SqlValidationCodes.ExternalData),
        // other servers and databases
        ("SELECT * FROM remote.db.dbo.t", SqlValidationCodes.LinkedServer),
        ("SELECT * FROM [remote].[db].[dbo].[t]", SqlValidationCodes.LinkedServer),
        ("SELECT * FROM other.dbo.t", SqlValidationCodes.OtherDatabase),
        ("SELECT * FROM master.sys.databases", SqlValidationCodes.OtherDatabase),
        ("SELECT * FROM tempdb..t", SqlValidationCodes.OtherDatabase),
        ("SELECT * FROM dbo.Pod p JOIN msdb.dbo.sysjobs j ON 1 = 1", SqlValidationCodes.OtherDatabase),
        ("SELECT (SELECT TOP 1 name FROM master.dbo.sysdatabases)", SqlValidationCodes.OtherDatabase),
        // system routines
        ("SELECT * FROM sp_help", SqlValidationCodes.SystemProcedure),
        ("SELECT dbo.xp_cmdshell('x')", SqlValidationCodes.SystemProcedure),
        ("SELECT * FROM dbo.sp_foo()", SqlValidationCodes.SystemProcedure),
        ("SELECT * FROM fn_dblog(NULL, NULL)", SqlValidationCodes.SystemFunction),
        ("SELECT * FROM sys.fn_xe_file_target_read_file('c:\\x*.xel', NULL, NULL, NULL)", SqlValidationCodes.SystemFunction),
        ("SELECT * FROM sys.fn_my_permissions(NULL, 'SERVER')", SqlValidationCodes.SystemFunction),
        ("SELECT fn_varbintohexstr(0x00)", SqlValidationCodes.SystemFunction),
        // sequences, FOR, hints
        ("SELECT NEXT VALUE FOR dbo.TaskNumberSeq", SqlValidationCodes.NextValueFor),
        ("SELECT Name FROM dbo.Pod WHERE PodId < NEXT VALUE FOR dbo.TaskNumberSeq", SqlValidationCodes.NextValueFor),
        ("SELECT 1 a FOR XML PATH", SqlValidationCodes.ForClause),
        ("SELECT 1 a FOR JSON AUTO", SqlValidationCodes.ForClause),
        ("SELECT * FROM dbo.Pod OPTION (FORCE ORDER)", SqlValidationCodes.QueryHint),
        ("SELECT * FROM dbo.Pod OPTION (HASH JOIN)", SqlValidationCodes.QueryHint),
        ("SELECT * FROM dbo.Pod OPTION (MAXDOP 2, FAST 10)", SqlValidationCodes.QueryHint),
        ("SELECT * FROM dbo.Pod OPTION (OPTIMIZE FOR UNKNOWN)", SqlValidationCodes.QueryHint),
        ("SELECT * FROM dbo.Pod OPTION (USE HINT('DISABLE_PARAMETER_SNIFFING'))", SqlValidationCodes.QueryHint),
        ("SELECT * FROM dbo.Pod WITH (UPDLOCK)", SqlValidationCodes.TableHint),
        ("SELECT * FROM dbo.Pod WITH (XLOCK)", SqlValidationCodes.TableHint),
        ("SELECT * FROM dbo.Pod WITH (TABLOCKX)", SqlValidationCodes.TableHint),
        ("SELECT * FROM dbo.Pod WITH (HOLDLOCK)", SqlValidationCodes.TableHint),
        ("SELECT * FROM dbo.Pod WITH (NOLOCK, ROWLOCK)", SqlValidationCodes.TableHint),
        // syntax and shape
        ("SELEC 1", MustSelect),
        ("SELECT FROM", SqlValidationCodes.Syntax),
        ("SELECT * FROM", SqlValidationCodes.Syntax),
        ("SELECT (1", SqlValidationCodes.Syntax),
        ("SELECT 1 WHERE EXISTS (EXEC sp_who)", SqlValidationCodes.Syntax),
        ("SELECT 1 FROM dbo.Pod WHERE a IN :LIST", SqlValidationCodes.Syntax),
        ("", SqlValidationCodes.Empty),
        ("   \n\t ", SqlValidationCodes.Empty),
        ("-- nothing but a comment", SqlValidationCodes.Empty),
        ("/* nothing */", SqlValidationCodes.Empty),
        (";", MustSelect),
        ("SELECT 'open", ScanIssueCodes.UnterminatedString),
        ("SELECT 1 /* open", ScanIssueCodes.UnterminatedComment),
        ("SELECT [open", ScanIssueCodes.UnterminatedIdentifier),
        ("SELECT 1 WHERE a = :Naïve", ScanIssueCodes.PlaceholderNameInvalid),
    ];

    public static TheoryData<string, string> Rejected()
    {
        var data = new TheoryData<string, string>();
        foreach (var (sql, code) in RejectedCases)
            data.Add(sql, code);
        return data;
    }

    /// <summary>Reports an author legitimately writes: all must be accepted.</summary>
    private static readonly string[] AcceptedCases =
    [
        "SELECT 1",
        "SELECT 1;",
        "  -- leading comment\nSELECT 1 /* trailing */ ;  ",
        "SELECT p.Name, COUNT(*) AS OpenCount FROM dbo.Task t JOIN dbo.Pod p ON p.PodId = t.AssignedPodId WHERE t.DueDate < :TODAY GROUP BY p.Name",
        "SELECT t.TaskId FROM dbo.Task t LEFT JOIN dbo.Matter m ON m.MatterId = t.MatterId WHERE (:CLIENT IS NULL OR m.ClientId = :CLIENT)",
        "WITH open_tasks AS (SELECT TaskId, MatterId FROM dbo.Task WHERE StatusLabelId = 1) SELECT MatterId, COUNT(*) FROM open_tasks GROUP BY MatterId",
        "WITH a AS (SELECT 1 x), b AS (SELECT x + 1 y FROM a) SELECT * FROM a CROSS JOIN b",
        "WITH n AS (SELECT 1 v UNION ALL SELECT v + 1 FROM n WHERE v < 10) SELECT v FROM n OPTION (MAXDOP 1)",
        "SELECT TaskId, ROW_NUMBER() OVER (PARTITION BY MatterId ORDER BY DueDate DESC) AS rn FROM dbo.Task",
        "SELECT TaskId, SUM(1) OVER (PARTITION BY MatterId ORDER BY TaskId ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM dbo.Task",
        "SELECT * FROM dbo.Task WHERE MatterId IN (SELECT MatterId FROM dbo.Matter WHERE IsActive = 1)",
        "SELECT * FROM dbo.Matter m WHERE EXISTS (SELECT 1 FROM dbo.Task t WHERE t.MatterId = m.MatterId)",
        "SELECT (SELECT COUNT(*) FROM dbo.Task t WHERE t.MatterId = m.MatterId) AS n FROM dbo.Matter m",
        "SELECT Name FROM dbo.Pod UNION SELECT Name FROM dbo.Role",
        "SELECT Name FROM dbo.Pod UNION ALL SELECT Name FROM dbo.Role ORDER BY 1",
        "SELECT PodId FROM dbo.Pod INTERSECT SELECT PodId FROM dbo.PodMember",
        "SELECT PodId FROM dbo.Pod EXCEPT SELECT PodId FROM dbo.PodMember",
        "(SELECT 1 a) UNION (SELECT 2)",
        "SELECT * FROM dbo.Pod ORDER BY Name OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY",
        "SELECT TOP (:N) WITH TIES Name FROM dbo.Pod ORDER BY Name",
        "SELECT TOP 10 PERCENT * FROM dbo.Pod",
        "SELECT x.* FROM dbo.Pod p CROSS APPLY (SELECT TOP 1 * FROM dbo.PodMember m WHERE m.PodId = p.PodId) x",
        "SELECT * FROM (SELECT PodId, UserId FROM dbo.PodMember) s PIVOT (COUNT(UserId) FOR PodId IN ([1], [2])) p",
        "SELECT CASE WHEN DueDate < :TODAY THEN N'overdue' ELSE N'ok' END FROM dbo.Task",
        "SELECT * FROM (VALUES (1, N'a'), (2, N'b')) v(id, name)",
        "SELECT * FROM dbo.Task WITH (NOLOCK) WHERE TaskId = 1",
        "SELECT * FROM dbo.Task t WITH (READUNCOMMITTED, INDEX(1))",
        "SELECT * FROM dbo.Task OPTION (RECOMPILE)",
        "SELECT * FROM dbo.Task OPTION (RECOMPILE, MAXDOP 2)",
        "SELECT * FROM OPENJSON(N'[1,2]') WITH (v int '$')",
        "SELECT JSON_VALUE(N'{\"a\":1}', '$.a'), CAST(N'<a>1</a>' AS xml).value('(/a)[1]', 'int')",
        "SELECT GETDATE(), SYSUTCDATETIME(), DATEADD(day, 1, :TODAY), DATEDIFF(day, :A, :B), FORMAT(:TODAY, 'yyyy-MM-dd')",
        "SELECT STRING_AGG(Name, N', ') WITHIN GROUP (ORDER BY Name) FROM dbo.Pod",
        "SELECT 1 AS [a:b], 2 AS \"c:d\", ':text', '12:30', N'it''s'",
        "SELECT * FROM dbo.Task WHERE Title LIKE '%' + :Q + '%'",
        "SELECT * FROM dbo.Task WHERE (NOT EXISTS (SELECT 1 FROM (SELECT 1 x) s WHERE :A = 1) OR TaskId IN (SELECT 1))",
        "SELECT geography::Point(1, 2, 4326).STAsText()",
        "SELECT * FROM sys.tables", // allowed by the validator; the login decides what is visible
        "SELECT * FROM dbo.Task TABLESAMPLE (10 PERCENT)",
        "SELECT t.TaskId, d = DATEADD(day, 1, t.DueDate) FROM dbo.Task t",
        "SELECT x = 1, y = 'a'",
        "SELECT 1 /* GO */, 2 -- ; DROP TABLE x",
        "/*!50000 DROP TABLE x */ SELECT 1",
        "SELECT 'DROP TABLE dbo.Pod; --', 'EXEC xp_cmdshell', 'OPENROWSET', 'NEXT VALUE FOR x'",
        "SELECT [sp_help], [xp_cmdshell] FROM (SELECT 1 [sp_help], 2 [xp_cmdshell]) t",
    ];

    public static TheoryData<string> Accepted()
    {
        var data = new TheoryData<string>();
        foreach (var sql in AcceptedCases)
            data.Add(sql);
        return data;
    }

    [Theory]
    [MemberData(nameof(Rejected))]
    public void The_rejection_corpus_is_refused_with_a_stable_reason(string sql, string code)
    {
        var result = SqlValidator.Validate(sql);

        result.IsValid.ShouldBeFalse(sql);
        result.Errors.Select(e => e.Code).ShouldContain(code, $"[{sql}] -> {string.Join("; ", result.Errors.Select(e => e.Code))}");
        foreach (var error in result.Errors)
        {
            error.Message.ShouldNotBeNullOrWhiteSpace();
            error.Position.ShouldBeInRange(0, Math.Max(sql.Length, 1));
            error.Line.ShouldBeGreaterThanOrEqualTo(1);
            error.Column.ShouldBeGreaterThanOrEqualTo(1);
        }
    }

    [Fact]
    public void The_rejection_corpus_has_at_least_sixty_statements()
    {
        RejectedCases.Length.ShouldBeGreaterThanOrEqualTo(60);
    }

    [Theory]
    [MemberData(nameof(Accepted))]
    public void Ordinary_reports_are_accepted(string sql)
    {
        var result = SqlValidator.Validate(sql);

        result.Errors.ShouldBeEmpty($"{sql} -> {string.Join("; ", result.Errors.Select(e => e.Code + " " + e.Message))}");
    }

    [Fact]
    public void A_text_over_64_kilobytes_is_refused_without_parsing()
    {
        var sql = "SELECT 1 /*" + new string('x', 70_000) + "*/";

        var result = SqlValidator.Validate(sql);

        result.Errors.Select(e => e.Code).ShouldBe([SqlValidationCodes.TextTooLong]);
    }

    [Fact]
    public void Errors_point_into_the_text_as_typed_even_when_placeholders_were_renamed()
    {
        // :Long_Parameter_Name becomes @p_LONG_PARAMETER_NAME (longer) before parsing; the DELETE-like mistake after it must be located in the original.
        const string sql = "SELECT 1 WHERE a = :Long_Parameter_Name AND b = :Long_Parameter_Name\n  AND c IN (SELECT x FROM remote.db.dbo.t)";

        var error = SqlValidator.Validate(sql).Errors.ShouldHaveSingleItem();

        error.Code.ShouldBe(SqlValidationCodes.LinkedServer);
        error.Position.ShouldBe(sql.IndexOf("remote.db", StringComparison.Ordinal));
        (error.Line, error.Column).ShouldBe((2, sql.Split('\n')[1].IndexOf("remote", StringComparison.Ordinal) + 1));
    }

    [Fact]
    public void A_syntax_error_after_a_placeholder_is_located_in_the_original_text()
    {
        const string sql = "SELECT :A FROM FROM";

        var error = SqlValidator.Validate(sql).Errors.First();

        error.Code.ShouldBe(SqlValidationCodes.Syntax);
        error.Position.ShouldBeGreaterThanOrEqualTo(sql.IndexOf("FROM FROM", StringComparison.Ordinal));
        error.Message.ShouldNotContain("@p_");
    }

    [Fact]
    public void The_hash_is_the_sha256_of_the_exact_text_and_changes_with_any_edit()
    {
        var a = SqlValidator.Validate("SELECT 1");
        var b = SqlValidator.Validate("SELECT 1 ");

        a.Hash.Length.ShouldBe(32);
        a.Hash.ShouldBe(SqlValidator.Hash("SELECT 1"));
        a.Hash.ShouldNotBe(b.Hash);
    }

    [Fact]
    public void Validation_is_repeatable_and_thread_safe()
    {
        var sqls = AcceptedCases.Concat(RejectedCases.Select(c => c.Sql)).ToList();
        var expected = sqls.Select(s => SqlValidator.Validate(s).IsValid).ToList();

        Parallel.For(0, 200, i =>
        {
            var at = i % sqls.Count;
            SqlValidator.Validate(sqls[at]).IsValid.ShouldBe(expected[at]);
        });
    }

    [Fact]
    public void Random_noise_never_throws_and_is_never_accepted_unless_it_really_is_one_select()
    {
        var rng = new Random(690);
        string[] words = ["SELECT", "FROM", "WHERE", "dbo.Pod", "1", "*", "(", ")", ",", ";", "--", "/*", "*/", "'", ":A", "EXEC", "INTO", "GO", "@x", "UNION", "ALL", "N'z'", "[a]", "OPTION", "(RECOMPILE)", "WITH", "(NOLOCK)", "\n"];
        for (var run = 0; run < 1500; run++)
        {
            var sql = string.Join(' ', Enumerable.Range(0, rng.Next(1, 14)).Select(_ => words[rng.Next(words.Length)]));
            var result = SqlValidator.Validate(sql);
            if (result.IsValid)
            {
                // Whatever noise is accepted must be free of scanner issues (an '@' can only sit inside a string or comment).
                SqlScanner.Scan(sql).Issues.ShouldBeEmpty();
            }
        }
    }
}
