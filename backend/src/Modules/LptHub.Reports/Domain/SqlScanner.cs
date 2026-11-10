namespace MatterFlow.Reports.Domain;

/// <summary>One <c>:NAME</c> token found in the SQL text: where it is and how it was spelled.</summary>
/// <param name="Name">Upper-cased name without the colon (<c>:date</c> and <c>:DATE</c> are the same parameter).</param>
/// <param name="Spelling">The name as written.</param>
/// <param name="Start">Index of the colon in the text.</param>
/// <param name="Length">Length of the whole token including the colon.</param>
public readonly record struct PlaceholderOccurrence(string Name, string Spelling, int Start, int Length, int Line, int Column);

/// <summary>A distinct placeholder: first position, how often it occurs and whether it is a server-supplied built-in.</summary>
public sealed record DetectedPlaceholder(string Name, string DisplayName, int Position, int Line, int Column, int Occurrences, bool IsBuiltIn);

/// <summary>A problem the scanner found. <see cref="Code"/> is stable; <see cref="Message"/> is for the author.</summary>
public sealed record ScanIssue(string Code, string Message, int Position, int Line, int Column);

/// <summary>The result of one pass over the SQL text.</summary>
/// <param name="Placeholders">Distinct placeholders in order of first appearance.</param>
/// <param name="Occurrences">Every token, in text order (used by the rewrite; nothing else decides what is replaced).</param>
/// <param name="Issues">Problems that make the text unusable (unterminated string, <c>@</c>, bad placeholder).</param>
/// <param name="DateRangeCandidates">Base names <c>X</c> for which both <c>X_FROM</c> and <c>X_TO</c> appear (proposed as one date range).</param>
/// <param name="CommentSpans">Where comments are (start inclusive, end exclusive), in text order; used to find the neighbouring code of a token.</param>
public sealed record SqlScan(
    IReadOnlyList<DetectedPlaceholder> Placeholders,
    IReadOnlyList<PlaceholderOccurrence> Occurrences,
    IReadOnlyList<ScanIssue> Issues,
    IReadOnlyList<string> DateRangeCandidates,
    IReadOnlyList<(int Start, int End)> CommentSpans)
{
    public bool HasIssues => Issues.Count > 0;
}

/// <summary>Stable issue codes of the scanner.</summary>
public static class ScanIssueCodes
{
    public const string UnterminatedString = "UNTERMINATED_STRING";
    public const string UnterminatedComment = "UNTERMINATED_COMMENT";
    public const string UnterminatedIdentifier = "UNTERMINATED_IDENTIFIER";
    public const string AtSign = "AT_SIGN_NOT_ALLOWED";
    public const string PlaceholderNameTooLong = "PLACEHOLDER_NAME_TOO_LONG";
    public const string PlaceholderNameInvalid = "PLACEHOLDER_NAME_INVALID";
    public const string BuiltInUnavailable = "BUILTIN_NOT_AVAILABLE";
    public const string TextTooLong = "TEXT_TOO_LONG";
}

/// <summary>
/// A small T-SQL-aware scanner (spec 5.2). It walks the text once, skips comments (<c>--</c> and nested <c>/* */</c>), string literals
/// (<c>''</c> escape, also <c>N'...'</c>), <c>[bracketed]</c> and <c>"quoted"</c> identifiers, and reports every <c>:NAME</c> outside them.
/// A colon starts a placeholder only when the next character begins an identifier and the previous one is neither a word character nor a
/// colon, so <c>geography::Point</c>, <c>12:30</c> and <c>a::b</c> are left alone. An <c>@</c> outside strings and comments is an issue: the
/// engine owns every variable name. No regular expression runs over the whole text; the scan is linear.
/// </summary>
public static class SqlScanner
{
    /// <summary>Longest placeholder name (the first character plus 63).</summary>
    public const int MaxNameLength = 64;

    /// <summary>Longest query text the product accepts (64 kB of characters).</summary>
    public const int MaxQueryLength = 64 * 1024;

    public static SqlScan Scan(string sql)
    {
        ArgumentNullException.ThrowIfNull(sql);
        var occurrences = new List<PlaceholderOccurrence>();
        var issues = new List<ScanIssue>();
        var comments = new List<(int Start, int End)>();
        var lineStarts = new List<int> { 0 };
        for (var k = 0; k < sql.Length; k++)
        {
            if (sql[k] == '\n')
                lineStarts.Add(k + 1);
            else if (sql[k] == '\r' && !(k + 1 < sql.Length && sql[k + 1] == '\n'))
                lineStarts.Add(k + 1);
        }

        (int Line, int Column) Where(int index)
        {
            var lo = 0;
            var hi = lineStarts.Count - 1;
            while (lo < hi)
            {
                var mid = (lo + hi + 1) >>> 1;
                if (lineStarts[mid] <= index)
                    lo = mid;
                else
                    hi = mid - 1;
            }

            return (lo + 1, index - lineStarts[lo] + 1);
        }

        void Issue(string code, string message, int index)
        {
            var (line, column) = Where(index);
            issues.Add(new ScanIssue(code, message, index, line, column));
        }

        var i = 0;
        var n = sql.Length;
        while (i < n)
        {
            var c = sql[i];
            switch (c)
            {
                case '-' when i + 1 < n && sql[i + 1] == '-':
                    {
                        var start = i;
                        i += 2;
                        while (i < n && sql[i] != '\n' && sql[i] != '\r')
                            i++;
                        comments.Add((start, i));
                        break;
                    }

                case '/' when i + 1 < n && sql[i + 1] == '*':
                    {
                        var start = i;
                        var depth = 1;
                        i += 2;
                        while (i < n && depth > 0)
                        {
                            if (sql[i] == '/' && i + 1 < n && sql[i + 1] == '*')
                            {
                                depth++;
                                i += 2;
                            }
                            else if (sql[i] == '*' && i + 1 < n && sql[i + 1] == '/')
                            {
                                depth--;
                                i += 2;
                            }
                            else
                            {
                                i++;
                            }
                        }

                        if (depth > 0)
                            Issue(ScanIssueCodes.UnterminatedComment, "A /* comment is never closed.", start);
                        comments.Add((start, i));
                        break;
                    }

                case '\'':
                    i = SkipQuoted(sql, i, '\'', ScanIssueCodes.UnterminatedString, "A string literal is never closed.", Issue);
                    break;

                case '"':
                    i = SkipQuoted(sql, i, '"', ScanIssueCodes.UnterminatedIdentifier, "A \"quoted identifier\" is never closed.", Issue);
                    break;

                case '[':
                    i = SkipQuoted(sql, i, ']', ScanIssueCodes.UnterminatedIdentifier, "A [bracketed identifier] is never closed.", Issue);
                    break;

                case '@':
                    Issue(ScanIssueCodes.AtSign, "'@' is not allowed: variables and parameters are managed by the report engine. Use :NAME for a parameter.", i);
                    i++;
                    break;

                case ':':
                    i = ScanPlaceholder(sql, i, occurrences, Where, Issue);
                    break;

                default:
                    i++;
                    break;
            }
        }

        var distinct = new List<DetectedPlaceholder>();
        var index = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var o in occurrences)
        {
            if (index.TryGetValue(o.Name, out var at))
            {
                distinct[at] = distinct[at] with { Occurrences = distinct[at].Occurrences + 1 };
            }
            else
            {
                index[o.Name] = distinct.Count;
                distinct.Add(new DetectedPlaceholder(o.Name, o.Spelling, o.Start, o.Line, o.Column, 1, BuiltInParameters.IsBuiltIn(o.Name)));
            }
        }

        foreach (var p in distinct.Where(p => BuiltInParameters.Unavailable.Contains(p.Name)))
            Issue(ScanIssueCodes.BuiltInUnavailable, $":{p.Name} is reserved but not available in this release.", p.Position);

        var candidates = distinct
            .Where(p => p.Name.EndsWith("_FROM", StringComparison.Ordinal) && p.Name.Length > "_FROM".Length && !p.IsBuiltIn)
            .Select(p => p.Name[..^"_FROM".Length])
            .Where(b => index.ContainsKey(b + "_TO"))
            .ToList();

        return new SqlScan(distinct, occurrences, issues, candidates, comments);
    }

    private static int SkipQuoted(string sql, int start, char close, string code, string message, Action<string, string, int> issue)
    {
        var n = sql.Length;
        var i = start + 1;
        while (i < n)
        {
            if (sql[i] == close)
            {
                if (i + 1 < n && sql[i + 1] == close)
                {
                    i += 2; // '' or "" or ]] is an escaped quote
                    continue;
                }

                return i + 1;
            }

            i++;
        }

        issue(code, message, start);
        return n;
    }

    private static int ScanPlaceholder(
        string sql,
        int colon,
        List<PlaceholderOccurrence> occurrences,
        Func<int, (int Line, int Column)> where,
        Action<string, string, int> issue)
    {
        var n = sql.Length;
        var next = colon + 1;
        if (next >= n || !IsIdentifierStart(sql[next]))
            return next; // ':' alone, '::', ':1', '12:30'

        if (colon > 0 && (IsWordCharacter(sql[colon - 1]) || sql[colon - 1] == ':'))
            return next; // geography::Point, a::b, 12:30, label:

        var end = next;
        while (end < n && IsIdentifierPart(sql[end]))
            end++;

        var length = end - next;
        if (length > MaxNameLength)
        {
            issue(ScanIssueCodes.PlaceholderNameTooLong, $"A placeholder name may have at most {MaxNameLength} characters.", colon);
            return end;
        }

        if (end < n && IsWordCharacter(sql[end]))
        {
            issue(ScanIssueCodes.PlaceholderNameInvalid, "Placeholder names may only use the letters A-Z, digits and underscore.", colon);
            while (end < n && IsWordCharacter(sql[end]))
                end++;
            return end;
        }

        var spelling = sql.Substring(next, length);
        var (line, column) = where(colon);
        occurrences.Add(new PlaceholderOccurrence(spelling.ToUpperInvariant(), spelling, colon, length + 1, line, column));
        return end;
    }

    private static bool IsIdentifierStart(char c) => c is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z') or '_';

    private static bool IsIdentifierPart(char c) => IsIdentifierStart(c) || c is >= '0' and <= '9';

    /// <summary>Any letter or digit (also non-ASCII) or underscore: these glue to a following colon or name.</summary>
    private static bool IsWordCharacter(char c) => c == '_' || char.IsLetterOrDigit(c);
}
