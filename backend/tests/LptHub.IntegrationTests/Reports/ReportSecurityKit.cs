using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using LptHub.IntegrationTests.Fixtures;
using Microsoft.Data.SqlClient;
using Shouldly;

namespace LptHub.IntegrationTests.Reports;

/// <summary>Helpers shared by the security suite of the Reports feature (issue #725): the corpus files, a CSV reader, and a few HTTP and SQL shortcuts.</summary>
internal static class ReportSecurityKit
{
    public static string RunUrl(int reportId) => $"/api/v1/reports/{reportId}/runs";

    public static string Rows(Guid run, string query = "") => $"/api/v1/reports/runs/{run}/rows{query}";

    public static string Export(Guid run, string query = "") => $"/api/v1/reports/runs/{run}/export.csv{query}";

    public static async Task<JsonElement> ReadAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    public static StringContent Raw(string json) => new(json, Encoding.UTF8, "application/json");

    /// <summary>Reads a string list from a corpus file under <c>Reports/Corpus</c> (linked from the unit tests, never forked).</summary>
    public static IReadOnlyList<string> Corpus(string file, string property)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Reports", "Corpus", file)));
        return document.RootElement.GetProperty(property).EnumerateArray().Select(v => v.GetString()!).ToList();
    }

    /// <summary>Runs a report that must succeed and returns the id of its result.</summary>
    public static async Task<Guid> RunOkAsync(HttpClient client, int report, object? parameters = null)
    {
        var response = await client.PostAsync(RunUrl(report), ReportTestHarness.Parameters(parameters ?? new { }));
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return Guid.Parse((await ReadAsync(response)).GetProperty("runId").GetString()!);
    }

    public static async Task<long> CountAsync(string connectionString, string sql) => Convert.ToInt64(await SqlServerFixture.ScalarAsync(connectionString, sql), System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>Inserts a person row the way a seed would (the report login can read <c>AppUser</c>).</summary>
    public static async Task AddAppUserAsync(string connectionString, string displayName)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "INSERT dbo.AppUser (DisplayName) VALUES (@n)";
        command.Parameters.AddWithValue("@n", displayName);
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>An RFC 4180 reader: a record ends at CRLF outside quotes; quotes inside a quoted cell are doubled. The text starts after the byte order mark.</summary>
    public static List<List<string>> ParseCsv(string text)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (quoted)
            {
                if (ch == '"' && i + 1 < text.Length && text[i + 1] == '"')
                {
                    cell.Append('"');
                    i++;
                }
                else if (ch == '"')
                {
                    quoted = false;
                }
                else
                {
                    cell.Append(ch);
                }
            }
            else if (ch == '"' && cell.Length == 0)
            {
                quoted = true;
            }
            else if (ch == ',')
            {
                row.Add(cell.ToString());
                cell.Clear();
            }
            else if (ch == '\r' && i + 1 < text.Length && text[i + 1] == '\n')
            {
                row.Add(cell.ToString());
                cell.Clear();
                rows.Add(row);
                row = [];
                i++;
            }
            else
            {
                cell.Append(ch);
            }
        }

        quoted.ShouldBeFalse("a quote was left open");
        cell.Length.ShouldBe(0, "the last record ends with CRLF");
        row.Count.ShouldBe(0);
        return rows;
    }

    /// <summary>Downloads an export that must succeed and returns its parsed records.</summary>
    public static async Task<List<List<string>>> DownloadCsvAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var bytes = await response.Content.ReadAsByteArrayAsync();
        bytes[..3].ShouldBe([0xEF, 0xBB, 0xBF]);
        return ParseCsv(Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3));
    }

    /// <summary>Text that no response to a person who only runs reports may contain: SQL keywords from a definition, schema-qualified names, SQL Server's own words.</summary>
    public static readonly string[] SqlTraces = ["SELECT ", " FROM ", "dbo.", "OPENJSON", "sys.", "Msg ", "SqlException", "Incorrect syntax", "Invalid object name", "Invalid column name", "permission was denied"];

    /// <summary>For answers that echo the caller's own input (a bad sort or filter): no stack trace, no SQL Server message, no exception type.</summary>
    public static void ShouldHoldNoServerTrace(string body, string where)
    {
        foreach (var trace in new[] { "Exception", "   at ", "Msg ", "Stack", "LptHub.", "Microsoft." })
            body.ShouldNotContain(trace, Case.Sensitive, $"{where}: {body}");
    }

    public static void ShouldHoldNoSqlTrace(string body, string where)
    {
        foreach (var trace in SqlTraces)
            body.ShouldNotContain(trace, Case.Sensitive, $"{where}: {body}");
    }
}
