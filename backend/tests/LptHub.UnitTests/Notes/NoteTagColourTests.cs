using LptHub.Configuration.Contracts;
using LptHub.Notes.Application;
using Shouldly;

namespace LptHub.UnitTests.Notes;

/// <summary>Every note tag is drawn with a colour: its own, or a palette colour chosen from its id (the same tag always gets the same one).</summary>
public sealed class NoteTagColourTests
{
    [Fact]
    public void A_valid_own_colour_is_kept()
    {
        NoteSupport.EffectiveColour("violet", 1).ShouldBe("violet");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("pink")]
    public void A_tag_without_a_valid_colour_gets_a_palette_colour_that_never_changes(string? key)
    {
        var first = NoteSupport.EffectiveColour(key, 7);

        TaskTypeColours.IsValid(first).ShouldBeTrue();
        NoteSupport.EffectiveColour(key, 7).ShouldBe(first);
    }

    [Fact]
    public void Neighbouring_tags_get_different_colours()
    {
        var colours = Enumerable.Range(1, TaskTypeColours.All.Count).Select(id => NoteSupport.EffectiveColour(null, id)).ToList();

        colours.Distinct().Count().ShouldBe(colours.Count);
    }
}
