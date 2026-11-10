using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace MatterFlow.IntegrationTests.Fixtures;

/// <summary>
/// Puts Out of office entries straight into <c>dbo.UserAbsence</c> (script 58) so a test can set up a person who is away with any dates, in the past too; the entry rules of the API are tested in
/// <c>AbsenceApiTests</c>. A start of null means "since long ago" (the old single value with no from date).
/// </summary>
public static class AbsenceSeed
{
    public static Task AddAbsenceAsync(this DatabaseApiFactory factory, int userId, string? from, string? until, string? note = null, string type = "OTHER") =>
        factory.WithDbAsync(db => db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT dbo.UserAbsence (UserId, AbsenceType, StartDate, EndDate, Note) VALUES ({userId}, {type}, {from ?? "2000-01-01"}, {until}, {note})"));

    /// <summary>The signed-in user of <paramref name="client"/> goes out of office: their entries are replaced by this one (like the old single Out of office value).</summary>
    public static async Task GoOutAsync(this HttpClient client, DatabaseApiFactory factory, string? from, string? until, string? note = null, string type = "OTHER")
    {
        var me = (await client.GetFromJsonAsync<JsonElement>("/api/v1/me")).GetProperty("userId").GetInt32();
        await factory.WithDbAsync(db => db.Database.ExecuteSqlInterpolatedAsync($"DELETE dbo.UserAbsence WHERE UserId = {me}"));
        await factory.AddAbsenceAsync(me, from, until, note, type);
    }
}
