using Shouldly;

namespace MatterFlow.IntegrationTests.WorkViews;

public static class QueueAssertions
{
    /// <summary>The titles are exactly these, in any order.</summary>
    public static void ShouldBeSet(this IEnumerable<string> actual, string[] expected) =>
        actual.Order().ToList().ShouldBe(expected.Order().ToList());
}
