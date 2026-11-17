using LptHub.Identity.Access;
using LptHub.SharedKernel.Identity;
using LptHub.SharedKernel.Visibility;
using Microsoft.Extensions.Options;
using NSubstitute;
using Shouldly;

namespace LptHub.UnitTests.Visibility;

/// <summary>
/// The Task Type access rule (epic #1397, issue #1400, README sections 1.2 and 4) over in-memory rows: a task of a restricted type is visible only to the System Admin or to a person who holds, through an
/// active role, a Can View role of the type; no exception for the assignee, for a project manager or for a holder of <c>Matter.ViewSensitive</c>; both switches are independent; a switch that is off filters nothing.
/// </summary>
public class TaskTypeVisibilityRuleTests
{
    private const int Open = 1;
    private const int Secret = 2;
    private const int Other = 3;
    private const int RoleA = 100;
    private const int RoleB = 101;
    private const int RoleC = 102;
    private const int Me = 7;
    private const int Pm = 8;

    private static readonly TaskTypeAccessRow[] Types =
    [
        new() { TaskTypeId = Open, IsRestricted = false },
        new() { TaskTypeId = Secret, IsRestricted = true },
        new() { TaskTypeId = Other, IsRestricted = true },
    ];

    // Secret: Can View = A and B. Other: Can View = C.
    private static readonly TaskTypeViewRoleRow[] ViewRoles =
    [
        new() { TaskTypeId = Secret, RoleId = RoleA },
        new() { TaskTypeId = Secret, RoleId = RoleB },
        new() { TaskTypeId = Other, RoleId = RoleC },
    ];

    private static readonly MatterAccessRow Normal = new() { MatterId = 1, IsSensitive = false, PrimaryManagerId = Pm };
    private static readonly MatterAccessRow Sensitive = new() { MatterId = 2, IsSensitive = true, PrimaryManagerId = Pm };

    private static readonly TaskAccessRow[] Tasks =
    [
        new() { TaskId = 10, MatterId = 1, TaskTypeId = Open, AssignedUserId = Me },
        new() { TaskId = 11, MatterId = 1, TaskTypeId = Secret, AssignedUserId = Me },
        new() { TaskId = 12, MatterId = 1, TaskTypeId = Secret, AssignedUserId = null },
        new() { TaskId = 13, MatterId = 1, TaskTypeId = Other, AssignedUserId = Pm },
        new() { TaskId = 14, MatterId = 2, TaskTypeId = Open, AssignedUserId = Me },
        new() { TaskId = 15, MatterId = 2, TaskTypeId = Secret, AssignedUserId = Me },
    ];

    private static MatterVisibility Port(Viewer current, int[] myRoles, bool typeRule = true, bool sensitiveRule = false)
    {
        var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(current.UserId);
        user.IsSystemAdmin.Returns(current.IsSystemAdmin);
        var permissions = Substitute.For<IPermissionChecker>();
        permissions.Has("Matter.ViewSensitive").Returns(current.SeeAll);
        var matters = Substitute.For<IMatterAccessSource>();
        matters.Rows().Returns(_ => new[] { Normal, Sensitive }.AsQueryable());
        var tasks = Substitute.For<ITaskAccessSource>();
        tasks.Rows().Returns(_ => Tasks.AsQueryable());
        var types = Substitute.For<ITaskTypeAccessSource>();
        types.Types().Returns(_ => Types.AsQueryable());
        types.ViewRoles().Returns(_ => ViewRoles.AsQueryable());
        var roles = Substitute.For<IActiveRoleSource>();
        roles.RoleIdsOf(Arg.Any<int>()).Returns(_ => myRoles.AsQueryable());
        return new MatterVisibility(
            user,
            permissions,
            matters,
            tasks,
            null!,
            Options.Create(new SensitiveMatterAccessOptions { SensitiveMatterAccess = sensitiveRule }),
            types,
            roles,
            Options.Create(new TaskTypeAccessOptions { TaskTypeAccess = typeRule }));
    }

    private static long[] Ids(IQueryable<TaskAccessRow> rows) => [.. rows.Select(t => t.TaskId).OrderBy(i => i)];

    [Fact]
    public void A_person_without_a_view_role_does_not_see_tasks_of_a_restricted_type_even_when_assigned()
    {
        var port = Port(new Viewer(Me, false), []);

        // 11 and 15 are assigned to Me but of the restricted type: no assignee exception.
        Ids(port.VisibleTasks()).ShouldBe([10, 14]);
    }

    [Fact]
    public void A_person_with_one_of_the_view_roles_sees_that_type_only()
    {
        Ids(Port(new Viewer(Me, false), [RoleA]).VisibleTasks()).ShouldBe([10, 11, 12, 14, 15]);
        Ids(Port(new Viewer(Me, false), [RoleB]).VisibleTasks()).ShouldBe([10, 11, 12, 14, 15]);
        Ids(Port(new Viewer(Me, false), [RoleC]).VisibleTasks()).ShouldBe([10, 13, 14]);
    }

    [Fact]
    public void Roles_add_up_and_a_role_that_is_in_no_list_grants_nothing()
    {
        Ids(Port(new Viewer(Me, false), [RoleA, RoleC]).VisibleTasks()).ShouldBe([10, 11, 12, 13, 14, 15]);
        Ids(Port(new Viewer(Me, false), [999]).VisibleTasks()).ShouldBe([10, 14]);
    }

    [Fact]
    public void The_system_admin_sees_everything_and_matter_view_sensitive_does_not_lift_the_type_rule()
    {
        Ids(Port(new Viewer(Me, true, IsSystemAdmin: true), []).VisibleTasks()).ShouldBe([10, 11, 12, 13, 14, 15]);

        // SeeAll (Matter.ViewSensitive) without System Admin: still subject to the type rule.
        Ids(Port(new Viewer(Me, true), []).VisibleTasks()).ShouldBe([10, 14]);
    }

    [Fact]
    public void A_viewer_without_a_person_sees_open_types_only()
    {
        Ids(Port(Viewer.Nobody, [RoleA]).VisibleTasks()).ShouldBe([10, 14]);
    }

    [Fact]
    public void A_project_manager_gets_no_special_access()
    {
        // Pm manages both matters and holds no role: the restricted tasks of those matters are hidden from him as well.
        Ids(Port(new Viewer(Pm, false), [], sensitiveRule: true).VisibleTasks()).ShouldBe([10, 14]);
    }

    [Fact]
    public void The_two_rules_are_anded_and_each_has_its_own_switch()
    {
        // Sensitive rule on, type rule on: Me sees the sensitive matter's task only when assigned (14 yes; 15 is assigned but of the hidden type).
        Ids(Port(new Viewer(Me, false), [], sensitiveRule: true).VisibleTasks()).ShouldBe([10, 14]);

        // Sensitive rule on, type rule off: the old behaviour (the normal matter's tasks, plus the assigned ones of the sensitive matter), restricted types ignored.
        Ids(Port(new Viewer(Me, false), [], typeRule: false, sensitiveRule: true).VisibleTasks()).ShouldBe([10, 11, 12, 13, 14, 15]);

        // Sensitive rule off, type rule on: only the type term filters.
        Ids(Port(new Viewer(Me, false), [], sensitiveRule: false).VisibleTasks()).ShouldBe([10, 14]);
    }

    [Fact]
    public void With_both_switches_off_nothing_is_filtered_and_no_role_is_read()
    {
        var port = Port(new Viewer(Me, false), [], typeRule: false);

        port.TaskTypeAccessEnabled.ShouldBeFalse();
        port.TaskRulesEnabled.ShouldBeFalse();
        Ids(port.VisibleTasks()).ShouldBe([10, 11, 12, 13, 14, 15]);
        port.WhereTaskTypeVisible(Tasks.AsQueryable(), t => t.TaskTypeId).Count().ShouldBe(Tasks.Length);
        port.WhereTaskEventVisible(new[] { 11L }.AsQueryable(), id => id).Count().ShouldBe(1);
    }

    [Fact]
    public void Every_task_shaped_method_applies_the_type_term()
    {
        var port = Port(new Viewer(Me, false), []);
        var rows = Tasks.AsQueryable();

        port.WhereTaskVisible(rows, t => t.TaskId).Select(t => t.TaskId).ShouldBe([10, 14]);
        port.WhereTaskTypeVisible(rows, t => t.TaskTypeId).Select(t => t.TaskId).ShouldBe([10, 14]);
        port.WhereTaskVisibleBy(rows, t => t.MatterId, t => t.AssignedUserId, t => t.TaskTypeId).Select(t => t.TaskId).ShouldBe([10, 14]);
        port.WhereTaskFlagVisible(rows, t => t.MatterId, t => false, t => t.AssignedUserId, t => t.TaskTypeId).Select(t => t.TaskId).ShouldBe([10, 14]);
        port.WhereTaskRowVisible(rows, t => false, t => null, t => null, t => t.AssignedUserId, t => t.TaskTypeId).Select(t => t.TaskId).ShouldBe([10, 14]);
    }

    [Fact]
    public void Rows_that_point_at_a_task_by_id_are_filtered_by_the_current_type_of_that_task()
    {
        var port = Port(new Viewer(Me, false), []);
        var events = new (long? TaskId, string Name)[] { (null, "user"), (10, "open"), (11, "secret"), (13, "other") };

        // Same shape as the audit query: the hidden-task set is a query over the task rows, joined by the primary key.
        var visible = port.WhereTaskEventVisible(events.AsQueryable(), e => e.TaskId).Select(e => e.Name).ToList();

        visible.ShouldBe(["user", "open"]);
    }

    [Fact]
    public async Task The_hidden_type_ids_are_the_restricted_types_without_one_of_my_roles()
    {
        (await Port(new Viewer(Me, false), []).HiddenTaskTypeIdsAsync()).Order().ShouldBe([Secret, Other]);
        (await Port(new Viewer(Me, false), [RoleA]).HiddenTaskTypeIdsAsync()).ShouldBe([Other]);
        (await Port(new Viewer(Me, false), [RoleA, RoleC]).HiddenTaskTypeIdsAsync()).ShouldBeEmpty();
        (await Port(new Viewer(Me, false, true), []).HiddenTaskTypeIdsAsync()).ShouldBeEmpty();
        (await Port(new Viewer(Me, false), [], typeRule: false).HiddenTaskTypeIdsAsync()).ShouldBeEmpty();
    }

    [Fact]
    public void The_type_term_with_a_loaded_list_and_with_the_subquery_give_the_same_rows()
    {
        var rows = Tasks.AsQueryable();
        var hidden = new[] { Secret, Other };

        var withList = rows.Where(VisibilityPredicates.TypeNotHidden<TaskAccessRow>(t => t.TaskTypeId, hidden, new int[0].AsQueryable())!).Select(t => t.TaskId).ToArray();
        var withQuery = rows.Where(VisibilityPredicates.TypeNotHidden<TaskAccessRow>(t => t.TaskTypeId, null, hidden.AsQueryable())!).Select(t => t.TaskId).ToArray();

        withList.ShouldBe([10, 14]);
        withQuery.ShouldBe(withList);
        VisibilityPredicates.TypeNotHidden<TaskAccessRow>(t => t.TaskTypeId, [], new int[0].AsQueryable()).ShouldBeNull();
    }
}
