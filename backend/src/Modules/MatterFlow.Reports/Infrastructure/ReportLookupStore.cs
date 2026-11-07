using System.Data;
using System.Text;
using MatterFlow.Reports.Application;
using MatterFlow.Reports.Domain.Parameters;
using Microsoft.Data.SqlClient;

namespace MatterFlow.Reports.Infrastructure;

/// <summary>
/// The directory behind the lookup parameters, read with the application connection (the report login is not involved). Each kind has ONE fixed statement text that selects
/// an id and a label expression and nothing else; the search text is always a parameter. The matter statement carries <c>IsSensitive = 0</c> in its WHERE for the search and the
/// resolve alike, so a sensitive matter can be neither found nor confirmed by its id (owner decision 13; see <see cref="ReportLookupService"/>).
/// </summary>
internal sealed class ReportLookupStore(ReportAppConnection app) : IReportLookupStore
{
    // Per kind: the label expression, the table, the extra condition every read has, the extra condition of a search (active records), the columns searched, the sort.
    private sealed record Source(string Id, string Label, string From, string Always, string SearchOnly, string[] Searched);

    private static readonly Source Matters = new("m.MatterId", "m.MatterRef + N' ' + m.Name", "dbo.Matter m", "m.IsSensitive = 0", "m.IsActive = 1", ["m.MatterRef", "m.Name"]);
    private static readonly Source Clients = new("c.ClientId", "c.ClientNumber + N' ' + c.Name", "dbo.Client c", "1 = 1", "c.IsActive = 1", ["c.ClientNumber", "c.Name"]);
    private static readonly Source Users = new("u.UserId", "u.DisplayName", "dbo.AppUser u", "1 = 1", "u.IsActive = 1", ["u.DisplayName"]);
    private static readonly Source Pods = new("p.PodId", "p.Name", "dbo.Pod p", "1 = 1", "p.IsActive = 1", ["p.Name"]);
    private static readonly Source Roles = new("r.RoleId", "r.Name", "dbo.Role r", "1 = 1", "r.IsActive = 1", ["r.Name"]);
    private static readonly Source TaskTypes = new("t.TaskTypeId", "t.Name", "dbo.TaskType t", "1 = 1", "t.IsActive = 1", ["t.Name"]);

    private static Source For(LookupKind kind) => kind switch
    {
        LookupKind.Matter => Matters,
        LookupKind.Client => Clients,
        LookupKind.User => Users,
        LookupKind.Pod => Pods,
        LookupKind.Role => Roles,
        LookupKind.TaskType => TaskTypes,
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    public async Task<IReadOnlyList<ReportLookupItem>> SearchAsync(LookupKind kind, string? text, int take, CancellationToken cancellationToken)
    {
        var s = For(kind);
        var where = new StringBuilder($"{s.Always} AND {s.SearchOnly}");
        // The label of a matter is "ref name", so the text is also matched against the whole label (a person types what the control shows).
        if (!string.IsNullOrEmpty(text))
        {
            var columns = s.Searched.Append(s.Label).Select(c => $"{c} LIKE @like ESCAPE N'\\'");
            where.Append(" AND (").Append(string.Join(" OR ", columns)).Append(')');
        }
        var sql = $"SELECT TOP (@take) {s.Id}, {s.Label} FROM {s.From} WHERE {where} ORDER BY {s.Label}, {s.Id}";

        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.Add(new SqlParameter("@take", SqlDbType.Int) { Value = take });
        if (!string.IsNullOrEmpty(text))
            command.Parameters.Add(new SqlParameter("@like", SqlDbType.NVarChar, 210) { Value = "%" + EscapeLike(text) + "%" });
        return await ReadAsync(kind, command, cancellationToken);
    }

    public async Task<IReadOnlyList<ReportLookupItem>> ResolveAsync(LookupKind kind, IReadOnlyCollection<int> ids, CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
            return [];

        var s = For(kind);
        // The ids travel as one JSON array parameter (no text of the caller in the statement).
        var sql = $"SELECT {s.Id}, {s.Label} FROM {s.From} WHERE {s.Always} AND {s.Id} IN (SELECT CAST(j.[value] AS int) FROM OPENJSON(@ids) j) ORDER BY {s.Label}, {s.Id}";
        await using var connection = await app.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.Add(new SqlParameter("@ids", SqlDbType.NVarChar, -1) { Value = "[" + string.Join(',', ids.Select(i => i.ToString(System.Globalization.CultureInfo.InvariantCulture))) + "]" });
        return await ReadAsync(kind, command, cancellationToken);
    }

    private static async Task<IReadOnlyList<ReportLookupItem>> ReadAsync(LookupKind kind, SqlCommand command, CancellationToken cancellationToken)
    {
        var items = new List<ReportLookupItem>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var label = reader.GetString(1);
            items.Add(new ReportLookupItem(reader.GetInt32(0), kind == LookupKind.User ? WithoutDomain(label) : label));
        }

        return items;
    }

    /// <summary>A person without a directory name is shown as <c>DOMAIN\sam</c> by the identity module; the lookup shows <c>sam</c>.</summary>
    internal static string WithoutDomain(string displayName)
    {
        var slash = displayName.LastIndexOf('\\');
        return slash >= 0 && slash < displayName.Length - 1 ? displayName[(slash + 1)..] : displayName;
    }

    internal static string EscapeLike(string text) => text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal).Replace("[", "\\[", StringComparison.Ordinal);
}
