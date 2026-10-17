using System.Text.Json;
using MatterFlow.IntegrationTests.Fixtures;
using MatterFlow.IntegrationTests.Tasks;
using Shouldly;
using static MatterFlow.IntegrationTests.Tasks.TaskHarness;

namespace MatterFlow.IntegrationTests.WorkViews;

/// <summary>M12.2 (#165): an On Hold row of the Task Queue carries the plain text of the latest hold comment, cut to 200 characters.</summary>
[Collection(SqlServerCollection.Name)]
public sealed class HoldReasonApiTests(SqlServerFixture sql) : IAsyncLifetime
{
    private DatabaseApiFactory _factory = null!;
    private TaskHarness _h = null!;
    private World _w = null!;

    public async Task InitializeAsync()
    {
        _factory = new DatabaseApiFactory(await sql.CreateDatabaseAsync());
        _h = new TaskHarness(_factory);
        _w = await _h.CreateWorldAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<JsonElement> RowAsync(JsonElement task)
    {
        var page = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-queue?pageSize=100"));
        return page.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("taskId").GetInt64() == TaskId(task));
    }

    [Fact]
    public async Task An_on_hold_row_shows_the_latest_reason_as_collapsed_plain_text()
    {
        var task = await _h.CreateTaskAsync(_w);
        task = await _h.StatusAsync(task, "ON_HOLD", "First reason");
        task = await _h.StatusAsync(task, "IN_PROGRESS");
        task = await _h.StatusAsync(task, "ON_HOLD", "Waiting   for the\n custodian");

        var row = await RowAsync(task);
        row.GetProperty("holdReason").GetString().ShouldBe("Waiting for the custodian");
        row.GetProperty("holdReasonTruncated").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task A_long_reason_is_cut_to_200_characters_and_flagged()
    {
        var task = await _h.CreateTaskAsync(_w);
        task = await _h.StatusAsync(task, "ON_HOLD", new string('x', 500));

        var row = await RowAsync(task);
        row.GetProperty("holdReason").GetString()!.Length.ShouldBe(200);
        row.GetProperty("holdReasonTruncated").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task Markup_is_stripped_and_a_resumed_task_has_no_reason()
    {
        var task = await _h.CreateTaskAsync(_w);
        task = await _h.StatusAsync(task, "ON_HOLD", "plain");
        // Hold comments are rich text: stored markup is stripped, table cells are separated by " | ", the newest hold comment wins.
        await _h.ExecuteAsync($"UPDATE dbo.TaskComment SET BodyHtml = N'<p>Waiting for <strong>the</strong> custodian</p><table><tr><td>a</td><td>b</td></tr></table>' WHERE TaskId = {TaskId(task)} AND Purpose = 'ON_HOLD'");
        var held = await RowAsync(task);
        held.GetProperty("holdReason").GetString().ShouldBe("Waiting for the custodian a | b");

        task = await _h.StatusAsync(task, "IN_PROGRESS");
        var resumed = await RowAsync(task);
        resumed.GetProperty("holdReason").ValueKind.ShouldBe(JsonValueKind.Null);
        resumed.GetProperty("holdReasonTruncated").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task Only_on_hold_rows_carry_a_reason_and_other_lists_share_the_field()
    {
        var plain = await _h.CreateTaskAsync(_w);
        var row = await RowAsync(plain);
        row.GetProperty("holdReason").ValueKind.ShouldBe(JsonValueKind.Null);

        var held = await _h.ReachAsync(_w, "ON_HOLD");
        var mine = await OkAsync(await _h.Admin.GetAsync("/api/v1/task-queue?status=ON_HOLD&pageSize=100"));
        mine.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("taskId").GetInt64() == TaskId(held))
            .GetProperty("holdReason").GetString().ShouldBe("Waiting for the client");
    }
}
