using Shouldly;

namespace MatterFlow.UnitTests;

public class SmokeTests
{
    [Fact]
    public void Test_runner_is_wired()
    {
        (1 + 1).ShouldBe(2);
    }
}
