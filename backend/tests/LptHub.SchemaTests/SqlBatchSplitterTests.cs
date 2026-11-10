using MatterFlow.Data.SchemaMigrations;
using Shouldly;

namespace MatterFlow.SchemaTests;

public class SqlBatchSplitterTests
{
    [Fact]
    public void Splits_on_go_lines_case_insensitively_and_skips_empty_batches()
    {
        var batches = SqlBatchSplitter.Split("SELECT 1;\nGO\n\ngo -- trailing\nSELECT 2;\r\n  GO  \nGO\n");

        batches.ShouldBe(["SELECT 1;", "SELECT 2;"]);
    }

    [Fact]
    public void Ignores_go_inside_block_comments_strings_and_identifiers()
    {
        var script = "/* start\nGO\nend */\nSELECT 'a\nGO\nb';\nSELECT [GO] FROM dbo.GOAT;\nSELECT 1 -- GO\nGO\nSELECT 2;";

        var batches = SqlBatchSplitter.Split(script);

        batches.Count.ShouldBe(2);
        batches[0].ShouldContain("end */");
        batches[0].ShouldContain("dbo.GOAT");
        batches[1].ShouldBe("SELECT 2;");
    }

    [Fact]
    public void Doubled_quotes_do_not_leave_string_state_open()
    {
        var batches = SqlBatchSplitter.Split("SELECT 'it''s';\nGO\nSELECT 2;");

        batches.Count.ShouldBe(2);
    }

    [Fact]
    public void Checksum_ignores_bom_line_endings_and_trailing_whitespace()
    {
        var a = MigrationScript.Create("05-x.sql", "﻿SELECT 1;\r\nGO\r\n\r\n");
        var b = MigrationScript.Create("05-x.sql", "SELECT 1;\nGO");

        a.Checksum.ShouldBe(b.Checksum);
    }

    [Fact]
    public void Prefix_is_numeric_and_bad_names_are_rejected()
    {
        MigrationScript.Create("09-a.sql", "x").Prefix.ShouldBe(9);
        MigrationScript.Create("010-a.sql", "x").Prefix.ShouldBe(10);
        Should.Throw<SchemaMigrationException>(() => MigrationScript.Create("1-a.sql", "x"));
        Should.Throw<SchemaMigrationException>(() => MigrationScript.Create("01_A.sql", "x"));
    }
}
