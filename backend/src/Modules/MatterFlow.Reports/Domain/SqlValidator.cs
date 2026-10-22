using System.Security.Cryptography;
using System.Text;
using Microsoft.SqlServer.TransactSql.ScriptDom;

namespace MatterFlow.Reports.Domain;

/// <summary>One reason a query was refused. <see cref="Code"/> is stable (tests and the UI rely on it); the position is in the text as the author typed it.</summary>
public sealed record SqlValidationError(string Code, string Message, int Position, int Line, int Column);

/// <summary>The outcome of validating a query. <see cref="Hash"/> is the SHA-256 of the exact text and is stored with the version.</summary>
public sealed record SqlValidationResult(IReadOnlyList<SqlValidationError> Errors, byte[] Hash)
{
    public bool IsValid => Errors.Count == 0;
}

/// <summary>Stable error codes of the validator.</summary>
public static class SqlValidationCodes
{
    public const string Empty = "EMPTY";
    public const string TextTooLong = ScanIssueCodes.TextTooLong;
    public const string MustStartWithSelect = "MUST_START_WITH_SELECT";
    public const string Syntax = "SYNTAX_ERROR";
    public const string MultipleBatches = "MULTIPLE_BATCHES";
    public const string MultipleStatements = "MULTIPLE_STATEMENTS";
    public const string NotASelect = "NOT_A_SELECT";
    public const string SelectInto = "SELECT_INTO";
    public const string VariableAssignment = "VARIABLE_ASSIGNMENT";
    public const string Execute = "EXECUTE_NOT_ALLOWED";
    public const string SystemProcedure = "SYSTEM_PROCEDURE";
    public const string ExternalData = "EXTERNAL_DATA_ACCESS";
    public const string LinkedServer = "LINKED_SERVER";
    public const string OtherDatabase = "OTHER_DATABASE";
    public const string NextValueFor = "NEXT_VALUE_FOR";
    public const string ForClause = "FOR_CLAUSE";
    public const string QueryHint = "QUERY_HINT";
    public const string TableHint = "TABLE_HINT";
    public const string SystemFunction = "SYSTEM_FUNCTION";
    public const string Variable = "VARIABLE_NOT_ALLOWED";
    public const string BatchSeparator = "BATCH_SEPARATOR";
}

/// <summary>
/// Layer 1 of the report defences (spec 6.3), run on every analyze, save, preview and run: the text must be exactly one batch holding exactly one
/// <c>SELECT</c> (CTEs, <c>UNION</c> and subqueries included) and none of the constructs that read files, other servers or other databases,
/// run procedures, assign variables, create tables, take locks or write. It is **defence in depth only**: the report login's permissions are the
/// real control, so this class refuses anything it cannot parse and never tries to be clever.
/// </summary>
public static class SqlValidator
{
    /// <summary>SHA-256 of the exact text (UTF-8); stored with each version and compared at run time.</summary>
    public static byte[] Hash(string sql) => SHA256.HashData(Encoding.UTF8.GetBytes(sql));

    /// <summary>Validates the text with every placeholder read as a single value (<c>@p_NAME</c>).</summary>
    public static SqlValidationResult Validate(string sql)
    {
        ArgumentNullException.ThrowIfNull(sql);
        var scan = SqlScanner.Scan(sql);
        return Validate(sql, scan, SqlPlaceholderRewriter.RewriteMapped(sql, scan.Occurrences, o => SqlPlaceholderRewriter.ParameterName(o.Name)));
    }

    /// <summary>
    /// Validates <paramref name="sql"/>; <paramref name="parse"/> is the text the parser sees (placeholders already replaced by the engine, for
    /// example by the multi-choice sub-select) and carries the spans that map positions back to the author's text.
    /// </summary>
    public static SqlValidationResult Validate(string sql, SqlScan scan, RewrittenSql parse)
    {
        ArgumentNullException.ThrowIfNull(sql);
        var hash = Hash(sql);
        var errors = new List<SqlValidationError>();
        var positions = new PositionMap(sql, parse);

        if (sql.Length > SqlScanner.MaxQueryLength)
        {
            errors.Add(new(SqlValidationCodes.TextTooLong, $"The query is longer than {SqlScanner.MaxQueryLength:N0} characters.", SqlScanner.MaxQueryLength, 1, 1));
            return new(errors, hash);
        }

        if (string.IsNullOrWhiteSpace(sql))
        {
            errors.Add(new(SqlValidationCodes.Empty, "Enter a query.", 0, 1, 1));
            return new(errors, hash);
        }

        foreach (var issue in scan.Issues)
            errors.Add(new(issue.Code, issue.Message, issue.Position, issue.Line, issue.Column));
        if (errors.Count > 0)
            return new(errors, hash);

        // Parse the text as the engine will send it.
        var parser = new TSql160Parser(initialQuotedIdentifiers: true);
        TSqlFragment fragment;
        IList<ParseError> parseErrors;
        using (var reader = new StringReader(parse.Text))
            fragment = parser.Parse(reader, out parseErrors);

        var first = fragment is null ? null : FirstSignificantToken(fragment);
        if (first is not null && !StartsAQuery(first))
        {
            errors.Add(positions.Error(SqlValidationCodes.MustStartWithSelect, "A report query must start with SELECT or WITH.", first.Offset));
            return new(errors, hash);
        }

        if (parseErrors.Count > 0 || fragment is null)
        {
            errors.AddRange(parseErrors.Take(5).Select(e => positions.Error(
                IsBatchSeparator(e.Message) ? SqlValidationCodes.BatchSeparator : SqlValidationCodes.Syntax,
                CleanMessage(e.Message),
                e.Offset)));
            return new(errors, hash);
        }

        if (fragment is not TSqlScript script)
        {
            errors.Add(positions.Error(SqlValidationCodes.Syntax, "The text could not be read as a query.", 0));
            return new(errors, hash);
        }

        if (script.Batches.Count == 0 || script.Batches.All(b => b.Statements.Count == 0))
        {
            errors.Add(new(SqlValidationCodes.Empty, "Enter a query.", 0, 1, 1));
            return new(errors, hash);
        }

        if (script.Batches.Count != 1)
        {
            errors.Add(positions.Error(SqlValidationCodes.MultipleBatches, "Only one batch is allowed (no GO).", script.Batches.Count > 1 ? script.Batches[1].StartOffset : 0));
            return new(errors, hash);
        }

        var statements = script.Batches[0].Statements;
        if (statements.Count == 0)
        {
            errors.Add(new(SqlValidationCodes.Empty, "Enter a query.", 0, 1, 1));
            return new(errors, hash);
        }

        if (statements.Count > 1)
        {
            errors.Add(positions.Error(SqlValidationCodes.MultipleStatements, "Only one statement is allowed. Remove everything after the first SELECT.", statements[1].StartOffset));
            return new(errors, hash);
        }

        if (statements[0] is not SelectStatement select || select is SelectStatementSnippet)
        {
            errors.Add(positions.Error(SqlValidationCodes.NotASelect, "Only a single SELECT statement is allowed.", statements[0].StartOffset));
            return new(errors, hash);
        }

        select.Accept(new DefenceVisitor(positions, errors));
        return new(errors.OrderBy(e => e.Position).ThenBy(e => e.Code, StringComparer.Ordinal).ToList(), hash);
    }

    private static bool StartsAQuery(TSqlParserToken t) =>
        t.TokenType is TSqlTokenType.Select or TSqlTokenType.With or TSqlTokenType.LeftParenthesis;

    private static TSqlParserToken? FirstSignificantToken(TSqlFragment fragment) =>
        fragment.ScriptTokenStream?.FirstOrDefault(t =>
            t.TokenType is not (TSqlTokenType.WhiteSpace or TSqlTokenType.SingleLineComment or TSqlTokenType.MultilineComment or TSqlTokenType.EndOfFile));

    private static bool IsBatchSeparator(string message) => message.Contains("'GO'", StringComparison.OrdinalIgnoreCase);

    private static string CleanMessage(string message) => message.Replace("@p_", ":", StringComparison.Ordinal);

    /// <summary>Turns offsets in the text the parser saw into positions (offset, line, column) in the text the author typed.</summary>
    private sealed class PositionMap
    {
        private readonly int _length;
        private readonly RewrittenSql _parse;
        private readonly List<int> _lineStarts = [0];

        public PositionMap(string original, RewrittenSql parse)
        {
            _length = original.Length;
            _parse = parse;
            for (var k = 0; k < original.Length; k++)
            {
                if (original[k] == '\n' || (original[k] == '\r' && !(k + 1 < original.Length && original[k + 1] == '\n')))
                    _lineStarts.Add(k + 1);
            }
        }

        public SqlValidationError Error(string code, string message, int parseOffset)
        {
            var index = Math.Clamp(_parse.ToOriginal(parseOffset), 0, _length);
            var lo = 0;
            var hi = _lineStarts.Count - 1;
            while (lo < hi)
            {
                var mid = (lo + hi + 1) >>> 1;
                if (_lineStarts[mid] <= index)
                    lo = mid;
                else
                    hi = mid - 1;
            }

            return new(code, message, index, lo + 1, index - _lineStarts[lo] + 1);
        }
    }

    /// <summary>Walks the whole SELECT, including subqueries and CTEs, and records every forbidden construct.</summary>
    private sealed class DefenceVisitor(PositionMap positions, List<SqlValidationError> errors) : TSqlFragmentVisitor
    {
        private static readonly HashSet<TableHintKind> AllowedTableHints =
        [
            TableHintKind.NoLock, TableHintKind.ReadUncommitted, TableHintKind.ReadCommitted, TableHintKind.ReadPast, TableHintKind.NoExpand,
            TableHintKind.Index, TableHintKind.ForceSeek, TableHintKind.ForceScan,
        ];

        private void Add(string code, string message, TSqlFragment at) => errors.Add(positions.Error(code, message, at.StartOffset));

        public override void ExplicitVisit(QuerySpecification node)
        {
            if (node.ForClause is not null)
                Add(SqlValidationCodes.ForClause, "FOR XML, FOR JSON, FOR BROWSE and FOR UPDATE are not allowed: reports return a plain table.", node.ForClause);
            base.ExplicitVisit(node);
        }

        public override void ExplicitVisit(SelectSetVariable node)
        {
            Add(SqlValidationCodes.VariableAssignment, "Assigning a value to a variable in a SELECT is not allowed.", node);
            base.ExplicitVisit(node);
        }

        public override void ExplicitVisit(ExecuteSpecification node) => Add(SqlValidationCodes.Execute, "EXEC / EXECUTE is not allowed.", node);

        public override void ExplicitVisit(ExecutableProcedureReference node) => Add(SqlValidationCodes.Execute, "Calling a stored procedure is not allowed.", node);

        public override void ExplicitVisit(OpenRowsetTableReference node) => Add(SqlValidationCodes.ExternalData, "OPENROWSET is not allowed.", node);

        public override void ExplicitVisit(BulkOpenRowset node) => Add(SqlValidationCodes.ExternalData, "OPENROWSET(BULK ...) is not allowed.", node);

        public override void ExplicitVisit(InternalOpenRowset node) => Add(SqlValidationCodes.ExternalData, "OPENROWSET is not allowed.", node);

        public override void ExplicitVisit(OpenQueryTableReference node) => Add(SqlValidationCodes.ExternalData, "OPENQUERY is not allowed.", node);

        public override void ExplicitVisit(AdHocTableReference node) => Add(SqlValidationCodes.ExternalData, "OPENDATASOURCE is not allowed.", node);

        public override void ExplicitVisit(OpenXmlTableReference node) => Add(SqlValidationCodes.ExternalData, "OPENXML is not allowed.", node);

        public override void ExplicitVisit(NextValueForExpression node) => Add(SqlValidationCodes.NextValueFor, "NEXT VALUE FOR changes a sequence and is not allowed.", node);

        public override void ExplicitVisit(WaitForStatement node) => Add(SqlValidationCodes.NotASelect, "WAITFOR is not allowed.", node);

        public override void ExplicitVisit(GlobalVariableExpression node) => Add(SqlValidationCodes.Variable, "Global variables (@@name) are not allowed.", node);

        public override void ExplicitVisit(VariableReference node)
        {
            // Placeholders became @p_NAME before parsing; any other variable cannot come from the author (the scanner refuses '@').
            if (!node.Name.StartsWith("@p_", StringComparison.Ordinal))
                Add(SqlValidationCodes.Variable, "Variables are not allowed. Use :NAME for a parameter.", node);
        }

        public override void ExplicitVisit(SchemaObjectName node)
        {
            if (node.ServerIdentifier is not null)
                Add(SqlValidationCodes.LinkedServer, "Four-part names (linked servers) are not allowed.", node);
            else if (node.DatabaseIdentifier is not null)
                Add(SqlValidationCodes.OtherDatabase, "Three-part names (other databases) are not allowed. Use schema.table.", node);
            if (IsSystemRoutineName(node.BaseIdentifier?.Value))
                Add(SqlValidationCodes.SystemProcedure, "Names starting with sp_ or xp_ are not allowed.", node);
            else if (node.BaseIdentifier?.Value is { } baseName && baseName.StartsWith("fn_", StringComparison.OrdinalIgnoreCase))
                Add(SqlValidationCodes.SystemFunction, "System functions starting with fn_ are not allowed (file and server state access).", node);
            base.ExplicitVisit(node);
        }

        public override void ExplicitVisit(FunctionCall node)
        {
            var name = node.FunctionName?.Value;
            if (IsSystemRoutineName(name))
                Add(SqlValidationCodes.SystemProcedure, "Names starting with sp_ or xp_ are not allowed.", node);
            else if (name is not null && name.StartsWith("fn_", StringComparison.OrdinalIgnoreCase))
                Add(SqlValidationCodes.SystemFunction, "System functions starting with fn_ are not allowed (file and server state access).", node);
            base.ExplicitVisit(node);
        }

        public override void ExplicitVisit(SelectStatement node)
        {
            if (node.Into is not null)
                Add(SqlValidationCodes.SelectInto, "SELECT ... INTO creates a table and is not allowed.", node.Into);
            foreach (var hint in node.OptimizerHints)
            {
                if (hint.HintKind is not (OptimizerHintKind.Recompile or OptimizerHintKind.MaxDop))
                    Add(SqlValidationCodes.QueryHint, "Only OPTION (RECOMPILE) and OPTION (MAXDOP n) are allowed.", hint);
            }

            base.ExplicitVisit(node);
        }

        public override void ExplicitVisit(TableHint node)
        {
            if (!AllowedTableHints.Contains(node.HintKind))
                Add(SqlValidationCodes.TableHint, $"The table hint {node.HintKind} is not allowed (reports must not take locks).", node);
            base.ExplicitVisit(node);
        }

        private static bool IsSystemRoutineName(string? name) =>
            name is not null && (name.StartsWith("sp_", StringComparison.OrdinalIgnoreCase) || name.StartsWith("xp_", StringComparison.OrdinalIgnoreCase));
    }
}
