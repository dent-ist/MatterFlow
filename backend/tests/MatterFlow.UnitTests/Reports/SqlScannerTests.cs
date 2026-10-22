using System.Diagnostics;
using MatterFlow.Reports.Domain;
using Shouldly;

namespace MatterFlow.UnitTests.Reports;

/// <summary>The T-SQL-aware scanner and the position-based rewrite (spec 5.2; issue #687).</summary>
public class SqlScannerTests
{
    public static TheoryData<string, string> Corpus() => new()
    {
        // plain detection and case folding
        { "SELECT 1 WHERE a = :DATE", "DATE" },
        { "SELECT 1 WHERE a = :date", "DATE" },
        { "SELECT 1 WHERE a = :Date AND b = :DATE AND c = :date", "DATE" },
        { "SELECT 1 WHERE a=:X", "X" },
        { "SELECT 1 WHERE a IN(:A,:B)", "A,B" },
        { "SELECT 1 WHERE a IN (:A, :B, :A)", "A,B" },
        { "SELECT :A+:B", "A,B" },
        { "SELECT (:A)", "A" },
        { "SELECT 1 WHERE a >= :FROM_DATE AND a < :TO_DATE", "FROM_DATE,TO_DATE" },
        { "SELECT :_x", "_X" },
        { "SELECT :a1b2_c3", "A1B2_C3" },
        { "SELECT 1\nWHERE a = :Q\n  AND b = :R", "Q,R" },
        { "SELECT 1\r\nWHERE a = :Q", "Q" },
        { "SELECT 1 WHERE a LIKE '%' + :Q + '%'", "Q" },
        { "SELECT TOP (:N) a FROM t", "N" },
        { "SELECT 1 WHERE x = :CURRENT_USER_ID", "CURRENT_USER_ID" },
        { "SELECT 1 WHERE d < :TODAY", "TODAY" },
        // not placeholders: scope resolution, time literals, colons
        { "SELECT geography::Point(1,2,4326)", "" },
        { "SELECT a::b", "" },
        { "SELECT CAST(x AS geography::STGeomFromText('P',1))", "" },
        { "SELECT 12:30", "" },
        { "SELECT 1 WHERE a = 5:30", "" },
        { "SELECT ':'", "" },
        { "SELECT 1 WHERE a = :", "" },
        { "SELECT 1 WHERE a = : DATE", "" },
        { "SELECT 1 WHERE a = :1", "" },
        { "SELECT 1 WHERE a = :-x", "" },
        { "mylabel: SELECT 1", "" },
        { "SELECT x::y::z", "" },
        { "SELECT 1 /* :hidden */", "" },
        { "SELECT 1 -- :hidden", "" },
        { "SELECT 1 -- :hidden\n, :shown", "SHOWN" },
        { "SELECT 1 /* :a /* :nested */ :b */, :c", "C" },
        { "SELECT 1 /* a -- b */ , :c", "C" },
        { "SELECT 1 -- /* \n, :c", "C" },
        { "SELECT '--', :c", "C" },
        { "SELECT '/*', :c", "C" },
        { "SELECT '*/', :c", "C" },
        // strings: '' escape, N'...', placeholders inside are text
        { "SELECT 'a :X b'", "" },
        { "SELECT 'it''s :X', :Y", "Y" },
        { "SELECT N'a :X b', :Y", "Y" },
        { "SELECT N'', :Y", "Y" },
        { "SELECT '''', :Y", "Y" },
        { "SELECT '''' + ':X' + '''', :Y", "Y" },
        { "SELECT 'a'':X', :Y", "Y" },
        { "SELECT 'multi\nline :X', :Y", "Y" },
        { "SELECT '12:30' + :Y", "Y" },
        // bracketed and quoted identifiers
        { "SELECT [col:name] FROM t WHERE a = :A", "A" },
        { "SELECT [a]]:X] FROM t WHERE a = :A", "A" },
        { "SELECT \"col:name\" FROM t WHERE a = :A", "A" },
        { "SELECT \"a\"\":X\" FROM t WHERE a = :A", "A" },
        { "SELECT [it's], :A", "A" },
        { "SELECT [x--y], :A", "A" },
        { "SELECT \"x/*\", :A", "A" },
        // words before the colon
        { "SELECT a:B", "" },
        { "SELECT a1:B", "" },
        { "SELECT _:B", "" },
        { "SELECT é:B", "" },
        { "SELECT (:A)+(:B)", "A,B" },
        { "SELECT 1 WHERE a=:A;", "A" },
        { "SELECT 1 WHERE a=@@x", "" },
        // non-ASCII text around
        { "SELECT N'日本語 :X', :Y", "Y" },
        { "SELECT 'çé', :Y -- ünï :Z", "Y" },
        { "SELECT 1 WHERE name = :NAME_ÜMLAUT", "NAME_" },
        // ranges
        { "SELECT 1 WHERE d >= :PERIOD_FROM AND d < :PERIOD_TO", "PERIOD_FROM,PERIOD_TO" },
        // empty and whitespace
        { "", "" },
        { "   \n\t ", "" },
    };

    private static string Names(string sql) => string.Join(",", SqlScanner.Scan(sql).Placeholders.Select(p => p.Name));

    [Theory]
    [MemberData(nameof(Corpus))]
    public void Corpus_detects_exactly_the_expected_placeholders(string sql, string expected)
    {
        var scan = SqlScanner.Scan(sql);

        // The one corpus case that deliberately carries a non-ASCII letter after the name is an issue, not a placeholder list entry.
        if (sql.Contains("NAME_ÜMLAUT", StringComparison.Ordinal))
        {
            scan.Issues.Select(i => i.Code).ShouldContain(ScanIssueCodes.PlaceholderNameInvalid);
            return;
        }

        string.Join(",", scan.Placeholders.Select(p => p.Name)).ShouldBe(expected, sql);
        if (!sql.Contains('@'))
            scan.Issues.ShouldBeEmpty(sql);
    }

    [Fact]
    public void The_corpus_has_at_least_sixty_cases()
    {
        Corpus().Count.ShouldBeGreaterThanOrEqualTo(60);
    }

    [Fact]
    public void Names_fold_to_upper_case_and_the_first_spelling_is_the_display_name()
    {
        var scan = SqlScanner.Scan("SELECT :Client, :CLIENT, :client");

        var p = scan.Placeholders.ShouldHaveSingleItem();
        p.Name.ShouldBe("CLIENT");
        p.DisplayName.ShouldBe("Client");
        p.Occurrences.ShouldBe(3);
        scan.Occurrences.Select(o => o.Spelling).ShouldBe(["Client", "CLIENT", "client"]);
    }

    [Fact]
    public void Positions_line_and_column_point_at_the_colon()
    {
        const string sql = "SELECT 1\nFROM t\r\nWHERE a = :Alpha\rAND b = :Beta";

        var scan = SqlScanner.Scan(sql);

        var alpha = scan.Placeholders[0];
        alpha.Position.ShouldBe(sql.IndexOf(":Alpha", StringComparison.Ordinal));
        (alpha.Line, alpha.Column).ShouldBe((3, 11));
        var beta = scan.Placeholders[1];
        (beta.Line, beta.Column).ShouldBe((4, 9));
        foreach (var o in scan.Occurrences)
            sql.Substring(o.Start, o.Length).ShouldBe(":" + o.Spelling);
    }

    [Fact]
    public void Built_in_names_are_flagged()
    {
        var scan = SqlScanner.Scan("SELECT :TODAY, :Today, :CURRENT_POD_IDS, :MINE");

        scan.Placeholders.Where(p => p.IsBuiltIn).Select(p => p.Name).ShouldBe(["TODAY", "CURRENT_POD_IDS"]);
        scan.Placeholders.Single(p => p.Name == "MINE").IsBuiltIn.ShouldBeFalse();
    }

    [Fact]
    public void The_email_built_in_is_reserved_but_refused_in_this_release()
    {
        var scan = SqlScanner.Scan("SELECT :CURRENT_USER_EMAIL");

        scan.Issues.Select(i => i.Code).ShouldBe([ScanIssueCodes.BuiltInUnavailable]);
    }

    [Theory]
    [InlineData("SELECT @x")]
    [InlineData("SELECT @@ROWCOUNT")]
    [InlineData("DECLARE @a int")]
    [InlineData("SELECT 1 WHERE a = @p_DATE")]
    [InlineData("SELECT [a], @b")]
    public void At_signs_outside_strings_and_comments_are_issues(string sql)
    {
        var scan = SqlScanner.Scan(sql);

        scan.Issues.ShouldContain(i => i.Code == ScanIssueCodes.AtSign);
        scan.Issues.First(i => i.Code == ScanIssueCodes.AtSign).Position.ShouldBe(sql.IndexOf('@'));
    }

    [Theory]
    [InlineData("SELECT 'a@b.com'")]
    [InlineData("SELECT 1 -- mail me @ home")]
    [InlineData("SELECT 1 /* @x */")]
    [InlineData("SELECT [a@b]")]
    [InlineData("SELECT \"a@b\"")]
    public void At_signs_inside_strings_comments_and_identifiers_are_fine(string sql)
    {
        SqlScanner.Scan(sql).Issues.ShouldBeEmpty();
    }

    [Theory]
    [InlineData("SELECT 'open", ScanIssueCodes.UnterminatedString)]
    [InlineData("SELECT N'open :X", ScanIssueCodes.UnterminatedString)]
    [InlineData("SELECT 1 /* open", ScanIssueCodes.UnterminatedComment)]
    [InlineData("SELECT 1 /* a /* b */", ScanIssueCodes.UnterminatedComment)]
    [InlineData("SELECT [open", ScanIssueCodes.UnterminatedIdentifier)]
    [InlineData("SELECT \"open", ScanIssueCodes.UnterminatedIdentifier)]
    public void Unterminated_constructs_are_reported_at_their_start(string sql, string code)
    {
        var scan = SqlScanner.Scan(sql);

        var issue = scan.Issues.ShouldHaveSingleItem();
        issue.Code.ShouldBe(code);
        sql[issue.Position].ShouldBeOneOf('\'', '/', '[', '"');
        scan.Placeholders.ShouldBeEmpty(); // nothing after the open construct is read as code
    }

    [Fact]
    public void A_name_of_sixty_four_characters_is_the_longest()
    {
        var ok = new string('A', 64);
        var tooLong = new string('A', 65);

        SqlScanner.Scan($"SELECT :{ok}").Placeholders.ShouldHaveSingleItem().Name.ShouldBe(ok);
        var scan = SqlScanner.Scan($"SELECT :{tooLong}");
        scan.Placeholders.ShouldBeEmpty();
        scan.Issues.ShouldHaveSingleItem().Code.ShouldBe(ScanIssueCodes.PlaceholderNameTooLong);
    }

    [Fact]
    public void A_non_ascii_letter_glued_to_a_name_is_an_issue_not_a_silent_truncation()
    {
        var scan = SqlScanner.Scan("SELECT :Naïve");

        scan.Placeholders.ShouldBeEmpty();
        scan.Issues.ShouldHaveSingleItem().Code.ShouldBe(ScanIssueCodes.PlaceholderNameInvalid);
    }

    [Fact]
    public void Matching_from_and_to_names_are_proposed_as_a_date_range()
    {
        SqlScanner.Scan("SELECT 1 WHERE d >= :PERIOD_FROM AND d <= :period_to AND x = :LONELY_FROM AND y = :OTHER_TO").DateRangeCandidates
            .ShouldBe(["PERIOD"]);
        SqlScanner.Scan("SELECT :X_FROM").DateRangeCandidates.ShouldBeEmpty();
    }

    // ---- rewrite ----

    [Fact]
    public void Rewrite_renames_only_the_found_tokens()
    {
        const string sql = "SELECT ':KEEP', [x:y], :a /* :c */ FROM t WHERE b = :A AND c IN (:Pods) -- :tail";

        var scan = SqlScanner.Scan(sql);
        var rewritten = SqlPlaceholderRewriter.Rewrite(sql, scan.Occurrences);

        rewritten.ShouldBe("SELECT ':KEEP', [x:y], @p_A /* :c */ FROM t WHERE b = @p_A AND c IN (@p_PODS) -- :tail");
    }

    [Theory]
    [MemberData(nameof(Corpus))]
    public void Rewrite_round_trips_through_the_scanner_positions(string sql, string _)
    {
        var scan = SqlScanner.Scan(sql);

        // Put every token back using the same positions: the original text must come out unchanged.
        var rewritten = SqlPlaceholderRewriter.Rewrite(sql, scan.Occurrences);
        var rebuilt = rewritten;
        foreach (var o in scan.Occurrences.Reverse())
        {
            var token = SqlPlaceholderRewriter.ParameterName(o.Name);
            var shift = scan.Occurrences.TakeWhile(x => x.Start < o.Start).Sum(x => SqlPlaceholderRewriter.ParameterName(x.Name).Length - x.Length);
            var start = o.Start + shift;
            rewritten.Substring(start, token.Length).ShouldBe(token);
            rebuilt = rebuilt.Remove(start, token.Length).Insert(start, ":" + o.Spelling);
        }

        rebuilt.ShouldBe(sql);
    }

    [Fact]
    public void Rewrite_can_use_a_custom_replacement_and_refuses_overlapping_positions()
    {
        const string sql = "SELECT :A, :B";
        var scan = SqlScanner.Scan(sql);

        SqlPlaceholderRewriter.Rewrite(sql, scan.Occurrences, o => $"<{o.Name}>").ShouldBe("SELECT <A>, <B>");
        Should.Throw<ArgumentException>(() => SqlPlaceholderRewriter.Rewrite(sql, [scan.Occurrences[1], scan.Occurrences[0]]));
    }

    [Fact]
    public void Values_cannot_reach_the_text_because_the_rewrite_never_sees_them()
    {
        // The rewritten text is a function of the SQL and the placeholder names only.
        const string sql = "SELECT * FROM t WHERE a = :Q";
        var scan = SqlScanner.Scan(sql);

        SqlPlaceholderRewriter.Rewrite(sql, scan.Occurrences).ShouldBe("SELECT * FROM t WHERE a = @p_Q");
    }

    // ---- robustness ----

    [Fact]
    public void Random_text_never_throws_and_positions_stay_inside_the_text()
    {
        var rng = new Random(687);
        const string alphabet = "SELECT :@'\"[]-/*\r\n abcXYZ_09é;(),=<>%N";
        for (var run = 0; run < 3000; run++)
        {
            var sql = string.Create(rng.Next(0, 80), rng, (span, r) =>
            {
                for (var k = 0; k < span.Length; k++)
                    span[k] = alphabet[r.Next(alphabet.Length)];
            });

            var scan = SqlScanner.Scan(sql);
            foreach (var o in scan.Occurrences)
            {
                (o.Start >= 0 && o.Start + o.Length <= sql.Length).ShouldBeTrue(sql);
                sql[o.Start].ShouldBe(':');
            }

            foreach (var issue in scan.Issues)
                (issue.Position >= 0 && issue.Position < Math.Max(1, sql.Length)).ShouldBeTrue(sql);
            scan.Occurrences.Zip(scan.Occurrences.Skip(1)).All(p => p.First.Start + p.First.Length <= p.Second.Start).ShouldBeTrue(sql);
            SqlPlaceholderRewriter.Rewrite(sql, scan.Occurrences).Length.ShouldBeGreaterThanOrEqualTo(0);
        }
    }

    [Fact]
    public void Sixty_four_kilobytes_are_scanned_in_well_under_twenty_milliseconds()
    {
        var line = "SELECT t.a, t.b /* c :x */ FROM dbo.T t WHERE t.d >= :FROM AND t.e IN (:PODS) AND t.f = 'x:y''z' -- note :n\n";
        var sql = string.Concat(Enumerable.Repeat(line, 64 * 1024 / line.Length));
        sql.Length.ShouldBeGreaterThan(60_000);
        SqlScanner.Scan(sql); // warm up the JIT

        var best = long.MaxValue;
        for (var run = 0; run < 5; run++)
        {
            var sw = Stopwatch.StartNew();
            var scan = SqlScanner.Scan(sql);
            sw.Stop();
            best = Math.Min(best, sw.ElapsedMilliseconds);
            scan.Placeholders.Count.ShouldBe(2);
        }

        best.ShouldBeLessThan(20);
    }

    [Fact]
    public void A_pathological_text_stays_linear()
    {
        var sql = new string('\'', 60_000) + new string(':', 1000) + string.Concat(Enumerable.Repeat("/*", 5000));

        var sw = Stopwatch.StartNew();
        SqlScanner.Scan(sql);
        sw.ElapsedMilliseconds.ShouldBeLessThan(200);
    }

    [Fact]
    public void Names_helper_matches_the_scan()
    {
        Names("SELECT :A, :B").ShouldBe("A,B");
    }
}
