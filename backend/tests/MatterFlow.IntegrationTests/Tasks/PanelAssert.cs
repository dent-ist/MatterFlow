using System.Net;
using System.Text.Json;
using Shouldly;

namespace MatterFlow.IntegrationTests.Tasks;

/// <summary>Assertions shared by the comment, asset-link and activity tests.</summary>
internal static class PanelAssert
{
    /// <summary>
    /// 403 problem+json: PERMISSION_DENIED for a user whose roles lack the permission, ACCESS_PENDING for a user who holds no permission at all.
    /// </summary>
    public static async Task ForbiddenAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden, body);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json", body);
        JsonDocument.Parse(body).RootElement.GetProperty("code").GetString().ShouldBeOneOf("PERMISSION_DENIED", "ACCESS_PENDING");
    }
}
