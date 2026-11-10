using System.Globalization;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.Reports.Domain;
using MatterFlow.Reports.Domain.Parameters;
using MatterFlow.Reports.Infrastructure;
using Microsoft.Data.SqlClient;
using Shouldly;

namespace MatterFlow.IntegrationTests.Reports;

/// <summary>
/// Multi-choice binding against SQL Server 2022 through the real report login (epic #671, issue #698): both <c>IN :X</c> and <c>IN (:X)</c>,
/// 0 / 1 / 1000 / 1001 elements, "empty means all", and hostile list elements that must come back as plain values.
/// </summary>
[Collection(SqlServerCollection.Name)]
public sealed class ReportListBindingTests(SqlServerFixture sql) : IAsyncLifetime
{
    private static readonly BuiltInContext Ctx = new(1, "Test", new DateOnly(2026, 10, 22), new DateTime(2026, 10, 22, 12, 0, 0, DateTimeKind.Utc), [2, 4], 2, 0);

    private const string Numbers = "WITH nums AS (SELECT TOP (1500) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) ";

    private string _reader = null!;

    public async Task InitializeAsync()
    {
        var admin = await sql.CreateMigratedDatabaseAsync();
        var login = await sql.CreateServerLoginAsync(admin);
        await SqlServerFixture.CreateDatabaseUserAsync(admin, login.Name, "mf_report_reader");
        _reader = login.ConnectionString;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static ReportParameterDefinition IntList(string name = "IDS") =>
        new() { Name = name, Type = ReportParameterType.Lookup, LookupKind = LookupKind.Matter, LookupMulti = true, MaxSelected = 1000 };

    private static ReportParameterDefinition TextList(string name, params string[] options) =>
        new() { Name = name, Type = ReportParameterType.Multi, ValueType = ChoiceValueType.Text, OptionsKind = OptionsKind.Fixed, Options = options.Select(o => new ParameterOption(o, o)).ToList() };

    /// <summary>Compile, validate, bind and run exactly like the engine will, with the report login; returns the first column as text.</summary>
    private async Task<List<string>> RunAsync(string sqlText, IReadOnlyList<ReportParameterDefinition> definitions, params (string Name, string Json)[] values)
    {
        var (compiled, validation) = ReportSqlCompiler.CompileAndValidate(sqlText, definitions);
        validation.Errors.ShouldBeEmpty(sqlText);
        var bind = ParameterBinder.Bind(definitions, values.ToDictionary(v => v.Name, v => JsonDocument.Parse(v.Json).RootElement.Clone(), StringComparer.Ordinal), Ctx, compiled.UsedPlaceholders);
        bind.Errors.ShouldBeEmpty(string.Join("; ", bind.Errors.Select(e => e.Code)));

        await using var connection = new SqlConnection(_reader);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = compiled.SqlText;
        foreach (var p in bind.Parameters)
            command.Parameters.Add(SqlParameterFactory.Create(p));
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<string>();
        while (await reader.ReadAsync())
            rows.Add(Convert.ToString(reader.GetValue(0), CultureInfo.InvariantCulture)!);
        return rows;
    }

    private static string Array(IEnumerable<int> ids) => "[" + string.Join(",", ids) + "]";

    [Fact]
    public async Task In_with_and_without_parentheses_returns_the_same_rows()
    {
        var defs = new[] { IntList() };

        var a = await RunAsync(Numbers + "SELECT n FROM nums WHERE n IN :IDS ORDER BY n", defs, ("IDS", "[3,5,7]"));
        var b = await RunAsync(Numbers + "SELECT n FROM nums WHERE n IN (:IDS) ORDER BY n", defs, ("IDS", "[3,5,7]"));
        var c = await RunAsync(Numbers + "SELECT n FROM nums WHERE n NOT IN :IDS AND n <= 8 ORDER BY n", defs, ("IDS", "[3,5,7]"));

        a.ShouldBe(["3", "5", "7"]);
        b.ShouldBe(a);
        c.ShouldBe(["1", "2", "4", "6", "8"]);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(1000)]
    public async Task Lists_of_zero_one_and_a_thousand_elements_return_exactly_those_rows(int count)
    {
        var rows = await RunAsync(Numbers + "SELECT n FROM nums WHERE n IN (:IDS)", [IntList()], ("IDS", Array(Enumerable.Range(1, count))));

        rows.Count.ShouldBe(count);
        rows.Select(int.Parse).Order().ShouldBe(Enumerable.Range(1, count));
    }

    [Fact]
    public void A_list_of_1001_elements_is_refused_before_any_SQL_runs()
    {
        var bind = ParameterBinder.Bind([IntList()], new Dictionary<string, JsonElement> { ["IDS"] = JsonDocument.Parse(Array(Enumerable.Range(1, 1001))).RootElement }, Ctx, new HashSet<string> { "IDS" });

        bind.Errors.ShouldHaveSingleItem().Code.ShouldBe(ParameterErrorCodes.TooMany);
        bind.Parameters.ShouldBeEmpty();
    }

    [Fact]
    public async Task An_empty_selection_means_all_when_the_author_writes_the_documented_snippet()
    {
        const string query = Numbers + "SELECT n FROM nums WHERE n <= 5 AND (NOT EXISTS (SELECT 1 FROM :IDS) OR n IN :IDS) ORDER BY n";

        (await RunAsync(query, [IntList()], ("IDS", "[]"))).ShouldBe(["1", "2", "3", "4", "5"]);
        (await RunAsync(query, [IntList()])).ShouldBe(["1", "2", "3", "4", "5"]);
        (await RunAsync(query, [IntList()], ("IDS", "[2,4]"))).ShouldBe(["2", "4"]);
    }

    [Fact]
    public async Task The_built_in_pod_list_works_without_a_definition()
    {
        var rows = await RunAsync(Numbers + "SELECT n FROM nums WHERE n IN :CURRENT_POD_IDS ORDER BY n", []);

        rows.ShouldBe(["2", "4"]);
    }

    [Fact]
    public async Task Hostile_text_options_come_back_as_plain_values()
    {
        string[] hostile =
        [
            "x\" OR 1=1 --", "'; DROP TABLE dbo.AppUser; --", "a'b", "\\", "’ OR ’ 1 ’=’ 1", "]", "[\"nested\",[\"array\"]]", "{\"a\":1}", "\n\r\t", "\u0000".Replace("\u0000", "0"), "%", "_", new string('x', 200),
        ];
        var defs = new[] { TextList("TXT", hostile) };
        var json = JsonSerializer.Serialize(hostile);

        var rows = await RunAsync("SELECT v FROM (SELECT CAST(value AS nvarchar(200)) v FROM OPENJSON(N'[]')) e WHERE 1 = 0 UNION ALL SELECT value FROM (SELECT [value] FROM :TXT) s", defs, ("TXT", json));

        rows.Order(StringComparer.Ordinal).ShouldBe(hostile.Order(StringComparer.Ordinal));
        (await sqlCountAsync("SELECT COUNT(*) FROM dbo.AppUser")).ShouldBe(0); // still there: nothing was executed
    }

    [Fact]
    public async Task A_hostile_json_array_that_bypasses_the_binder_is_data_or_a_conversion_error_never_code()
    {
        // The binder would refuse these values; this test sends them straight into the compiled text to prove the text itself is safe.
        var (compiled, _) = ReportSqlCompiler.CompileAndValidate("SELECT value FROM (SELECT [value] FROM :L) s", [TextList("L", "x")]);
        var intQuery = ReportSqlCompiler.Compile("SELECT value FROM :L", [IntList("L")]);

        foreach (var payload in new[] { "[\"'; DROP TABLE dbo.AppUser; --\"]", "[\"1); DROP TABLE dbo.AppUser;--\"]", "[\"a\"],[\"b\"]", "not json", "{\"a\":\"; SELECT 1\"}" })
        {
            await using var connection = new SqlConnection(_reader);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = compiled.SqlText;
            command.Parameters.Add(new SqlParameter("@p_L", System.Data.SqlDbType.NVarChar, -1) { Value = payload });
            try
            {
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                    reader.GetString(0).ShouldNotBeNull();
            }
            catch (SqlException)
            {
                // "not json" and the like fail as an error; none of it ran as code.
            }
        }

        foreach (var payload in new[] { "[\"1); DROP TABLE dbo.AppUser;--\"]", "[1, \"x\"]" })
        {
            await using var connection = new SqlConnection(_reader);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = intQuery.SqlText;
            command.Parameters.Add(new SqlParameter("@p_L", System.Data.SqlDbType.NVarChar, -1) { Value = payload });
            await Should.ThrowAsync<SqlException>(async () =>
            {
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                }
            }); // the int cast refuses it
        }

        (await sqlCountAsync("SELECT COUNT(*) FROM sys.tables WHERE name = 'AppUser'")).ShouldBe(1);
    }

    [Fact]
    public async Task A_date_range_uses_two_date_parameters()
    {
        var defs = new[] { new ReportParameterDefinition { Name = "PERIOD", Type = ReportParameterType.DateRange, IsRequired = true } };

        var rows = await RunAsync(
            Numbers + "SELECT n FROM nums WHERE n <= 40 AND DATEADD(day, n, '2026-09-30') >= :PERIOD_FROM AND DATEADD(day, n, '2026-09-30') < DATEADD(day, 1, :PERIOD_TO) ORDER BY n",
            defs,
            ("PERIOD", "{\"from\":\"2026-10-01\",\"to\":\"2026-10-03\"}"));

        rows.ShouldBe(["1", "2", "3"]);
    }

    [Fact]
    public async Task The_database_compatibility_level_supports_OPENJSON()
    {
        (await sqlCountAsync("SELECT compatibility_level FROM sys.databases WHERE database_id = DB_ID()")).ShouldBeGreaterThanOrEqualTo(130);
    }

    private async Task<int> sqlCountAsync(string query)
    {
        await using var connection = new SqlConnection(_reader);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = query;
        try
        {
            return Convert.ToInt32(await command.ExecuteScalarAsync());
        }
        catch (SqlException)
        {
            // AppUser is readable by the report login; a denied table would raise here and the caller treats it as 0.
            return 0;
        }
    }
}
