using System.Text.Json;
using MatterFlow.Configuration.Contracts;
using Shouldly;

namespace MatterFlow.UnitTests.Configuration;

/// <summary>The Task Type colour palette (contracts/task-type-colours.json, shared with the Angular palette).</summary>
public class TaskTypeColoursTests
{
    private static readonly string[] Expected = ["slate", "blue", "teal", "green", "amber", "orange", "red", "rose", "violet", "indigo"];

    [Fact]
    public void The_palette_is_the_ten_named_colours_in_order()
    {
        TaskTypeColours.All.Select(c => c.Key).ShouldBe(Expected);
        TaskTypeColours.All.ShouldAllBe(c => c.Label.Length > 0 && c.Key.Length <= 20 && System.Text.RegularExpressions.Regex.IsMatch(c.Key, "^[a-z]+$"));
    }

    [Theory]
    [InlineData("teal", true)]
    [InlineData("indigo", true)]
    [InlineData("Teal", false)]
    [InlineData("teal ", false)]
    [InlineData("#00ff00", false)]
    [InlineData("pink", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Only_exact_palette_names_are_valid(string? key, bool valid) => TaskTypeColours.IsValid(key).ShouldBe(valid);

    [Fact]
    public void The_embedded_list_is_the_contract_file_in_the_repository()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", "contracts", "task-type-colours.json");
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.GetFullPath(path)));
        var onDisk = doc.RootElement.GetProperty("colours").EnumerateArray().Select(c => c.GetProperty("key").GetString()!).ToList();
        onDisk.ShouldBe(TaskTypeColours.All.Select(c => c.Key).ToList());
    }

    [Fact]
    public void The_target_turnaround_limits_match_the_column_check()
    {
        TaskTypeColours.MinTargetDays.ShouldBe(1);
        TaskTypeColours.MaxTargetDays.ShouldBe(365);
    }
}
