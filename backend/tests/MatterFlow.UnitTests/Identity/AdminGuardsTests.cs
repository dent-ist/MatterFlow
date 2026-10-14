using MatterFlow.Identity.Application;
using MatterFlow.SharedKernel.Results;
using Shouldly;

namespace MatterFlow.UnitTests.Identity;

public class AdminGuardsTests
{
    [Fact]
    public void Deactivating_yourself_is_rejected()
    {
        var error = AdminGuards.CheckSelfDeactivation(actorUserId: 5, targetUserId: 5, newIsActive: false);

        error.ShouldNotBeNull();
        error.Type.ShouldBe(ErrorType.Validation);
        error.FieldErrors!["isActive"][0].Code.ShouldBe(AdminGuards.SelfDeactivationFieldCode);
    }

    [Theory]
    [InlineData(5, 6, false)] // someone else
    [InlineData(5, 5, true)] // activating yourself is harmless
    public void Other_combinations_are_allowed(int actor, int target, bool isActive) =>
        AdminGuards.CheckSelfDeactivation(actor, target, isActive).ShouldBeNull();

    [Fact]
    public void The_only_active_admin_cannot_be_removed() =>
        AdminGuards.WouldRemoveLastActiveAdmin(1, [1]).ShouldBeTrue();

    [Fact]
    public void An_admin_can_be_removed_while_another_active_admin_remains() =>
        AdminGuards.WouldRemoveLastActiveAdmin(1, [1, 2]).ShouldBeFalse();

    [Fact]
    public void Removing_a_non_admin_never_matters() =>
        AdminGuards.WouldRemoveLastActiveAdmin(3, [1]).ShouldBeFalse();

    [Fact]
    public void With_no_active_admin_at_all_nothing_is_blocked() =>
        AdminGuards.WouldRemoveLastActiveAdmin(3, []).ShouldBeFalse();

    [Fact]
    public void Last_admin_error_is_a_409_with_the_stable_code()
    {
        var error = AdminGuards.LastAdminError();

        error.Type.ShouldBe(ErrorType.Conflict);
        error.Code.ShouldBe(ErrorCodes.LastAdmin);
    }
}
