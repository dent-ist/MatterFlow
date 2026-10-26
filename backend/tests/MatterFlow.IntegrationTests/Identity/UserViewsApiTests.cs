using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using Shouldly;

namespace MatterFlow.IntegrationTests.Identity;

/// <summary>PM v2 #856: the signed-in person's remembered screen state and named saved views; always their own rows.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class UserViewsApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private const string Surface = "my-matters.attention";
    private const string Ann = @"ke\ann";
    private const string Bob = @"ke\bob";

    private DatabaseApiFactory _factory = null!;

    public async Task InitializeAsync() => _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<HttpClient> UserAsync(string user, params string[] permissions)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-MatterFlow-Client", "web");
        client.DefaultRequestHeaders.Add("X-Dev-User", user);
        (await client.GetAsync("/api/v1/me")).StatusCode.ShouldBe(HttpStatusCode.OK);
        if (permissions.Length > 0)
            await _factory.GrantRoleAsync(user, await _factory.CreateRoleAsync("Role " + user, permissions));
        return client;
    }

    private static async Task<JsonElement> ReadAsync(HttpResponseMessage response) => await response.Content.ReadFromJsonAsync<JsonElement>();

    private static object State(string sort = "due", params int[] types) => new { state = new { sort, types } };

    private static JsonElement[] Items(JsonElement list) => [.. list.GetProperty("items").EnumerateArray()];

    [Fact]
    public async Task The_remembered_state_is_created_on_first_save_replaced_after_and_listed_for_its_surface()
    {
        var ann = await UserAsync(Ann, "Task.View");
        Items(await ReadAsync(await ann.GetAsync($"/api/v1/me/views?surface={Surface}"))).ShouldBeEmpty();

        var first = await ann.PutAsJsonAsync($"/api/v1/me/views/{Surface}", State("due", 1, 2));
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());
        var saved = await ReadAsync(first);
        saved.GetProperty("name").ValueKind.ShouldBe(JsonValueKind.Null);
        saved.GetProperty("state").GetProperty("sort").GetString().ShouldBe("due");

        var second = await ReadAsync(await ann.PutAsJsonAsync($"/api/v1/me/views/{Surface}", State("priority", 3)));
        second.GetProperty("id").GetInt64().ShouldBe(saved.GetProperty("id").GetInt64());

        var items = Items(await ReadAsync(await ann.GetAsync($"/api/v1/me/views?surface={Surface}")));
        items.Length.ShouldBe(1);
        items[0].GetProperty("state").GetProperty("sort").GetString().ShouldBe("priority");
        items[0].GetProperty("state").GetProperty("types")[0].GetInt32().ShouldBe(3);
    }

    [Fact]
    public async Task A_person_never_sees_or_changes_another_persons_views()
    {
        var ann = await UserAsync(Ann, "Task.View");
        var bob = await UserAsync(Bob, "Task.View");
        await ann.PutAsJsonAsync($"/api/v1/me/views/{Surface}", State("due"));
        var named = await ReadAsync(await ann.PostAsJsonAsync("/api/v1/me/views", new { surface = Surface, name = "Mine", state = new { sort = "due" } }));
        var id = named.GetProperty("id").GetInt64();

        Items(await ReadAsync(await bob.GetAsync("/api/v1/me/views"))).ShouldBeEmpty();
        (await bob.DeleteAsync($"/api/v1/me/views/{id}")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
        var put = await bob.PutAsJsonAsync($"/api/v1/me/views/{id}", new { name = "Stolen", rowVersion = named.GetProperty("rowVersion").GetString() });
        put.StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // Bob's own save does not touch Ann's row.
        await bob.PutAsJsonAsync($"/api/v1/me/views/{Surface}", State("matter"));
        var annItems = Items(await ReadAsync(await ann.GetAsync($"/api/v1/me/views?surface={Surface}")));
        annItems.Single(i => i.GetProperty("name").ValueKind == JsonValueKind.Null).GetProperty("state").GetProperty("sort").GetString().ShouldBe("due");
        annItems.Single(i => i.GetProperty("id").GetInt64() == id).GetProperty("name").GetString().ShouldBe("Mine");
    }

    [Fact]
    public async Task Named_views_can_be_renamed_made_default_and_deleted_with_one_default_per_surface()
    {
        var ann = await UserAsync(Ann, "Task.View");
        var a = await ReadAsync(await ann.PostAsJsonAsync("/api/v1/me/views", new { surface = Surface, name = "Intake focus", state = new { types = new[] { 1 } }, isDefault = true }));
        var b = await ReadAsync(await ann.PostAsJsonAsync("/api/v1/me/views", new { surface = Surface, name = "Production week", state = new { types = new[] { 2 } }, isDefault = true }));
        a.GetProperty("isDefault").GetBoolean().ShouldBeTrue();

        var items = Items(await ReadAsync(await ann.GetAsync($"/api/v1/me/views?surface={Surface}")));
        items.Where(i => i.GetProperty("isDefault").GetBoolean()).Select(i => i.GetProperty("name").GetString()).ShouldBe(["Production week"]);

        var renamed = await ann.PutAsJsonAsync($"/api/v1/me/views/{b.GetProperty("id").GetInt64()}", new { name = "Prod week", rowVersion = b.GetProperty("rowVersion").GetString() });
        renamed.StatusCode.ShouldBe(HttpStatusCode.OK, await renamed.Content.ReadAsStringAsync());
        (await ReadAsync(renamed)).GetProperty("name").GetString().ShouldBe("Prod week");

        // A stale row version is a conflict.
        var stale = await ann.PutAsJsonAsync($"/api/v1/me/views/{b.GetProperty("id").GetInt64()}", new { name = "Again", rowVersion = b.GetProperty("rowVersion").GetString() });
        stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);

        (await ann.DeleteAsync($"/api/v1/me/views/{a.GetProperty("id").GetInt64()}")).StatusCode.ShouldBe(HttpStatusCode.NoContent);
        Items(await ReadAsync(await ann.GetAsync($"/api/v1/me/views?surface={Surface}"))).Length.ShouldBe(1);
    }

    [Fact]
    public async Task Names_are_unique_per_surface_and_the_limit_of_30_named_views_holds()
    {
        var ann = await UserAsync(Ann, "Task.View");
        (await ann.PostAsJsonAsync("/api/v1/me/views", new { surface = Surface, name = "Same", state = new { } })).StatusCode.ShouldBe(HttpStatusCode.Created);
        var duplicate = await ann.PostAsJsonAsync("/api/v1/me/views", new { surface = Surface, name = "Same", state = new { } });
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await ReadAsync(duplicate)).GetProperty("code").GetString().ShouldBe("DUPLICATE_NAME");
        (await ann.PostAsJsonAsync("/api/v1/me/views", new { surface = "task-queue", name = "Same", state = new { } })).StatusCode.ShouldBe(HttpStatusCode.Created);

        for (var i = 2; i < 30; i++)
            (await ann.PostAsJsonAsync("/api/v1/me/views", new { surface = Surface, name = "View " + i, state = new { } })).StatusCode.ShouldBe(HttpStatusCode.Created);
        var over = await ann.PostAsJsonAsync("/api/v1/me/views", new { surface = Surface, name = "One too many", state = new { } });
        over.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(over)).GetProperty("errors").GetProperty("name")[0].GetProperty("code").GetString().ShouldBe("LIMIT_REACHED");
    }

    [Fact]
    public async Task Bad_input_is_a_400_with_a_stable_code()
    {
        var ann = await UserAsync(Ann, "Task.View");

        var unknown = await ann.PutAsJsonAsync("/api/v1/me/views/not-a-surface", State());
        unknown.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(unknown)).GetProperty("errors").GetProperty("surface")[0].GetProperty("code").GetString().ShouldBe("UNKNOWN_SURFACE");
        (await ann.GetAsync("/api/v1/me/views?surface=nope")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var notObject = await ann.PutAsJsonAsync($"/api/v1/me/views/{Surface}", new { state = new[] { 1, 2 } });
        notObject.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(notObject)).GetProperty("errors").GetProperty("state")[0].GetProperty("code").GetString().ShouldBe("STATE_INVALID");

        var tooLarge = await ann.PutAsJsonAsync($"/api/v1/me/views/{Surface}", new { state = new { blob = new string('x', 5000) } });
        tooLarge.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await ReadAsync(tooLarge)).GetProperty("errors").GetProperty("state")[0].GetProperty("code").GetString().ShouldBe("STATE_TOO_LARGE");

        var blank = await ann.PostAsJsonAsync("/api/v1/me/views", new { surface = Surface, name = "   ", state = new { } });
        blank.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task A_user_without_any_work_permission_is_refused()
    {
        var nobody = await UserAsync(@"ke\nobody");
        (await nobody.GetAsync("/api/v1/me/views")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await nobody.PutAsJsonAsync($"/api/v1/me/views/{Surface}", State())).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
}
