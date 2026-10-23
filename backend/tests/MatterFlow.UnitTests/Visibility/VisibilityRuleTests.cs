using MatterFlow.Identity.Access;
using MatterFlow.SharedKernel.Identity;
using MatterFlow.SharedKernel.Results;
using MatterFlow.SharedKernel.Visibility;
using Microsoft.Extensions.Options;
using NSubstitute;
using Shouldly;

namespace MatterFlow.UnitTests.Visibility;

/// <summary>The full truth table of the sensitive-matter rule (epic #788, README section 1) over in-memory rows, and the switch behaviour of the port.</summary>
public class VisibilityRuleTests
{
    private const int Me = 7;
    private const int Other = 8;

    private static readonly MatterAccessRow Normal = new() { MatterId = 1, IsSensitive = false, PrimaryManagerId = Other };
    private static readonly MatterAccessRow SensitiveMine1 = new() { MatterId = 2, IsSensitive = true, PrimaryManagerId = Me };
    private static readonly MatterAccessRow SensitiveMine2 = new() { MatterId = 3, IsSensitive = true, PrimaryManagerId = Other, SecondaryManagerId = Me };
    private static readonly MatterAccessRow SensitiveOthers = new() { MatterId = 4, IsSensitive = true, PrimaryManagerId = Other };
    private static readonly MatterAccessRow SensitiveNoManager = new() { MatterId = 5, IsSensitive = true };
    private static readonly MatterAccessRow[] Matters = [Normal, SensitiveMine1, SensitiveMine2, SensitiveOthers, SensitiveNoManager];

    private static readonly TaskAccessRow[] Tasks =
    [
        new() { TaskId = 10, MatterId = 1, AssignedUserId = Other },
        new() { TaskId = 11, MatterId = 4, AssignedUserId = Me },
        new() { TaskId = 12, MatterId = 4, AssignedUserId = Other },
        new() { TaskId = 13, MatterId = 5, AssignedUserId = null },
        new() { TaskId = 14, MatterId = 2, AssignedUserId = null },
    ];

    private static int[] Ids(Viewer viewer) => [.. Matters.AsQueryable().Where(VisibilityPredicates.Matter(viewer)).Select(m => m.MatterId)];

    [Fact]
    public void A_manager_sees_normal_matters_and_the_sensitive_ones_where_they_are_primary_or_secondary()
        => Ids(new Viewer(Me, false)).ShouldBe([1, 2, 3]);

    [Fact]
    public void A_person_with_no_relation_sees_only_the_normal_matter()
        => Ids(new Viewer(99, false)).ShouldBe([1]);

    [Fact]
    public void See_all_sees_every_matter_including_the_sensitive_one_without_a_manager()
        => Ids(new Viewer(99, true)).ShouldBe([1, 2, 3, 4, 5]);

    [Fact]
    public void A_viewer_without_a_person_never_matches_the_matter_without_a_manager()
    {
        // A null user compared as "= NULL" would match PrimaryManagerId IS NULL in SQL; the rule must not.
        Ids(Viewer.Nobody).ShouldBe([1]);
        Ids(new Viewer(null, false)).ShouldNotContain(5);
    }

    [Fact]
    public void An_assignee_is_not_a_matter_viewer_but_sees_their_own_tasks()
    {
        var viewer = new Viewer(Me, false);
        Ids(new Viewer(99, false)).ShouldNotContain(4);
        Tasks.AsQueryable().Where(VisibilityPredicates.AssignedToViewer(viewer)).Select(t => t.TaskId).ShouldBe([11]);
        Tasks.AsQueryable().Where(VisibilityPredicates.AssignedToViewer(Viewer.Nobody)).ShouldBeEmpty();
    }

    private static MatterVisibility Port(bool enabled, Viewer current)
    {
        var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(current.UserId);
        var permissions = Substitute.For<IPermissionChecker>();
        permissions.Has("Matter.ViewSensitive").Returns(current.SeeAll);
        var matters = Substitute.For<IMatterAccessSource>();
        matters.Rows().Returns(_ => Matters.AsQueryable());
        var tasks = Substitute.For<ITaskAccessSource>();
        tasks.Rows().Returns(_ => Tasks.AsQueryable());
        return new MatterVisibility(user, permissions, matters, tasks, null!, Options.Create(new SensitiveMatterAccessOptions { SensitiveMatterAccess = enabled }));
    }

    [Fact]
    public void While_the_switch_is_off_everything_is_visible_to_everyone()
    {
        var port = Port(false, new Viewer(99, false));

        port.Enabled.ShouldBeFalse();
        port.VisibleMatters().Select(m => m.MatterId).ShouldBe([1, 2, 3, 4, 5]);
        port.VisibleTasks().Count().ShouldBe(Tasks.Length);
        port.WhereMatterVisible(Tasks.AsQueryable(), t => t.MatterId).Count().ShouldBe(Tasks.Length);
        port.WhereTaskVisible(Tasks.AsQueryable(), t => t.TaskId).Count().ShouldBe(Tasks.Length);
    }

    [Fact]
    public void With_the_switch_on_a_task_is_visible_through_its_matter_or_its_assignee()
    {
        var port = Port(true, new Viewer(Me, false));

        port.VisibleMatters().Select(m => m.MatterId).ShouldBe([1, 2, 3]);
        // 10 normal matter; 11 assigned to me on a hidden matter; 12 hidden; 13 hidden (no manager); 14 my matter.
        port.VisibleTasks().Select(t => t.TaskId).ShouldBe([10, 11, 14]);
        port.WhereMatterVisible(Tasks.AsQueryable(), t => t.MatterId).Select(t => t.TaskId).ShouldBe([10, 14]);
        port.WhereTaskVisible(Tasks.AsQueryable(), t => t.TaskId).Select(t => t.TaskId).ShouldBe([10, 11, 14]);
    }

    [Fact]
    public void With_the_switch_on_see_all_sees_everything_and_a_system_viewer_does_not()
    {
        Port(true, new Viewer(99, true)).VisibleTasks().Count().ShouldBe(Tasks.Length);

        var system = Port(true, Viewer.Nobody);
        system.Current.ShouldBe(Viewer.Nobody);
        system.VisibleMatters().Select(m => m.MatterId).ShouldBe([1]);
        system.VisibleTasks().Select(t => t.TaskId).ShouldBe([10]);
    }

    [Fact]
    public void An_explicit_viewer_overrides_the_current_one()
    {
        var port = Port(true, new Viewer(Me, false));

        port.VisibleMatters(new Viewer(Other, false)).Select(m => m.MatterId).ShouldBe([1, 3, 4]);
        port.VisibleTasks(new Viewer(Other, false)).Select(t => t.TaskId).ShouldBe([10, 11, 12]);
    }

    [Fact]
    public void The_not_found_error_is_one_generic_404()
    {
        var error = Port(true, new Viewer(Me, false)).NotFound();

        error.Type.ShouldBe(ErrorType.NotFound);
        error.Code.ShouldBe(ErrorCodes.NotFound);
        error.Message.ShouldBe("The resource was not found.");
    }
}
