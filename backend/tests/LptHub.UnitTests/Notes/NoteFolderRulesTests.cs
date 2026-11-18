using LptHub.Notes.Domain;
using Shouldly;

namespace LptHub.UnitTests.Notes;

/// <summary>The folder rules of epic #1405 (issue #1407): the name, the levels, the cycle, the name clash and the path.</summary>
public sealed class NoteFolderRulesTests
{
    // 1 Custodians > 2 Executive Team > 3 Finance; 4 Records (top); 5 Finance (under Records).
    private static NoteFolderTree Sample() => new(
    [
        new(1, null, "Custodians"),
        new(2, 1, "Executive Team"),
        new(3, 2, "Finance"),
        new(4, null, "Records"),
        new(5, 4, "Finance"),
    ]);

    [Theory]
    [InlineData("Finance", "Finance")]
    [InlineData("  Finance  ", "Finance")]
    [InlineData("Q3 (draft) & more", "Q3 (draft) & more")]
    public void A_name_is_trimmed(string input, string expected) => NoteFolderRules.NormalizeName(input).Value.ShouldBe(expected);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("a/b")]
    [InlineData("a\\b")]
    [InlineData("a\tb")]
    [InlineData("a\nb")]
    public void A_name_must_not_be_empty_or_hold_a_slash_or_a_control_character(string? input) => NoteFolderRules.NormalizeName(input).IsFailure.ShouldBeTrue();

    [Fact]
    public void A_name_has_at_most_100_characters_after_trimming()
    {
        NoteFolderRules.NormalizeName(" " + new string('x', 100) + " ").IsSuccess.ShouldBeTrue();
        NoteFolderRules.NormalizeName(new string('x', 101)).IsFailure.ShouldBeTrue();
    }

    [Fact]
    public void Levels_and_heights_count_from_one()
    {
        var tree = Sample();

        tree.Level(null).ShouldBe(0);
        tree.Level(1).ShouldBe(1);
        tree.Level(3).ShouldBe(3);
        tree.Height(1).ShouldBe(3);
        tree.Height(3).ShouldBe(1);
        tree.Height(4).ShouldBe(2);
    }

    [Fact]
    public void A_subtree_may_not_end_deeper_than_five_levels()
    {
        var tree = Sample(); // Custodians has a height of 3

        tree.WouldBeTooDeep(1, 5).ShouldBeFalse(); // under Records > Finance: 2 + 3 = 5
        tree.WouldBeTooDeep(1, 3).ShouldBeTrue(); // under level 3 (itself a descendant, but depth is checked on its own): 3 + 3 = 6
        tree.WouldBeTooDeep(4, 2).ShouldBeFalse(); // Records (2 levels) under level 2: 2 + 2 = 4
    }

    [Fact]
    public void The_limit_is_inclusive()
    {
        var tree = new NoteFolderTree(Enumerable.Range(1, 5).Select(i => new NoteFolderNode(i, i == 1 ? null : i - 1, "L" + i)).Append(new(6, null, "Loose")));

        tree.Level(5).ShouldBe(5);
        tree.WouldBeTooDeep(6, 5).ShouldBeTrue(); // a sixth level
        tree.WouldBeTooDeep(6, 4).ShouldBeFalse(); // the fifth
        tree.WouldBeTooDeep(5, null).ShouldBeFalse();
    }

    [Fact]
    public void A_folder_cannot_move_into_itself_or_its_own_subfolders()
    {
        var tree = Sample();

        tree.WouldCycle(1, 1).ShouldBeTrue();
        tree.WouldCycle(1, 3).ShouldBeTrue();
        tree.WouldCycle(2, 3).ShouldBeTrue();
        tree.WouldCycle(3, 1).ShouldBeFalse();
        tree.WouldCycle(1, 4).ShouldBeFalse();
        tree.WouldCycle(1, null).ShouldBeFalse();
    }

    [Fact]
    public void Names_are_unique_inside_a_parent_ignoring_case_and_the_folder_itself()
    {
        var tree = Sample();

        tree.FindByName(null, "custodians").ShouldNotBeNull();
        tree.FindByName(null, "Finance").ShouldBeNull(); // Finance exists, but not at the top level
        tree.FindByName(2, "FINANCE")!.Value.Id.ShouldBe(3);
        tree.FindByName(2, "FINANCE", exceptId: 3).ShouldBeNull(); // renaming it to its own name in another case is fine
        tree.FindByName(4, "Finance")!.Value.Id.ShouldBe(5);
    }

    [Fact]
    public void The_path_names_the_folders_from_the_top_and_no_folder_for_the_top_level()
    {
        var tree = Sample();

        tree.Path(3).ShouldBe("Custodians > Executive Team > Finance");
        tree.Path(5).ShouldBe("Records > Finance");
        tree.Path(null).ShouldBe("No Folder");
    }

    [Fact]
    public void Self_and_descendants_lists_the_whole_subtree()
    {
        var tree = Sample();

        tree.SelfAndDescendants(1).OrderBy(i => i).ShouldBe([1, 2, 3]);
        tree.SelfAndDescendants(3).ShouldBe([3]);
        tree.Children(null).Select(c => c.Id).OrderBy(i => i).ShouldBe([1, 4]);
    }
}
